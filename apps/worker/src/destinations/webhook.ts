import { createHmac } from "node:crypto";
import { z } from "zod";
import type { DestinationProvider, DispatchFinding, DispatchResult } from "./types.js";

export const WebhookConfigSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(8),
});
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

// Generic webhook destination — backs the "works with any CI" claim. We
// POST a signed JSON body; receivers verify by recomputing HMAC-SHA256(secret,
// body) and comparing in constant time against the X-UBH-Signature header.
export class WebhookDestinationProvider implements DestinationProvider {
  readonly kind = "WEBHOOK" as const;

  async test(rawConfig: unknown): Promise<{ ok: boolean; error?: string }> {
    const config = WebhookConfigSchema.safeParse(rawConfig);
    if (!config.success) return { ok: false, error: "invalid_config" };
    // We don't ping the webhook on test() to avoid spurious traffic to the
    // user's endpoint — just validate the config shape.
    return { ok: true };
  }

  async send(rawConfig: unknown, finding: DispatchFinding): Promise<DispatchResult> {
    const config = WebhookConfigSchema.parse(rawConfig);
    const body = JSON.stringify({ kind: "finding", finding });
    const signature = createHmac("sha256", config.secret).update(body).digest("hex");
    try {
      const res = await fetch(config.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ubh-signature": `sha256=${signature}`,
          "user-agent": "UI-Bug-Hunter-Webhook/1.0",
        },
        body,
      });
      if (!res.ok) {
        return { ok: false, error: `${res.status} ${res.statusText}` };
      }
      return { ok: true, externalUrl: config.url };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
