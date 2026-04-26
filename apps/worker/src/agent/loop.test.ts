import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "./loop.js";
import type { LLMProvider, LLMRequest, LLMResponse } from "./llm.js";
import type { ToolHandler, ToolRegistry } from "../tools/types.js";

// A scripted provider that returns a queue of responses in order.
function scripted(...responses: LLMResponse[]): LLMProvider {
  let cursor = 0;
  return {
    name: "test",
    async complete(_req: LLMRequest): Promise<LLMResponse> {
      const next = responses[cursor++];
      if (!next) {
        return {
          content: [{ type: "text", text: "done" }],
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }
      return next;
    },
  };
}

function noopTool(name: string, executeImpl?: () => Promise<unknown>): ToolHandler<unknown, unknown> {
  return {
    spec: { name, description: name, inputSchema: { type: "object" } },
    async execute() {
      return executeImpl ? executeImpl() : { ok: true };
    },
    formatResult() {
      return [{ type: "text", text: `${name} ran` }];
    },
  };
}

function registry(...handlers: ToolHandler<unknown, unknown>[]): ToolRegistry {
  const m: ToolRegistry = new Map();
  for (const h of handlers) m.set(h.spec.name, h);
  return m;
}

const baseInput = {
  systemPrompt: "system",
  initialUserMessage: [{ type: "text" as const, text: "hello" }],
  budget: { maxToolCalls: 10, maxWallTimeMs: 5000 },
};

describe("runAgentLoop", () => {
  it("returns immediately when the first turn has no tool uses", async () => {
    const provider = scripted({
      content: [{ type: "text", text: "nothing to do" }],
      stopReason: "end_turn",
      usage: { inputTokens: 5, outputTokens: 3 },
    });
    const result = await runAgentLoop({
      ...baseInput,
      provider,
      tools: registry(),
    });
    expect(result.endedReason).toBe("model_done");
    expect(result.toolCalls).toBe(0);
    expect(result.inputTokens).toBe(5);
    expect(result.outputTokens).toBe(3);
  });

  it("dispatches a tool_use, feeds the result back, and ends on next turn", async () => {
    const provider = scripted(
      {
        content: [{ type: "tool_use", id: "1", name: "noop", input: {} }],
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        content: [{ type: "text", text: "ok done" }],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    );
    const tool = noopTool("noop");
    const spy = vi.spyOn(tool, "execute");
    const result = await runAgentLoop({
      ...baseInput,
      provider,
      tools: registry(tool),
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(result.toolCalls).toBe(1);
    expect(result.endedReason).toBe("model_done");
  });

  it("returns an error tool_result when the named tool isn't registered", async () => {
    const provider = scripted(
      {
        content: [{ type: "tool_use", id: "1", name: "nonexistent", input: {} }],
        stopReason: "tool_use",
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      {
        content: [{ type: "text", text: "giving up" }],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    );
    const events: string[] = [];
    const result = await runAgentLoop({
      ...baseInput,
      provider,
      tools: registry(),
      onTrace: (e) => {
        if (e.kind === "tool_result") events.push(`${e.tool}:${e.isError}`);
      },
    });
    expect(events).toContain("nonexistent:true");
    expect(result.endedReason).toBe("model_done");
  });

  it("propagates tool execution errors as is_error tool_results", async () => {
    const provider = scripted(
      {
        content: [{ type: "tool_use", id: "1", name: "boom", input: {} }],
        stopReason: "tool_use",
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      {
        content: [{ type: "text", text: "k" }],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    );
    const tool = noopTool("boom", async () => {
      throw new Error("kaboom");
    });
    const events: { tool: string; isError: boolean }[] = [];
    await runAgentLoop({
      ...baseInput,
      provider,
      tools: registry(tool),
      onTrace: (e) => {
        if (e.kind === "tool_result") events.push({ tool: e.tool, isError: e.isError });
      },
    });
    expect(events).toContainEqual({ tool: "boom", isError: true });
  });

  it("hard-stops on tool-call budget exhaustion", async () => {
    const provider: LLMProvider = {
      name: "loop",
      async complete() {
        return {
          content: [{ type: "tool_use", id: `t${Math.random()}`, name: "noop", input: {} }],
          stopReason: "tool_use",
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    };
    const result = await runAgentLoop({
      ...baseInput,
      provider,
      tools: registry(noopTool("noop")),
      budget: { maxToolCalls: 3, maxWallTimeMs: 5000 },
    });
    expect(result.endedReason).toBe("tool_calls_exhausted");
    expect(result.toolCalls).toBe(3);
  });

  it("hard-stops on wall-time exhaustion before the next provider call", async () => {
    const provider: LLMProvider = {
      name: "slow",
      async complete() {
        await new Promise((r) => setTimeout(r, 30));
        return {
          content: [{ type: "tool_use", id: "t", name: "noop", input: {} }],
          stopReason: "tool_use",
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    };
    const result = await runAgentLoop({
      ...baseInput,
      provider,
      tools: registry(noopTool("noop")),
      budget: { maxToolCalls: 100, maxWallTimeMs: 50 },
    });
    expect(result.endedReason).toBe("wall_time_exhausted");
  });
});
