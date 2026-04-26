import type { EvalCase } from "./types.js";

// The seed dataset is intentionally small (Phase 1, week 4 calls for 50 hand-
// curated pages — we get there iteratively). Each fixture HTML lives under
// packages/eval/fixtures/. The serve-fixtures script hosts them on
// http://localhost:4173 so the worker can scan them like any other URL.
export const SEED_CASES: EvalCase[] = [
  {
    id: "clean-001",
    fixture: "clean.html",
    description: "Plain, valid landing page. No bugs.",
    expectedCategories: [],
    clean: true,
  },
  {
    id: "console-error-001",
    fixture: "console-error.html",
    description: "Inline script throws an uncaught TypeError on load.",
    expectedCategories: ["functional"],
  },
  {
    id: "missing-alt-001",
    fixture: "missing-alt.html",
    description: "Hero image missing alt text; axe should flag it.",
    expectedCategories: ["accessibility"],
  },
  {
    id: "broken-image-001",
    fixture: "broken-image.html",
    description: "Image src returns 404.",
    expectedCategories: ["visual_layout"],
  },
  {
    id: "low-contrast-001",
    fixture: "low-contrast.html",
    description: "Body text on background fails WCAG AA contrast.",
    expectedCategories: ["accessibility", "visual_layout"],
  },
  {
    id: "clipped-text-001",
    fixture: "clipped-text.html",
    description: "Card title overflows its fixed-width container with overflow:hidden.",
    expectedCategories: ["visual_layout"],
  },
  {
    id: "templating-001",
    fixture: "broken-templating.html",
    description: "Unrendered handlebars-style {{user_name}} placeholder.",
    expectedCategories: ["content"],
  },
];
