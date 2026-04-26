import type { LLMProvider } from "../llm.js";
import { AnthropicProvider } from "./anthropic.js";
import { MockProvider } from "./mock.js";
import { OpenAIProvider } from "./openai.js";

export type ProviderKind = "mock" | "anthropic" | "openai";

export function createProvider(): LLMProvider {
  const kind = (process.env.LLM_PROVIDER ?? "mock").toLowerCase() as ProviderKind;
  const model = process.env.LLM_MODEL ?? defaultModelFor(kind);
  switch (kind) {
    case "anthropic":
      return new AnthropicProvider(model);
    case "openai":
      return new OpenAIProvider(model);
    case "mock":
      return new MockProvider(MockProvider.defaultScanScript());
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${kind}`);
  }
}

function defaultModelFor(kind: ProviderKind): string {
  switch (kind) {
    case "anthropic":
      return "claude-sonnet-4-6";
    case "openai":
      return "gpt-4o";
    default:
      return "mock";
  }
}

export { AnthropicProvider, OpenAIProvider, MockProvider };
