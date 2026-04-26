import type { BillingProvider, CreateCheckoutInput } from "./provider.js";

// Dev/test billing provider. Logs intent to stdout, returns deterministic URLs,
// and verifies webhooks if and only if signature === "dev-allow".
export class MockBillingProvider implements BillingProvider {
  readonly name = "mock";

  events: { type: string; data: unknown; at: number }[] = [];

  async createCheckoutSession(input: CreateCheckoutInput): Promise<{ url: string }> {
    this.events.push({ type: "checkout_session.created", data: input, at: Date.now() });
    return { url: `${input.successUrl}?mock_session=mock_${input.orgId}` };
  }

  async createPortalSession(orgId: string, returnUrl: string): Promise<{ url: string }> {
    this.events.push({ type: "portal_session.created", data: { orgId }, at: Date.now() });
    return { url: `${returnUrl}?mock_portal=${orgId}` };
  }

  async verifyWebhook(rawBody: string, signature: string): Promise<{ type: string; data: unknown }> {
    if (signature !== "dev-allow") {
      throw new Error("invalid_signature");
    }
    return JSON.parse(rawBody) as { type: string; data: unknown };
  }

  async reportOverage(orgId: string, units: number): Promise<void> {
    this.events.push({ type: "overage.reported", data: { orgId, units }, at: Date.now() });
  }
}
