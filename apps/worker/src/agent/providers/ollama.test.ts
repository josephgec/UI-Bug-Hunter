import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OllamaProvider } from "./ollama.js";
import type { LLMRequest } from "../llm.js";

describe("OllamaProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          model: "llama3.2-vision",
          message: { role: "assistant", content: "ok" },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 50,
          eval_count: 10,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    // @ts-expect-error overriding global fetch
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("translates a user message with text + image into Ollama's images array", async () => {
    const provider = new OllamaProvider("llama3.2-vision", "http://localhost:11434/");
    const req: LLMRequest = {
      system: "you are a tester",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look at this" },
            { type: "image", mediaType: "image/png", data: "BASE64DATA" },
          ],
        },
      ],
      tools: [
        {
          name: "screenshot",
          description: "take one",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    };
    await provider.complete(req);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    // Trailing slash on baseUrl is normalized away.
    expect(url).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("llama3.2-vision");
    expect(body.stream).toBe(false);
    // System prompt becomes a system message.
    expect(body.messages[0]).toEqual({ role: "system", content: "you are a tester" });
    // User message: text in content, image bytes in images[].
    expect(body.messages[1]).toEqual({
      role: "user",
      content: "look at this",
      images: ["BASE64DATA"],
    });
    // Tools translated to function shape.
    expect(body.tools[0]).toMatchObject({
      type: "function",
      function: { name: "screenshot", description: "take one" },
    });
    // Default ctx bump applied.
    expect(body.options.num_ctx).toBeGreaterThanOrEqual(8192);
  });

  it("translates assistant tool_use into Ollama's tool_calls", async () => {
    const provider = new OllamaProvider("llama3.2-vision");
    await provider.complete({
      system: "s",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "thinking" },
            {
              type: "tool_use",
              id: "abc",
              name: "goto",
              input: { url: "https://example.com" },
            },
          ],
        },
      ],
      tools: [],
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.messages[1]).toEqual({
      role: "assistant",
      content: "thinking",
      tool_calls: [
        { function: { name: "goto", arguments: { url: "https://example.com" } } },
      ],
    });
  });

  it("translates tool_result into a tool role message + image follow-up", async () => {
    const provider = new OllamaProvider("llama3.2-vision");
    await provider.complete({
      system: "s",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              toolUseId: "abc",
              content: [
                { type: "text", text: "page settled" },
                { type: "image", mediaType: "image/png", data: "PNGDATA" },
              ],
            },
          ],
        },
      ],
      tools: [],
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    // [system, tool, user-with-image]
    expect(body.messages).toHaveLength(3);
    expect(body.messages[1]).toMatchObject({ role: "tool" });
    expect(body.messages[1].content).toContain("page settled");
    expect(body.messages[2]).toMatchObject({ role: "user", images: ["PNGDATA"] });
  });

  it("synthesizes monotonic tool_use ids on the response side", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "x",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              { function: { name: "screenshot", arguments: { viewport: "desktop" } } },
              { function: { name: "get_console_logs", arguments: {} } },
            ],
          },
          done: true,
          done_reason: "stop",
        }),
        { status: 200 },
      ),
    );
    const provider = new OllamaProvider("llama3.2-vision");
    const r = await provider.complete({ system: "s", messages: [], tools: [] });
    // Stop reason promoted to tool_use even though Ollama said "stop".
    expect(r.stopReason).toBe("tool_use");
    expect(r.content).toHaveLength(2);
    const ids = r.content
      .filter((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use")
      .map((b) => b.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toMatch(/^ollama_/);
  });

  it("maps prompt_eval_count + eval_count into usage fields", async () => {
    const provider = new OllamaProvider("llama3.2-vision");
    const r = await provider.complete({ system: "s", messages: [], tools: [] });
    expect(r.usage).toEqual({ inputTokens: 50, outputTokens: 10 });
  });

  it("maps done_reason: length to max_tokens", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "x",
          message: { role: "assistant", content: "..." },
          done: true,
          done_reason: "length",
        }),
        { status: 200 },
      ),
    );
    const provider = new OllamaProvider("x");
    const r = await provider.complete({ system: "s", messages: [], tools: [] });
    expect(r.stopReason).toBe("max_tokens");
  });

  it("throws a descriptive error on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("model 'foo' not found", {
        status: 404,
        statusText: "Not Found",
      }),
    );
    const provider = new OllamaProvider("foo");
    await expect(provider.complete({ system: "s", messages: [], tools: [] })).rejects.toThrow(
      /Ollama 404/,
    );
  });

  it("omits the tools key when there are none", async () => {
    const provider = new OllamaProvider("x");
    await provider.complete({ system: "s", messages: [], tools: [] });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.tools).toBeUndefined();
  });
});
