import type { BugCategory, Severity } from "./types.js";

// Pure-logic reducers over finding rows. The web app's aggregation routes
// fetch the raw rows from Postgres and pass them through these — keeping the
// logic here means we can unit-test it against fixtures without spinning up a
// database.

export interface FindingRow {
  id: string;
  projectId: string;
  scanId: string;
  category: BugCategory;
  severity: Severity;
  confidence: number;
  createdAt: Date;
}

export interface OrgAggregation {
  total: number;
  byCategory: Record<BugCategory, number>;
  bySeverity: Record<Severity, number>;
  byProject: Record<string, { total: number; bySeverity: Record<Severity, number> }>;
}

export function aggregateFindings(rows: FindingRow[], minConfidence = 0.6): OrgAggregation {
  const out: OrgAggregation = {
    total: 0,
    byCategory: { visual_layout: 0, functional: 0, content: 0, accessibility: 0 },
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    byProject: {},
  };
  for (const row of rows) {
    if (row.confidence < minConfidence) continue;
    out.total += 1;
    out.byCategory[row.category] = (out.byCategory[row.category] ?? 0) + 1;
    out.bySeverity[row.severity] = (out.bySeverity[row.severity] ?? 0) + 1;
    const proj = (out.byProject[row.projectId] ??= {
      total: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    });
    proj.total += 1;
    proj.bySeverity[row.severity] += 1;
  }
  return out;
}

export type Bucket = "day" | "week";

export interface TrendPoint {
  bucket: string; // ISO date for "day", ISO Monday for "week"
  total: number;
  bySeverity: Record<Severity, number>;
}

/**
 * Bucket finding rows into a time series. The result includes every bucket
 * between the earliest and latest row inclusive — even ones with zero
 * findings — so the dashboard can draw a continuous line without gaps.
 */
export function trendOverTime(
  rows: FindingRow[],
  bucket: Bucket,
  minConfidence = 0.6,
): TrendPoint[] {
  const filtered = rows.filter((r) => r.confidence >= minConfidence);
  if (filtered.length === 0) return [];

  const points = new Map<string, TrendPoint>();
  for (const row of filtered) {
    const key = bucketKey(row.createdAt, bucket);
    const point = points.get(key) ?? {
      bucket: key,
      total: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    };
    point.total += 1;
    point.bySeverity[row.severity] += 1;
    points.set(key, point);
  }

  // Fill in zero buckets between min and max.
  const sorted = [...points.keys()].sort();
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const filled: TrendPoint[] = [];
  let cursor = first;
  let safety = 366; // 1 year of days max
  while (safety-- > 0) {
    filled.push(
      points.get(cursor) ?? {
        bucket: cursor,
        total: 0,
        bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      },
    );
    if (cursor === last) break;
    cursor = nextBucket(cursor, bucket);
  }
  return filled;
}

function bucketKey(d: Date, bucket: Bucket): string {
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (bucket === "day") return utc.toISOString().slice(0, 10);
  // week: bucket to the Monday of the week (UTC).
  const day = utc.getUTCDay();
  const diff = (day + 6) % 7; // days since Monday
  utc.setUTCDate(utc.getUTCDate() - diff);
  return utc.toISOString().slice(0, 10);
}

function nextBucket(key: string, bucket: Bucket): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (bucket === "day" ? 1 : 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Top N regressions for the week: projects whose finding count has grown the
 * most relative to the prior period.
 */
export function topRegressions(
  current: FindingRow[],
  prior: FindingRow[],
  topN = 5,
  minConfidence = 0.6,
): { projectId: string; current: number; prior: number; delta: number }[] {
  const tally = (rows: FindingRow[]) => {
    const out = new Map<string, number>();
    for (const r of rows) {
      if (r.confidence < minConfidence) continue;
      out.set(r.projectId, (out.get(r.projectId) ?? 0) + 1);
    }
    return out;
  };
  const cur = tally(current);
  const pri = tally(prior);
  const all = new Set<string>([...cur.keys(), ...pri.keys()]);
  return [...all]
    .map((projectId) => {
      const c = cur.get(projectId) ?? 0;
      const p = pri.get(projectId) ?? 0;
      return { projectId, current: c, prior: p, delta: c - p };
    })
    .sort((a, b) => b.delta - a.delta)
    .slice(0, topN);
}
