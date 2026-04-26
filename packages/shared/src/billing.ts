import { PLAN_LIMITS, type Plan } from "./types.js";

export type QuotaCheckResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: "hard_cap_exceeded" | "would_exceed_hard_cap"; remaining: number }
  | { ok: false; reason: "overage"; remaining: number; overageUnits: number };

/**
 * Decide whether a scan request can be admitted given the org's current plan
 * and quota usage. "units" is the number of scan-units the request would
 * consume (pages × viewports for a crawl, viewports for a single-page scan).
 *
 * - On a hardCap plan (Free), reject if the request would exceed the cap.
 * - On a soft-cap plan (Team / Business / Enterprise), admit and return the
 *   number of overage units to bill.
 */
export function checkQuota(input: {
  plan: Plan;
  quotaUsed: number;
  quotaLimit: number;
  units: number;
}): QuotaCheckResult {
  const limits = PLAN_LIMITS[input.plan];
  const remaining = Math.max(0, input.quotaLimit - input.quotaUsed);

  if (limits.hardCap !== null) {
    // Free tier: hard cap, no overage.
    if (input.quotaUsed >= input.quotaLimit) {
      return { ok: false, reason: "hard_cap_exceeded", remaining: 0 };
    }
    if (input.quotaUsed + input.units > input.quotaLimit) {
      return { ok: false, reason: "would_exceed_hard_cap", remaining };
    }
    return { ok: true, remaining: remaining - input.units };
  }

  // Soft cap: admit, but report overage if applicable.
  const newUsage = input.quotaUsed + input.units;
  if (newUsage <= input.quotaLimit) {
    return { ok: true, remaining: input.quotaLimit - newUsage };
  }
  const overageUnits = newUsage - Math.max(input.quotaUsed, input.quotaLimit);
  return { ok: false, reason: "overage", remaining: 0, overageUnits };
}

export function scanUnitsFor(input: {
  pages: number;
  viewports: number;
}): number {
  return Math.max(1, input.pages) * Math.max(1, input.viewports);
}

/**
 * Threshold checks for "send an 80% used email" / "send a 100% used email".
 * Returns the threshold crossed (if any) given the previous and new usage.
 */
export function quotaThresholdCrossed(
  previousUsed: number,
  newUsed: number,
  limit: number,
): "80" | "100" | null {
  if (limit <= 0) return null;
  const wasBelow80 = previousUsed / limit < 0.8;
  const wasBelow100 = previousUsed / limit < 1.0;
  if (wasBelow100 && newUsed >= limit) return "100";
  if (wasBelow80 && newUsed / limit >= 0.8) return "80";
  return null;
}
