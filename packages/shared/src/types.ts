import { z } from "zod";

// Bug taxonomy — matches §3 of the design doc. The agent is prompted with
// these literals; do not rename without updating the prompt.
export const BUG_CATEGORIES = [
  "visual_layout",
  "functional",
  "content",
  "accessibility",
] as const;
export type BugCategory = (typeof BUG_CATEGORIES)[number];

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const VIEWPORTS = ["mobile", "tablet", "desktop"] as const;
export type Viewport = (typeof VIEWPORTS)[number];

export const BBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type BBox = z.infer<typeof BBoxSchema>;

export const ReportedBugSchema = z.object({
  category: z.enum(BUG_CATEGORIES),
  severity: z.enum(SEVERITIES),
  confidence: z.number().min(0).max(1),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  evidenceScreenshot: z.string().optional(),
  bbox: BBoxSchema.optional(),
  domSnippet: z.string().max(4000).optional(),
  reproductionSteps: z.array(z.string()).default([]),
});
export type ReportedBug = z.infer<typeof ReportedBugSchema>;

// Queue payload — what the web app puts on Redis Streams.
export const ScanJobSchema = z.object({
  scanId: z.string(),
  projectId: z.string(),
  url: z.string().url(),
  viewport: z.enum(VIEWPORTS).default("desktop"),
});
export type ScanJob = z.infer<typeof ScanJobSchema>;
