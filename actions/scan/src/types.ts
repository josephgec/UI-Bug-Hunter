export type Severity = "critical" | "high" | "medium" | "low";

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export interface Finding {
  id: string;
  category: string;
  severity: Severity;
  confidence: number;
  title: string;
  description: string;
  screenshotUrl?: string | null;
}

export interface ScanRecord {
  id: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  targetUrl: string;
  findingsCount: number;
  errorMessage?: string | null;
}

export type OverageBehavior = "hard-fail" | "soft-fail" | "continue";
