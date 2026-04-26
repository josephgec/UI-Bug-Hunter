import { describe, expect, it } from "vitest";
import { buildToolRegistry } from "./index.js";

// We don't drive Playwright in unit tests — the registry builder takes a
// session reference but the executors only invoke it lazily, so we can pass
// a stub and assert on the static structure.
const stubSession = {} as Parameters<typeof buildToolRegistry>[0];

describe("buildToolRegistry", () => {
  const reg = buildToolRegistry(stubSession);

  it("registers all expected tools by name", () => {
    const names = [...reg.keys()].sort();
    expect(names).toEqual(
      [
        "check_accessibility",
        "click",
        "get_console_logs",
        "get_dom",
        "get_network_errors",
        "goto",
        "report_bug",
        "screenshot",
        "scroll",
        "type",
      ].sort(),
    );
  });

  it("every tool has a non-empty description and JSON-schema-shaped inputSchema", () => {
    for (const [name, handler] of reg) {
      expect(handler.spec.description, `${name} description`).toBeTruthy();
      expect(handler.spec.inputSchema, `${name} inputSchema`).toMatchObject({ type: "object" });
    }
  });

  it("report_bug requires category, severity, confidence, title, description", () => {
    const reportBug = reg.get("report_bug");
    expect(reportBug).toBeTruthy();
    const schema = reportBug!.spec.inputSchema as { required?: string[] };
    expect(schema.required).toEqual(
      expect.arrayContaining(["category", "severity", "confidence", "title", "description"]),
    );
  });

  it("report_bug rejects out-of-range confidence", async () => {
    const reportBug = reg.get("report_bug");
    expect(reportBug).toBeTruthy();
    await expect(
      reportBug!.execute({
        category: "visual_layout",
        severity: "high",
        confidence: 2,
        title: "x",
        description: "y",
      }),
    ).rejects.toThrow();
  });

  it("report_bug rejects unknown category", async () => {
    const reportBug = reg.get("report_bug");
    await expect(
      reportBug!.execute({
        category: "nonsense",
        severity: "high",
        confidence: 0.5,
        title: "x",
        description: "y",
      }),
    ).rejects.toThrow();
  });

  it("report_bug accepts a valid finding and pushes onto session.reportedBugs", async () => {
    const session = { reportedBugs: [] } as unknown as Parameters<typeof buildToolRegistry>[0];
    const r = buildToolRegistry(session);
    const out = await r.get("report_bug")!.execute({
      category: "visual_layout",
      severity: "medium",
      confidence: 0.8,
      title: "Hero overlaps nav",
      description: "On scroll, the sticky nav covers the hero h1.",
      reproductionSteps: ["scroll to top", "observe overlap"],
    });
    expect(out).toMatchObject({ accepted: true, index: 1 });
    expect((session as { reportedBugs: unknown[] }).reportedBugs).toHaveLength(1);
  });
});
