import OpenAI from "openai";
import type {
  LLMAssistantContentBlock,
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMUserContentBlock,
} from "../llm.js";

// OpenAI provider using Chat Completions with vision + tool calls.
// We translate our content-block representation to/from OpenAI's looser shape.
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(
    private readonly model: string,
    apiKey?: string,
  ) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const result = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 4096,
      tools: req.tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      })),
      messages: [
        { role: "system", content: req.system },
        ...req.messages.flatMap(toOpenAIMessages),
      ],
    });

    const choice = result.choices[0];
    if (!choice) {
      return {
        content: [],
        stopReason: "other",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    const content: LLMAssistantContentBlock[] = [];
    if (choice.message.content) {
      content.push({ type: "text", text: choice.message.content });
    }
    for (const call of choice.message.tool_calls ?? []) {
      if (call.type !== "function") continue;
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(call.function.arguments) as Record<string, unknown>;
      } catch {
        // Bad JSON from the model — surface as empty input; the tool will reject.
      }
      content.push({
        type: "tool_use",
        id: call.id,
        name: call.function.name,
        input: parsed,
      });
    }

    return {
      content,
      stopReason: mapFinishReason(choice.finish_reason),
      usage: {
        inputTokens: result.usage?.prompt_tokens ?? 0,
        outputTokens: result.usage?.completion_tokens ?? 0,
      },
    };
  }
}

function toOpenAIMessages(
  m: LLMMessage,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (m.role === "assistant") {
    const text = m.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const toolCalls = m.content
      .filter((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use")
      .map((b) => ({
        id: b.id,
        type: "function" as const,
        function: { name: b.name, arguments: JSON.stringify(b.input) },
      }));
    const out: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
      role: "assistant",
      content: text || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
    return [out];
  }

  // Each tool_result becomes its own message in OpenAI's schema.
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  const userParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

  for (const b of m.content as LLMUserContentBlock[]) {
    if (b.type === "text") {
      userParts.push({ type: "text", text: b.text });
    } else if (b.type === "image") {
      userParts.push({
        type: "image_url",
        image_url: { url: `data:${b.mediaType};base64,${b.data}` },
      });
    } else {
      // tool_result — flush any pending user parts first.
      if (userParts.length > 0) {
        messages.push({ role: "user", content: [...userParts] });
        userParts.length = 0;
      }
      const text = b.content
        .map((c) => (c.type === "text" ? c.text : "[image attached]"))
        .join("\n");
      messages.push({
        role: "tool",
        tool_call_id: b.toolUseId,
        content: text,
      });
      // OpenAI's tool message doesn't carry images; surface them as a follow-up user
      // message so the model still sees the screenshot.
      const images = b.content.filter(
        (c): c is { type: "image"; mediaType: "image/png" | "image/jpeg"; data: string } =>
          c.type === "image",
      );
      if (images.length > 0) {
        messages.push({
          role: "user",
          content: images.map((img) => ({
            type: "image_url",
            image_url: { url: `data:${img.mediaType};base64,${img.data}` },
          })),
        });
      }
    }
  }
  if (userParts.length > 0) {
    messages.push({ role: "user", content: userParts });
  }
  return messages;
}

function mapFinishReason(r: string | null): LLMResponse["stopReason"] {
  switch (r) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    default:
      return "other";
  }
}
