import type { BugCategory, Severity } from "@ubh/shared";

export interface DispatchFinding {
  id: string;
  category: BugCategory;
  severity: Severity;
  confidence: number;
  title: string;
  description: string;
  screenshotUrl: string | null;
  scanId: string;
  projectName: string;
  targetUrl: string;
  /** Public dashboard URL for the finding (set by the dispatcher). */
  dashboardUrl: string;
}

export interface DispatchResult {
  ok: boolean;
  externalId?: string;
  externalUrl?: string;
  error?: string;
}

export interface DestinationProvider {
  readonly kind: "SLACK" | "LINEAR" | "JIRA" | "WEBHOOK";
  /** Validate that the configured credentials work, before storing. */
  test(config: unknown): Promise<{ ok: boolean; error?: string }>;
  /** Send a finding to the destination. */
  send(config: unknown, finding: DispatchFinding): Promise<DispatchResult>;
}
