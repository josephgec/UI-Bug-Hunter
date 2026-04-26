import { describe, expect, it, vi } from "vitest";
import type { LLMRequest } from "../llm.js";

// Mock the Anthropic SDK so we can inspect the translated request and stub the
// response. We assert on the shape passed to messages.create and on the
// translated LLMResponse.
const createSpy = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      public messages = { create: createSpy };
    },
  };
});

import { AnthropicProvider } from "./anthropic.js";

describe("AnthropicProvider", () => {
  it("translates request: tools to input_schema, mixed content blocks, tool_result", async () => {
    createSpy.mockResolvedValueOnce({
      content: [
        { type: "text", text: "thinking out loud" },
        { type: "tool_use", id: "t1", name: "screenshot", input: { viewport: "desktop" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const provider = new AnthropicProvider("claude-sonnet-4-6", "test-key");
    const req: LLMRequest = {
      system: "you are a tester",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "begin" },
            { type: "image", mediaType: "image/png", data: "AAA" },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "ok" },
            { type: "tool_use", id: "t0", name: "goto", input: { url: "https://example.com" } },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              toolUseId: "t0",
              content: [{ type: "text", text: "navigated" }],
            },
          ],
        },
      ],
      tools: [
        {
          name: "screenshot",
          description: "take a screenshot",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    };
    const res = await provider.complete(req);

    expect(createSpy).toHaveBeenCalledOnce();
    const args = createSpy.mock.calls[0][0];
    expect(args.tools[0]).toEqual({
      name: "screenshot",
      description: "take a screenshot",
      input_schema: { type: "object", properties: {} },
    });
    // First user message: text + image translated.
    expect(args.messages[0].content[0]).toEqual({ type: "text", text: "begin" });
    expect(args.messages[0].content[1]).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "AAA" },
    });
    // Assistant tool_use translated.
    expect(args.messages[1].content[1]).toMatchObject({
      type: "tool_use",
      id: "t0",
      name: "goto",
    });
    // Tool result translated.
    expect(args.messages[2].content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "t0",
      is_error: false,
    });

    // Response translated.
    expect(res.stopReason).toBe("tool_use");
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(res.content[0]).toEqual({ type: "text", text: "thinking out loud" });
    expect(res.content[1]).toMatchObject({ type: "tool_use", name: "screenshot" });
  });

  it("maps stop_reason variants to our enum", async () => {
    const cases: { native: string; mapped: string }[] = [
      { native: "end_turn", mapped: "end_turn" },
      { native: "tool_use", mapped: "tool_use" },
      { native: "max_tokens", mapped: "max_tokens" },
      { native: "stop_sequence", mapped: "other" },
    ];
    const provider = new AnthropicProvider("m", "k");
    for (const c of cases) {
      createSpy.mockResolvedValueOnce({
        content: [],
        stop_reason: c.native,
        usage: { input_tokens: 0, output_tokens: 0 },
      });
      const r = await provider.complete({ system: "", messages: [], tools: [] });
      expect(r.stopReason).toBe(c.mapped);
    }
  });
});
