import { describe, expect, it } from "vitest";
import { MockProvider } from "./mock.js";

describe("MockProvider", () => {
  const baseReq = { system: "x", messages: [], tools: [] };

  it("walks the script and returns an end_turn after exhaustion", async () => {
    const p = new MockProvider([
      { kind: "tool_use", name: "screenshot", input: {} },
      { kind: "tool_use", name: "get_console_logs", input: {} },
      { kind: "end" },
    ]);
    const r1 = await p.complete(baseReq);
    expect(r1.stopReason).toBe("tool_use");
    expect(r1.content[0]).toMatchObject({ type: "tool_use", name: "screenshot" });

    const r2 = await p.complete(baseReq);
    expect(r2.content[0]).toMatchObject({ type: "tool_use", name: "get_console_logs" });

    const r3 = await p.complete(baseReq);
    expect(r3.stopReason).toBe("end_turn");
  });

  it("emits unique tool_use ids across the script", async () => {
    const p = new MockProvider([
      { kind: "tool_use", name: "a", input: {} },
      { kind: "tool_use", name: "b", input: {} },
    ]);
    const r1 = await p.complete(baseReq);
    const r2 = await p.complete(baseReq);
    expect(r1.content[0]).toHaveProperty("id");
    expect(r2.content[0]).toHaveProperty("id");
    const id1 = (r1.content[0] as { id: string }).id;
    const id2 = (r2.content[0] as { id: string }).id;
    expect(id1).not.toBe(id2);
  });

  it("handles a text-only step without exploding", async () => {
    const p = new MockProvider([{ kind: "text", text: "hello" }]);
    const r = await p.complete(baseReq);
    expect(r.stopReason).toBe("end_turn");
    expect(r.content[0]).toEqual({ type: "text", text: "hello" });
  });

  it("defaultScanScript covers screenshot + console + network", () => {
    const script = MockProvider.defaultScanScript();
    const names = script
      .filter((s) => s.kind === "tool_use")
      .map((s) => s.name);
    expect(names).toContain("screenshot");
    expect(names).toContain("get_console_logs");
    expect(names).toContain("get_network_errors");
  });
});
