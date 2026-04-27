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

export const PLANS = ["free", "team", "business", "enterprise"] as const;
export type Plan = (typeof PLANS)[number];

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
  affectedViewports: z.array(z.enum(VIEWPORTS)).default([]),
});
export type ReportedBug = z.infer<typeof ReportedBugSchema>;

// Phase 2: a scan job covers a single URL × possibly-multiple viewports. The
// worker renders all viewports in parallel and batches them into one LLM
// turn for cost-efficiency.
export const ScanJobSchema = z.object({
  scanId: z.string(),
  projectId: z.string(),
  url: z.string().url(),
  viewports: z.array(z.enum(VIEWPORTS)).default(["desktop"]),
  // Crawl context: present when this scan is one page of a multi-page crawl.
  crawlId: z.string().optional(),
  parentScanId: z.string().optional(),
  depth: z.number().int().min(0).default(0),
  // Phase 3: when set, the worker pulls the Flow definition from the DB and
  // runs the steps before handing control to the agent.
  flowId: z.string().optional(),
  // Encrypted credential references the worker should decrypt and inject.
  credentialIds: z.array(z.string()).default([]),
});
export type ScanJob = z.infer<typeof ScanJobSchema>;

// Phase 2: a crawl job seeds a multi-page scan. The crawler worker discovers
// links, enqueues per-page Scan jobs (each themselves multi-viewport).
export const CrawlJobSchema = z.object({
  crawlId: z.string(),
  projectId: z.string(),
  seedUrl: z.string().url(),
  maxDepth: z.number().int().min(0).max(5).default(2),
  maxPages: z.number().int().min(1).max(200).default(25),
  viewports: z.array(z.enum(VIEWPORTS)).default(["desktop"]),
  credentialIds: z.array(z.string()).default([]),
});
export type CrawlJob = z.infer<typeof CrawlJobSchema>;

// Plan limits. Sourced from §11 of the design doc.
export interface PlanLimits {
  /** Included scans per month before overage. */
  includedScans: number;
  /** Hard cap (no overage allowed). null = soft cap with overage billing. */
  hardCap: number | null;
  /** True if authenticated scans are allowed. */
  allowAuthenticatedScans: boolean;
  /** True if the public domain restriction applies. */
  publicSitesOnly: boolean;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    includedScans: 25,
    hardCap: 25,
    allowAuthenticatedScans: false,
    publicSitesOnly: true,
  },
  team: {
    includedScans: 1000,
    hardCap: null,
    allowAuthenticatedScans: true,
    publicSitesOnly: false,
  },
  business: {
    includedScans: 10000,
    hardCap: null,
    allowAuthenticatedScans: true,
    publicSitesOnly: false,
  },
  enterprise: {
    includedScans: 100000,
    hardCap: null,
    allowAuthenticatedScans: true,
    publicSitesOnly: false,
  },
};
