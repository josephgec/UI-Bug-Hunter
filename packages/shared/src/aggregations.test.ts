import { describe, expect, it } from "vitest";
import {
  aggregateFindings,
  topRegressions,
  trendOverTime,
  type FindingRow,
} from "./aggregations.js";

const row = (over: Partial<FindingRow>): FindingRow => ({
  id: "f",
  projectId: "p1",
  scanId: "s1",
  category: "visual_layout",
  severity: "medium",
  confidence: 0.8,
  createdAt: new Date("2026-04-01T10:00:00Z"),
  ...over,
});

describe("aggregateFindings", () => {
  it("counts category and severity buckets", () => {
    const r = aggregateFindings([
      row({ id: "1", category: "visual_layout", severity: "critical" }),
      row({ id: "2", category: "visual_layout", severity: "high" }),
      row({ id: "3", category: "accessibility", severity: "low" }),
    ]);
    expect(r.total).toBe(3);
    expect(r.byCategory.visual_layout).toBe(2);
    expect(r.byCategory.accessibility).toBe(1);
    expect(r.bySeverity.critical).toBe(1);
    expect(r.bySeverity.high).toBe(1);
    expect(r.bySeverity.low).toBe(1);
  });

  it("filters out below minConfidence", () => {
    const r = aggregateFindings(
      [row({ confidence: 0.4 }), row({ confidence: 0.7 })],
      0.6,
    );
    expect(r.total).toBe(1);
  });

  it("breaks down by project", () => {
    const r = aggregateFindings([
      row({ projectId: "alpha", severity: "high" }),
      row({ projectId: "alpha", severity: "low" }),
      row({ projectId: "beta", severity: "critical" }),
    ]);
    expect(r.byProject.alpha?.total).toBe(2);
    expect(r.byProject.beta?.total).toBe(1);
    expect(r.byProject.alpha?.bySeverity.high).toBe(1);
    expect(r.byProject.beta?.bySeverity.critical).toBe(1);
  });
});

describe("trendOverTime", () => {
  it("buckets by day and fills gaps with zero", () => {
    const r = trendOverTime(
      [
        row({ id: "1", createdAt: new Date("2026-04-01T10:00:00Z") }),
        row({ id: "2", createdAt: new Date("2026-04-03T10:00:00Z") }),
      ],
      "day",
    );
    expect(r).toHaveLength(3);
    expect(r[0]!.bucket).toBe("2026-04-01");
    expect(r[0]!.total).toBe(1);
    expect(r[1]!.bucket).toBe("2026-04-02");
    expect(r[1]!.total).toBe(0);
    expect(r[2]!.bucket).toBe("2026-04-03");
    expect(r[2]!.total).toBe(1);
  });

  it("buckets by week (Monday)", () => {
    // 2026-04-01 is a Wednesday — week bucket should be 2026-03-30 (Monday).
    const r = trendOverTime(
      [row({ id: "1", createdAt: new Date("2026-04-01T10:00:00Z") })],
      "week",
    );
    expect(r[0]!.bucket).toBe("2026-03-30");
  });

  it("returns empty when there are no qualifying rows", () => {
    expect(trendOverTime([row({ confidence: 0.1 })], "day")).toEqual([]);
  });
});

describe("topRegressions", () => {
  it("ranks by largest delta first", () => {
    const current: FindingRow[] = [
      row({ projectId: "a" }),
      row({ projectId: "a" }),
      row({ projectId: "a" }),
      row({ projectId: "b" }),
    ];
    const prior: FindingRow[] = [row({ projectId: "a" }), row({ projectId: "b" })];
    const r = topRegressions(current, prior);
    expect(r[0]!.projectId).toBe("a");
    expect(r[0]!.delta).toBe(2);
    expect(r[1]!.projectId).toBe("b");
    expect(r[1]!.delta).toBe(0);
  });

  it("includes projects that exist only in current with delta = current count", () => {
    const r = topRegressions([row({ projectId: "new" })], []);
    expect(r[0]).toEqual({ projectId: "new", current: 1, prior: 0, delta: 1 });
  });
});
