import type {
  LLMAssistantContentBlock,
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMUserContentBlock,
} from "../llm.js";

// Ollama provider — local-first inference. Talks to Ollama's /api/chat
// endpoint over plain HTTP. No API key required.
//
// Caveats:
// 1. The agent loop relies on multimodal + tool calling. Use a model that
//    supports both: llama3.2-vision (11b/90b) or qwen2.5-vl. Pure-text
//    models like llama3.1 will accept tool calls but ignore screenshots.
// 2. Ollama doesn't return tool_call ids; we synthesize them client-side
//    so the agent loop can pair tool_result blocks back to their call.
// 3. Parallel tool calls in a single assistant turn work for both modern
//    Ollama versions, but smaller local models may emit them serially.
//    The translator handles either case.

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** base64-encoded images, no `data:` prefix. User messages only. */
  images?: string[];
  /** Tool calls the assistant chose to make. Assistant messages only. */
  tool_calls?: OllamaToolCall[];
}

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  tools?: OllamaTool[];
  stream: false;
  options?: { num_ctx?: number };
}

interface OllamaChatResponse {
  model: string;
  message: OllamaMessage;
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  private readonly baseUrl: string;
  private toolUseCounter = 0;

  constructor(
    private readonly model: string,
    baseUrl?: string,
  ) {
    const raw = baseUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
    this.baseUrl = raw.replace(/\/+$/, "");
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const messages: OllamaMessage[] = [
      { role: "system", content: req.system },
      ...req.messages.flatMap(toOllamaMessages),
    ];

    const body: OllamaChatRequest = {
      model: this.model,
      messages,
      stream: false,
    };
    if (req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }
    // Ollama's default context window (2048) is too small for a multi-turn
    // agent with screenshots. Bump to 8k unless the caller overrode it.
    body.options = { num_ctx: 8192 };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
    }
    const json = (await res.json()) as OllamaChatResponse;

    const content: LLMAssistantContentBlock[] = [];
    if (json.message.content && json.message.content.length > 0) {
      content.push({ type: "text", text: json.message.content });
    }
    for (const call of json.message.tool_calls ?? []) {
      content.push({
        type: "tool_use",
        id: `ollama_${++this.toolUseCounter}`,
        name: call.function.name,
        input: (call.function.arguments ?? {}) as Record<string, unknown>,
      });
    }

    return {
      content,
      stopReason: mapStopReason(json.done_reason, content),
      usage: {
        inputTokens: json.prompt_eval_count ?? 0,
        outputTokens: json.eval_count ?? 0,
      },
    };
  }
}

function mapStopReason(
  reason: string | undefined,
  content: LLMAssistantContentBlock[],
): LLMResponse["stopReason"] {
  // Ollama emits "stop" even when tool_calls were produced; treat any turn
  // that includes a tool_use as tool_use so the agent loop dispatches them.
  if (content.some((b) => b.type === "tool_use")) return "tool_use";
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    default:
      return "end_turn";
  }
}

function toOllamaMessages(m: LLMMessage): OllamaMessage[] {
  if (m.role === "assistant") {
    const textParts: string[] = [];
    const toolCalls: OllamaToolCall[] = [];
    for (const block of m.content) {
      if (block.type === "text") {
        if (block.text) textParts.push(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push({
          function: { name: block.name, arguments: block.input },
        });
      }
    }
    const out: OllamaMessage = {
      role: "assistant",
      content: textParts.join("\n"),
    };
    if (toolCalls.length > 0) out.tool_calls = toolCalls;
    return [out];
  }

  // User-side content: tool_result blocks are split into their own `tool`
  // messages, with image follow-ups since Ollama tool messages don't carry
  // images.
  const messages: OllamaMessage[] = [];
  let pendingText: string[] = [];
  let pendingImages: string[] = [];

  const flushPending = (): void => {
    if (pendingText.length === 0 && pendingImages.length === 0) return;
    const msg: OllamaMessage = {
      role: "user",
      content: pendingText.join("\n"),
    };
    if (pendingImages.length > 0) msg.images = [...pendingImages];
    messages.push(msg);
    pendingText = [];
    pendingImages = [];
  };

  for (const block of m.content as LLMUserContentBlock[]) {
    if (block.type === "text") {
      pendingText.push(block.text);
    } else if (block.type === "image") {
      pendingImages.push(block.data);
    } else if (block.type === "tool_result") {
      flushPending();
      const text = block.content
        .map((c) => (c.type === "text" ? c.text : "[image attached below]"))
        .join("\n");
      messages.push({
        role: "tool",
        content: text || "(no content)",
      });
      const images = block.content.filter(
        (c): c is { type: "image"; mediaType: "image/png" | "image/jpeg"; data: string } =>
          c.type === "image",
      );
      if (images.length > 0) {
        messages.push({
          role: "user",
          content: "(tool screenshot)",
          images: images.map((i) => i.data),
        });
      }
    }
  }
  flushPending();
  return messages;
}
