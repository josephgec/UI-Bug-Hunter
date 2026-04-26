import type { Finding, ScanRecord } from "./types";

export class UbhClient {
  constructor(
    private readonly apiUrl: string,
    private readonly token: string,
  ) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text();
      const err = new Error(`${res.status} ${res.statusText}: ${body}`);
      // Surface the status so callers can branch on 402 / 429 etc.
      (err as Error & { status: number }).status = res.status;
      throw err;
    }
    return (await res.json()) as T;
  }

  async createScan(input: {
    projectId: string;
    url: string;
    viewports: string[];
    credentialIds: string[];
  }): Promise<{ scanId: string }> {
    return this.req<{ scanId: string }>("/api/v1/scans", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getScan(scanId: string): Promise<ScanRecord> {
    return this.req<ScanRecord>(`/api/v1/scans/${scanId}`);
  }

  async getFindings(scanId: string, minConfidence: number): Promise<{ findings: Finding[] }> {
    return this.req<{ findings: Finding[] }>(
      `/api/v1/scans/${scanId}/findings?min_confidence=${encodeURIComponent(String(minConfidence))}`,
    );
  }
}
