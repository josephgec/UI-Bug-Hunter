import type { LLMProvider } from "../llm.js";
import { AnthropicProvider } from "./anthropic.js";
import { MockProvider } from "./mock.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAIProvider } from "./openai.js";

export type ProviderKind = "mock" | "anthropic" | "openai" | "ollama";

export function createProvider(): LLMProvider {
  const kind = (process.env.LLM_PROVIDER ?? "mock").toLowerCase() as ProviderKind;
  const model = process.env.LLM_MODEL ?? defaultModelFor(kind);
  switch (kind) {
    case "anthropic":
      return new AnthropicProvider(model);
    case "openai":
      return new OpenAIProvider(model);
    case "ollama":
      return new OllamaProvider(model);
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
    case "ollama":
      // Vision + tool calling. Pull with `ollama pull llama3.2-vision`.
      return "llama3.2-vision";
    default:
      return "mock";
  }
}

export { AnthropicProvider, MockProvider, OllamaProvider, OpenAIProvider };
