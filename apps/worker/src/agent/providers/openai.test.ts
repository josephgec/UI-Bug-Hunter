import { describe, expect, it, vi } from "vitest";

const createSpy = vi.fn();
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      public chat = { completions: { create: createSpy } };
    },
  };
});

import { OpenAIProvider } from "./openai.js";
import type { LLMRequest } from "../llm.js";

describe("OpenAIProvider", () => {
  it("translates an assistant tool_use into a tool_calls function entry", async () => {
    createSpy.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: "preface",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "screenshot", arguments: '{"viewport":"desktop"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    });

    const provider = new OpenAIProvider("gpt-4o", "k");
    const req: LLMRequest = {
      system: "sys",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "thinking" },
            { type: "tool_use", id: "x", name: "goto", input: { url: "https://example.com" } },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              toolUseId: "x",
              content: [
                { type: "text", text: "ok" },
                { type: "image", mediaType: "image/png", data: "ZZZ" },
              ],
            },
          ],
        },
      ],
      tools: [
        {
          name: "screenshot",
          description: "shot",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    };
    const res = await provider.complete(req);

    expect(createSpy).toHaveBeenCalledOnce();
    const args = createSpy.mock.calls[0][0];
    // System prepended.
    expect(args.messages[0]).toEqual({ role: "system", content: "sys" });
    // Assistant message holds text + a function tool_call.
    expect(args.messages[1].role).toBe("assistant");
    expect(args.messages[1].tool_calls[0]).toMatchObject({
      id: "x",
      type: "function",
      function: { name: "goto" },
    });
    // tool_result translated to a tool message, image emitted as a follow-up user message.
    const tool = args.messages.find((m: { role: string }) => m.role === "tool");
    expect(tool).toBeTruthy();
    const userImage = args.messages.find(
      (m: { role: string; content: unknown }) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        (m.content as { type: string }[]).some((c) => c.type === "image_url"),
    );
    expect(userImage).toBeTruthy();

    // Response translation: text + tool_use, both populated, usage mapped.
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
    expect(res.stopReason).toBe("tool_use");
    expect(res.content.find((b) => b.type === "text")).toMatchObject({
      type: "text",
      text: "preface",
    });
    expect(res.content.find((b) => b.type === "tool_use")).toMatchObject({
      type: "tool_use",
      name: "screenshot",
      input: { viewport: "desktop" },
    });
  });

  it("survives malformed tool-call JSON arguments", async () => {
    createSpy.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "screenshot", arguments: "{not json" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const provider = new OpenAIProvider("gpt-4o", "k");
    const r = await provider.complete({ system: "", messages: [], tools: [] });
    const toolUse = r.content.find((b) => b.type === "tool_use");
    expect(toolUse).toMatchObject({ name: "screenshot", input: {} });
  });

  it("maps finish_reason variants", async () => {
    const cases: { native: string; mapped: string }[] = [
      { native: "stop", mapped: "end_turn" },
      { native: "tool_calls", mapped: "tool_use" },
      { native: "length", mapped: "max_tokens" },
      { native: "content_filter", mapped: "other" },
    ];
    const provider = new OpenAIProvider("gpt-4o", "k");
    for (const c of cases) {
      createSpy.mockResolvedValueOnce({
        choices: [{ message: { content: "x" }, finish_reason: c.native }],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      });
      const r = await provider.complete({ system: "", messages: [], tools: [] });
      expect(r.stopReason).toBe(c.mapped);
    }
  });
});
