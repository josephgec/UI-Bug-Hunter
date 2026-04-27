import { z } from "zod";
import type { DestinationProvider, DispatchFinding, DispatchResult } from "./types.js";

export const JiraConfigSchema = z.object({
  baseUrl: z.string().url(),
  email: z.string().email(),
  apiToken: z.string().min(10),
  projectKey: z.string().min(1),
  issueType: z.string().default("Bug"),
});
export type JiraConfig = z.infer<typeof JiraConfigSchema>;

export class JiraDestinationProvider implements DestinationProvider {
  readonly kind = "JIRA" as const;

  async test(rawConfig: unknown): Promise<{ ok: boolean; error?: string }> {
    const config = JiraConfigSchema.safeParse(rawConfig);
    if (!config.success) return { ok: false, error: "invalid_config" };
    if (process.env.JIRA_PROVIDER === "mock") return { ok: true };
    try {
      const res = await fetch(`${config.data.baseUrl}/rest/api/3/myself`, {
        headers: { authorization: basicAuth(config.data.email, config.data.apiToken) },
      });
      if (!res.ok) {
        return { ok: false, error: `${res.status} ${res.statusText}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async send(rawConfig: unknown, finding: DispatchFinding): Promise<DispatchResult> {
    const config = JiraConfigSchema.parse(rawConfig);
    if (process.env.JIRA_PROVIDER === "mock") {
      const key = `MOCK-${Math.floor(Math.random() * 9999)}`;
      return {
        ok: true,
        externalId: key,
        externalUrl: `${config.baseUrl}/browse/${key}`,
      };
    }
    const summary = `[${finding.severity.toUpperCase()}] ${finding.title}`;
    const description = adfDescription(finding);
    const res = await fetch(`${config.baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        authorization: basicAuth(config.email, config.apiToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          project: { key: config.projectKey },
          issuetype: { name: config.issueType },
          summary,
          description,
        },
      }),
    });
    const json = (await res.json()) as { key?: string; self?: string; errors?: Record<string, string> };
    if (!json.key) {
      const error = JSON.stringify(json.errors ?? json);
      return { ok: false, error };
    }
    return {
      ok: true,
      externalId: json.key,
      externalUrl: `${config.baseUrl}/browse/${json.key}`,
    };
  }
}

function basicAuth(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

// Atlassian Document Format — Jira Cloud's rich-text representation. We use
// a minimal subset (paragraphs + a code block) since the API rejects free-
// form markdown.
function adfDescription(finding: DispatchFinding): unknown {
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  return {
    type: "doc",
    version: 1,
    content: [
      paragraph(`Project: ${finding.projectName}`),
      paragraph(`URL: ${finding.targetUrl}`),
      paragraph(`Category: ${finding.category} · Confidence: ${finding.confidence.toFixed(2)}`),
      paragraph(finding.description),
      paragraph(`Dashboard: ${finding.dashboardUrl}`),
    ],
  };
}
