// Provider-agnostic LLM interface. The agent loop only ever talks through
// these types — Anthropic / OpenAI specifics live in providers/*.

export type LLMTextBlock = { type: "text"; text: string };
export type LLMImageBlock = {
  type: "image";
  mediaType: "image/png" | "image/jpeg";
  /** base64-encoded image data, no data: prefix */
  data: string;
};
export type LLMToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type LLMToolResultBlock = {
  type: "tool_result";
  toolUseId: string;
  content: Array<LLMTextBlock | LLMImageBlock>;
  isError?: boolean;
};

export type LLMUserContentBlock =
  | LLMTextBlock
  | LLMImageBlock
  | LLMToolResultBlock;
export type LLMAssistantContentBlock = LLMTextBlock | LLMToolUseBlock;

export type LLMMessage =
  | { role: "user"; content: LLMUserContentBlock[] }
  | { role: "assistant"; content: LLMAssistantContentBlock[] };

export interface LLMTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. */
  inputSchema: Record<string, unknown>;
}

export interface LLMRequest {
  system: string;
  messages: LLMMessage[];
  tools: LLMTool[];
  maxTokens?: number;
  /** Used by some providers to wire telemetry / cost attribution. */
  metadata?: Record<string, string>;
}

export interface LLMResponse {
  content: LLMAssistantContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "other";
  usage: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
  readonly name: string;
  complete(req: LLMRequest): Promise<LLMResponse>;
}
