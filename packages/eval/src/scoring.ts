import { BUG_CATEGORIES, type BugCategory } from "@ubh/shared";
import type { CategoryScore, EvalCase, ScoreReport } from "./types.js";

export interface CaseRun {
  case: EvalCase;
  reportedCategories: Set<BugCategory>;
  // Confidence is post-threshold (anything below 0.6 is considered "not shown").
}

export function score(runs: CaseRun[]): ScoreReport {
  const init: () => CategoryScore = () => ({
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    precision: 0,
    recall: 0,
    f1: 0,
  });
  const report: Record<string, CategoryScore> = {
    overall: init(),
  };
  for (const cat of BUG_CATEGORIES) report[cat] = init();

  for (const run of runs) {
    const expected = new Set(run.case.expectedCategories);
    const got = run.reportedCategories;

    for (const cat of BUG_CATEGORIES) {
      const e = expected.has(cat);
      const g = got.has(cat);
      const cell = report[cat]!;
      if (e && g) cell.truePositives += 1;
      else if (!e && g) cell.falsePositives += 1;
      else if (e && !g) cell.falseNegatives += 1;
    }
  }

  // Aggregate overall (micro-average).
  for (const cat of BUG_CATEGORIES) {
    report.overall!.truePositives += report[cat]!.truePositives;
    report.overall!.falsePositives += report[cat]!.falsePositives;
    report.overall!.falseNegatives += report[cat]!.falseNegatives;
  }
  for (const key of Object.keys(report)) {
    finalize(report[key]!);
  }
  return report as ScoreReport;
}

function finalize(s: CategoryScore): void {
  s.precision = s.truePositives + s.falsePositives === 0
    ? 1
    : s.truePositives / (s.truePositives + s.falsePositives);
  s.recall = s.truePositives + s.falseNegatives === 0
    ? 1
    : s.truePositives / (s.truePositives + s.falseNegatives);
  s.f1 = s.precision + s.recall === 0
    ? 0
    : (2 * s.precision * s.recall) / (s.precision + s.recall);
}

export function formatReport(report: ScoreReport): string {
  const rows: string[] = [];
  rows.push("category            tp  fp  fn   prec  recall    f1");
  rows.push("──────────────────  ──  ──  ──  ─────  ──────  ────");
  for (const key of Object.keys(report)) {
    const s = report[key as keyof ScoreReport];
    rows.push(
      `${key.padEnd(18)}  ${pad(s.truePositives)}  ${pad(s.falsePositives)}  ${pad(s.falseNegatives)}  ${s.precision.toFixed(3)}   ${s.recall.toFixed(3)}   ${s.f1.toFixed(2)}`,
    );
  }
  return rows.join("\n");
}

function pad(n: number): string {
  return n.toString().padStart(2, " ");
}
