import { SEVERITIES, type Severity } from "@ubh/shared";

const SEVERITY_RANK: Record<Severity, number> = SEVERITIES.reduce(
  (acc, s, i) => Object.assign(acc, { [s]: i }),
  {} as Record<Severity, number>,
);

/**
 * Pure routing decision: should a destination with `destinationAutoSeverity`
 * receive a finding of `findingSeverity`? Lifted out of dispatcher.ts so it
 * can be unit-tested without pulling in Prisma at import time.
 */
export function autoDispatchAllowed(
  destinationAutoSeverity: string | null,
  findingSeverity: Severity,
): boolean {
  if (!destinationAutoSeverity) return false;
  const threshold = SEVERITY_RANK[destinationAutoSeverity as Severity];
  if (threshold === undefined) return false;
  return SEVERITY_RANK[findingSeverity] <= threshold;
}
