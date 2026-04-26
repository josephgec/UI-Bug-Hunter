import type { LLMImageBlock, LLMTextBlock, LLMTool } from "../agent/llm.js";

export interface ToolHandler<Input, Output> {
  spec: LLMTool;
  execute(input: Input): Promise<Output>;
  formatResult(output: Output): Array<LLMTextBlock | LLMImageBlock>;
}

export type ToolRegistry = Map<string, ToolHandler<unknown, unknown>>;
