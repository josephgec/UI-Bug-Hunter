import { describe, expect, it } from "vitest";
import { formatReport, score, type CaseRun } from "./scoring.js";

const caseOf = (id: string, expected: CaseRun["case"]["expectedCategories"]): CaseRun["case"] => ({
  id,
  fixture: `${id}.html`,
  description: id,
  expectedCategories: expected,
});

describe("scoring", () => {
  it("perfect run on a single-category case", () => {
    const runs: CaseRun[] = [
      {
        case: caseOf("a", ["visual_layout"]),
        reportedCategories: new Set(["visual_layout"]),
      },
    ];
    const r = score(runs);
    expect(r.visual_layout).toMatchObject({ truePositives: 1, falsePositives: 0, falseNegatives: 0 });
    expect(r.visual_layout.precision).toBe(1);
    expect(r.visual_layout.recall).toBe(1);
    expect(r.visual_layout.f1).toBe(1);
  });

  it("counts a false positive on a clean page", () => {
    const runs: CaseRun[] = [
      {
        case: { ...caseOf("clean", []), clean: true },
        reportedCategories: new Set(["accessibility"]),
      },
    ];
    const r = score(runs);
    expect(r.accessibility.falsePositives).toBe(1);
    expect(r.accessibility.precision).toBe(0);
  });

  it("counts a false negative when expected category missing", () => {
    const runs: CaseRun[] = [
      {
        case: caseOf("a", ["accessibility"]),
        reportedCategories: new Set(),
      },
    ];
    const r = score(runs);
    expect(r.accessibility.falseNegatives).toBe(1);
    expect(r.accessibility.recall).toBe(0);
  });

  it("aggregates an overall (micro) score across categories", () => {
    const runs: CaseRun[] = [
      {
        case: caseOf("a", ["visual_layout"]),
        reportedCategories: new Set(["visual_layout"]),
      },
      {
        case: caseOf("b", ["accessibility", "functional"]),
        reportedCategories: new Set(["accessibility"]),
      },
      {
        case: { ...caseOf("c", []), clean: true },
        reportedCategories: new Set(["content"]),
      },
    ];
    const r = score(runs);
    expect(r.overall.truePositives).toBe(2);
    expect(r.overall.falsePositives).toBe(1);
    expect(r.overall.falseNegatives).toBe(1);
    expect(r.overall.precision).toBeCloseTo(2 / 3, 5);
    expect(r.overall.recall).toBeCloseTo(2 / 3, 5);
    expect(r.overall.f1).toBeCloseTo(2 / 3, 5);
  });

  it("formatReport renders a non-empty table", () => {
    const r = score([
      { case: caseOf("a", ["visual_layout"]), reportedCategories: new Set(["visual_layout"]) },
    ]);
    const text = formatReport(r);
    expect(text).toContain("category");
    expect(text).toContain("visual_layout");
    expect(text).toContain("overall");
  });
});
