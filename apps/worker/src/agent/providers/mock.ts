import type {
  LLMAssistantContentBlock,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from "../llm.js";

// Scripted provider for end-to-end tests without burning API credits. The
// "script" is a sequence of canned tool-use blocks; once exhausted the
// provider returns end_turn. Useful as a smoke-test default and as a way to
// pin agent-loop behavior in unit tests.
export interface MockStep {
  kind: "tool_use" | "text" | "end";
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
}

export class MockProvider implements LLMProvider {
  readonly name = "mock";
  private cursor = 0;
  private toolUseCounter = 0;

  constructor(private readonly script: MockStep[]) {}

  // Default script for smoke tests: navigate, screenshot the desktop viewport,
  // ask for the console log, then end.
  static defaultScanScript(): MockStep[] {
    return [
      { kind: "text", text: "Plan: capture initial state, then check console + a11y." },
      { kind: "tool_use", name: "screenshot", input: { viewport: "desktop", fullPage: false } },
      { kind: "tool_use", name: "get_console_logs", input: {} },
      { kind: "tool_use", name: "get_network_errors", input: {} },
      { kind: "end" },
    ];
  }

  async complete(_req: LLMRequest): Promise<LLMResponse> {
    const step = this.script[this.cursor++];
    if (!step || step.kind === "end") {
      return {
        content: [{ type: "text", text: "Done." }],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    if (step.kind === "text") {
      return {
        content: [{ type: "text", text: step.text ?? "" }],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    const block: LLMAssistantContentBlock = {
      type: "tool_use",
      id: `mock_${++this.toolUseCounter}`,
      name: step.name ?? "screenshot",
      input: step.input ?? {},
    };
    return {
      content: [block],
      stopReason: "tool_use",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
