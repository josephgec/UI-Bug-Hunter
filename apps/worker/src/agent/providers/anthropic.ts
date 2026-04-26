import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMAssistantContentBlock,
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from "../llm.js";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(
    private readonly model: string,
    apiKey?: string,
  ) {
    this.client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const result = await this.client.messages.create({
      model: this.model,
      system: req.system,
      max_tokens: req.maxTokens ?? 4096,
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema,
      })),
      messages: req.messages.map(toAnthropicMessage),
    });

    const content: LLMAssistantContentBlock[] = result.content.map((block) => {
      if (block.type === "text") return { type: "text", text: block.text };
      if (block.type === "tool_use") {
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        };
      }
      // Future block types (thinking, etc.) collapse to text — we don't surface them.
      return { type: "text", text: "" };
    });

    return {
      content,
      stopReason: mapStopReason(result.stop_reason),
      usage: {
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
      },
    };
  }
}

function toAnthropicMessage(m: LLMMessage): Anthropic.Messages.MessageParam {
  return {
    role: m.role,
    content: m.content.map((b): Anthropic.Messages.ContentBlockParam => {
      switch (b.type) {
        case "text":
          return { type: "text", text: b.text };
        case "image":
          return {
            type: "image",
            source: { type: "base64", media_type: b.mediaType, data: b.data },
          };
        case "tool_use":
          return {
            type: "tool_use",
            id: b.id,
            name: b.name,
            input: b.input,
          };
        case "tool_result":
          return {
            type: "tool_result",
            tool_use_id: b.toolUseId,
            is_error: b.isError ?? false,
            content: b.content.map((c) =>
              c.type === "text"
                ? { type: "text", text: c.text }
                : {
                    type: "image",
                    source: { type: "base64", media_type: c.mediaType, data: c.data },
                  },
            ),
          };
      }
    }),
  };
}

function mapStopReason(r: string | null): LLMResponse["stopReason"] {
  switch (r) {
    case "end_turn":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    default:
      return "other";
  }
}
