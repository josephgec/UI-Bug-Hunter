import { describe, expect, it } from "vitest";
import { FlowDefinitionSchema } from "./flows.js";

describe("FlowDefinitionSchema", () => {
  it("accepts a realistic login flow", () => {
    const r = FlowDefinitionSchema.parse({
      steps: [
        { kind: "goto", url: "https://staging.example.com/login" },
        { kind: "type", selector: "input#email", text: "{{credentials.user}}" },
        { kind: "type", selector: "input#password", text: "{{credentials.pass}}" },
        { kind: "click", selector: "button[type=submit]", postWaitMs: 500 },
        { kind: "wait", selector: "[data-testid=dashboard]", state: "visible" },
        { kind: "assert", urlMatches: "/dashboard" },
      ],
    });
    expect(r.steps).toHaveLength(6);
  });

  it("rejects empty steps", () => {
    expect(() => FlowDefinitionSchema.parse({ steps: [] })).toThrow();
  });

  it("rejects an unknown step kind", () => {
    expect(() =>
      FlowDefinitionSchema.parse({ steps: [{ kind: "swipe", selector: "x" }] }),
    ).toThrow();
  });

  it("wait requires exactly one of {selector, durationMs}", () => {
    expect(() =>
      FlowDefinitionSchema.parse({ steps: [{ kind: "wait" }] }),
    ).toThrow();
    expect(() =>
      FlowDefinitionSchema.parse({
        steps: [{ kind: "wait", selector: "x", durationMs: 500 }],
      }),
    ).toThrow();
  });

  it("assert requires at least one assertion clause", () => {
    expect(() =>
      FlowDefinitionSchema.parse({ steps: [{ kind: "assert" }] }),
    ).toThrow();
    expect(() =>
      FlowDefinitionSchema.parse({
        steps: [{ kind: "assert", textPresent: "Welcome" }],
      }),
    ).not.toThrow();
  });

  it("rejects non-URL goto", () => {
    expect(() =>
      FlowDefinitionSchema.parse({ steps: [{ kind: "goto", url: "not-a-url" }] }),
    ).toThrow();
  });

  it("rejects more than 50 steps", () => {
    const steps = Array.from({ length: 51 }, (_, i) => ({
      kind: "wait" as const,
      durationMs: 50,
    }));
    expect(() => FlowDefinitionSchema.parse({ steps })).toThrow();
  });
});
