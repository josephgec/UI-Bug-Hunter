import type {
  LLMAssistantContentBlock,
  LLMMessage,
  LLMProvider,
  LLMTool,
  LLMToolResultBlock,
  LLMUserContentBlock,
} from "./llm.js";
import type { ToolHandler, ToolRegistry } from "../tools/types.js";

export interface AgentBudget {
  maxToolCalls: number;
  maxWallTimeMs: number;
}

export interface AgentRunInput {
  provider: LLMProvider;
  tools: ToolRegistry;
  systemPrompt: string;
  initialUserMessage: LLMUserContentBlock[];
  budget: AgentBudget;
  onTrace?: (event: TraceEvent) => void;
}

export type TraceEvent =
  | { kind: "llm_response"; stopReason: string; toolUses: number }
  | { kind: "tool_use"; tool: string; input: Record<string, unknown> }
  | { kind: "tool_result"; tool: string; isError: boolean }
  | { kind: "budget_exhausted"; reason: "tool_calls" | "wall_time" }
  | { kind: "ended"; reason: string };

export interface AgentRunResult {
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  endedReason: "model_done" | "tool_calls_exhausted" | "wall_time_exhausted" | "no_progress";
}

export async function runAgentLoop(input: AgentRunInput): Promise<AgentRunResult> {
  const { provider, tools, budget, systemPrompt, onTrace } = input;
  const startedAt = Date.now();
  const llmTools: LLMTool[] = Array.from(tools.values()).map((t) => t.spec);
  const messages: LLMMessage[] = [
    { role: "user", content: input.initialUserMessage },
  ];

  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  while (true) {
    if (Date.now() - startedAt > budget.maxWallTimeMs) {
      onTrace?.({ kind: "budget_exhausted", reason: "wall_time" });
      return finish("wall_time_exhausted");
    }

    const response = await provider.complete({
      system: systemPrompt,
      messages,
      tools: llmTools,
    });
    inputTokens += response.usage.inputTokens;
    outputTokens += response.usage.outputTokens;

    const toolUses = response.content.filter(
      (b): b is Extract<LLMAssistantContentBlock, { type: "tool_use" }> =>
        b.type === "tool_use",
    );
    onTrace?.({
      kind: "llm_response",
      stopReason: response.stopReason,
      toolUses: toolUses.length,
    });

    messages.push({ role: "assistant", content: response.content });

    if (toolUses.length === 0) {
      // Model produced text only — natural end of turn.
      onTrace?.({ kind: "ended", reason: "model_done" });
      return finish("model_done");
    }

    // Execute every tool_use the model emitted in this turn, in order.
    const results: LLMToolResultBlock[] = [];
    for (const use of toolUses) {
      if (toolCalls >= budget.maxToolCalls) {
        onTrace?.({ kind: "budget_exhausted", reason: "tool_calls" });
        results.push({
          type: "tool_result",
          toolUseId: use.id,
          content: [
            {
              type: "text",
              text: "Tool-call budget exhausted. Wrap up and report any remaining findings.",
            },
          ],
          isError: true,
        });
        continue;
      }
      const handler = tools.get(use.name) as ToolHandler<unknown, unknown> | undefined;
      if (!handler) {
        onTrace?.({ kind: "tool_result", tool: use.name, isError: true });
        results.push({
          type: "tool_result",
          toolUseId: use.id,
          content: [{ type: "text", text: `Unknown tool: ${use.name}` }],
          isError: true,
        });
        continue;
      }

      onTrace?.({ kind: "tool_use", tool: use.name, input: use.input });
      toolCalls += 1;
      try {
        const out = await handler.execute(use.input);
        const formatted = handler.formatResult(out);
        results.push({
          type: "tool_result",
          toolUseId: use.id,
          content: formatted,
          isError: false,
        });
        onTrace?.({ kind: "tool_result", tool: use.name, isError: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          type: "tool_result",
          toolUseId: use.id,
          content: [{ type: "text", text: `Tool error: ${message}` }],
          isError: true,
        });
        onTrace?.({ kind: "tool_result", tool: use.name, isError: true });
      }
    }

    messages.push({ role: "user", content: results });

    if (toolCalls >= budget.maxToolCalls) {
      // Give the model one final turn to summarize before we hard-stop.
      const wrap = await provider.complete({
        system: systemPrompt,
        messages,
        tools: llmTools,
      });
      inputTokens += wrap.usage.inputTokens;
      outputTokens += wrap.usage.outputTokens;
      messages.push({ role: "assistant", content: wrap.content });
      onTrace?.({ kind: "ended", reason: "tool_calls_exhausted" });
      return finish("tool_calls_exhausted");
    }
  }

  function finish(reason: AgentRunResult["endedReason"]): AgentRunResult {
    return { toolCalls, inputTokens, outputTokens, endedReason: reason };
  }
}
