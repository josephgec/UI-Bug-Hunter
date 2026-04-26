import type { BugCategory } from "@ubh/shared";

// One row of the eval set. `expectedCategories` is the set of categories at
// least one bug should be reported for; we can extend to per-bug labels later
// once we have enough data to make the scoring richer than "did the agent
// notice this kind of problem on this page".
export interface EvalCase {
  id: string;
  fixture: string; // file path relative to packages/eval/fixtures
  description: string;
  expectedCategories: BugCategory[];
  /** True if the page is intentionally clean — any reported bug is a false positive. */
  clean?: boolean;
}

export interface CategoryScore {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export type ScoreReport = Record<BugCategory | "overall", CategoryScore>;
