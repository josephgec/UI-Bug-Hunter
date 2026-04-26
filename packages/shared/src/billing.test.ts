import { describe, expect, it } from "vitest";
import { checkQuota, quotaThresholdCrossed, scanUnitsFor } from "./billing.js";

describe("scanUnitsFor", () => {
  it("multiplies pages × viewports", () => {
    expect(scanUnitsFor({ pages: 10, viewports: 3 })).toBe(30);
  });
  it("clamps zero / negative inputs to 1", () => {
    expect(scanUnitsFor({ pages: 0, viewports: 0 })).toBe(1);
    expect(scanUnitsFor({ pages: -5, viewports: 1 })).toBe(1);
  });
});

describe("checkQuota — Free (hard cap)", () => {
  it("admits a request fully within quota", () => {
    const r = checkQuota({ plan: "free", quotaUsed: 5, quotaLimit: 25, units: 3 });
    expect(r).toEqual({ ok: true, remaining: 17 });
  });
  it("rejects when already at the cap", () => {
    const r = checkQuota({ plan: "free", quotaUsed: 25, quotaLimit: 25, units: 1 });
    expect(r).toMatchObject({ ok: false, reason: "hard_cap_exceeded" });
  });
  it("rejects when the request would exceed the cap", () => {
    const r = checkQuota({ plan: "free", quotaUsed: 24, quotaLimit: 25, units: 5 });
    expect(r).toMatchObject({ ok: false, reason: "would_exceed_hard_cap", remaining: 1 });
  });
});

describe("checkQuota — Team (soft cap)", () => {
  it("admits within quota with remaining", () => {
    const r = checkQuota({ plan: "team", quotaUsed: 100, quotaLimit: 1000, units: 50 });
    expect(r).toEqual({ ok: true, remaining: 850 });
  });
  it("reports overage when exceeding", () => {
    const r = checkQuota({ plan: "team", quotaUsed: 990, quotaLimit: 1000, units: 25 });
    if (r.ok || r.reason !== "overage") throw new Error("expected overage");
    expect(r.overageUnits).toBe(15);
  });
  it("counts overage from the existing usage when already over", () => {
    const r = checkQuota({ plan: "team", quotaUsed: 1100, quotaLimit: 1000, units: 30 });
    if (r.ok || r.reason !== "overage") throw new Error("expected overage");
    expect(r.overageUnits).toBe(30);
  });
});

describe("quotaThresholdCrossed", () => {
  it("returns 80 when crossing the 80% line", () => {
    expect(quotaThresholdCrossed(700, 850, 1000)).toBe("80");
  });
  it("returns 100 when crossing the limit", () => {
    expect(quotaThresholdCrossed(950, 1100, 1000)).toBe("100");
  });
  it("returns 100 if both 80 and 100 are crossed in one step (100 wins)", () => {
    expect(quotaThresholdCrossed(0, 1000, 1000)).toBe("100");
  });
  it("returns null if no threshold crossed", () => {
    expect(quotaThresholdCrossed(100, 200, 1000)).toBeNull();
  });
  it("returns null on zero limit", () => {
    expect(quotaThresholdCrossed(5, 10, 0)).toBeNull();
  });
});
