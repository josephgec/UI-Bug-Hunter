import { z } from "zod";
import type { DestinationProvider, DispatchFinding, DispatchResult } from "./types.js";

export const SlackConfigSchema = z.object({
  botToken: z.string().min(10),
  defaultChannel: z.string().min(1),
});
export type SlackConfig = z.infer<typeof SlackConfigSchema>;

export class SlackDestinationProvider implements DestinationProvider {
  readonly kind = "SLACK" as const;

  async test(rawConfig: unknown): Promise<{ ok: boolean; error?: string }> {
    const config = SlackConfigSchema.safeParse(rawConfig);
    if (!config.success) return { ok: false, error: "invalid_config" };
    if (process.env.SLACK_PROVIDER === "mock") return { ok: true };
    try {
      const res = await fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: { authorization: `Bearer ${config.data.botToken}` },
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      return json.ok ? { ok: true } : { ok: false, error: json.error ?? "unknown" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async send(rawConfig: unknown, finding: DispatchFinding): Promise<DispatchResult> {
    const config = SlackConfigSchema.parse(rawConfig);
    if (process.env.SLACK_PROVIDER === "mock") {
      return { ok: true, externalId: `mock-ts-${finding.id}` };
    }
    const body = {
      channel: config.defaultChannel,
      text: `${severityEmoji(finding.severity)} *${finding.severity.toUpperCase()}* — ${finding.title}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `${finding.severity.toUpperCase()}: ${finding.title}` },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Project*\n${finding.projectName}` },
            { type: "mrkdwn", text: `*URL*\n<${finding.targetUrl}|${finding.targetUrl}>` },
            { type: "mrkdwn", text: `*Category*\n${finding.category}` },
            { type: "mrkdwn", text: `*Confidence*\n${finding.confidence.toFixed(2)}` },
          ],
        },
        { type: "section", text: { type: "mrkdwn", text: finding.description } },
        ...(finding.screenshotUrl
          ? [
              {
                type: "image",
                image_url: finding.screenshotUrl,
                alt_text: finding.title,
              },
            ]
          : []),
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Open in dashboard" },
              url: finding.dashboardUrl,
            },
          ],
        },
      ],
    };
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; ts?: string; channel?: string; error?: string };
    if (!json.ok) return { ok: false, error: json.error ?? "unknown" };
    return {
      ok: true,
      externalId: json.ts,
      ...(json.channel ? { externalUrl: `slack://channel?id=${json.channel}&message=${json.ts}` } : {}),
    };
  }
}

function severityEmoji(severity: string): string {
  switch (severity) {
    case "critical":
      return ":no_entry:";
    case "high":
      return ":warning:";
    case "medium":
      return ":eyes:";
    default:
      return ":small_orange_diamond:";
  }
}
