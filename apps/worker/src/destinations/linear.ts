import { z } from "zod";
import type { DestinationProvider, DispatchFinding, DispatchResult } from "./types.js";

export const LinearConfigSchema = z.object({
  apiKey: z.string().min(10),
  teamId: z.string().min(1),
  projectId: z.string().optional(),
});
export type LinearConfig = z.infer<typeof LinearConfigSchema>;

const LINEAR_GRAPHQL = "https://api.linear.app/graphql";

export class LinearDestinationProvider implements DestinationProvider {
  readonly kind = "LINEAR" as const;

  async test(rawConfig: unknown): Promise<{ ok: boolean; error?: string }> {
    const config = LinearConfigSchema.safeParse(rawConfig);
    if (!config.success) return { ok: false, error: "invalid_config" };
    if (process.env.LINEAR_PROVIDER === "mock") return { ok: true };
    try {
      const res = await fetch(LINEAR_GRAPHQL, {
        method: "POST",
        headers: {
          authorization: config.data.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: `query { team(id: "${config.data.teamId}") { id name } }` }),
      });
      const json = (await res.json()) as { data?: { team?: { id: string } }; errors?: unknown[] };
      if (!json.data?.team) {
        return { ok: false, error: "team_not_found_or_unauthorized" };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async send(rawConfig: unknown, finding: DispatchFinding): Promise<DispatchResult> {
    const config = LinearConfigSchema.parse(rawConfig);
    if (process.env.LINEAR_PROVIDER === "mock") {
      return {
        ok: true,
        externalId: `mock-linear-${finding.id}`,
        externalUrl: `https://linear.app/mock/issue/${finding.id}`,
      };
    }
    const title = `[${finding.severity.toUpperCase()}] ${finding.title}`;
    const description = formatBody(finding);
    const mutation = `
      mutation CreateIssue($title: String!, $description: String!, $teamId: String!, $projectId: String) {
        issueCreate(input: { title: $title, description: $description, teamId: $teamId, projectId: $projectId }) {
          success
          issue { id identifier url }
        }
      }`;
    const res = await fetch(LINEAR_GRAPHQL, {
      method: "POST",
      headers: {
        authorization: config.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          title,
          description,
          teamId: config.teamId,
          projectId: config.projectId ?? null,
        },
      }),
    });
    const json = (await res.json()) as {
      data?: { issueCreate?: { success: boolean; issue?: { id: string; identifier: string; url: string } } };
      errors?: { message: string }[];
    };
    if (!json.data?.issueCreate?.success || !json.data.issueCreate.issue) {
      return { ok: false, error: json.errors?.[0]?.message ?? "issueCreate_failed" };
    }
    return {
      ok: true,
      externalId: json.data.issueCreate.issue.identifier,
      externalUrl: json.data.issueCreate.issue.url,
    };
  }
}

function formatBody(finding: DispatchFinding): string {
  return [
    `**Project:** ${finding.projectName}`,
    `**URL:** ${finding.targetUrl}`,
    `**Category:** ${finding.category}`,
    `**Confidence:** ${finding.confidence.toFixed(2)}`,
    "",
    finding.description,
    "",
    finding.screenshotUrl ? `![screenshot](${finding.screenshotUrl})` : "",
    `[Open in dashboard](${finding.dashboardUrl})`,
  ]
    .filter((s) => s !== "")
    .join("\n");
}
