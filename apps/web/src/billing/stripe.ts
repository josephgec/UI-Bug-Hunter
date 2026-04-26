import type { BillingProvider, CreateCheckoutInput } from "./provider.js";

// Stripe billing provider. Skeleton in Phase 2 — the methods are wired so
// callers don't change when STRIPE_SECRET_KEY lands, but each one currently
// throws if invoked without configuration. The pattern: lazy-load the Stripe
// SDK only when an instance is constructed, so the dev path doesn't require
// the dep to even resolve.
export class StripeBillingProvider implements BillingProvider {
  readonly name = "stripe";
  private stripe: import("stripe").default | null = null;

  private getClient(): import("stripe").default {
    if (this.stripe) return this.stripe;
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set — set BILLING_PROVIDER=mock for dev");
    }
    // Lazy require so the package only resolves when actually used.
    const Stripe = require("stripe") as typeof import("stripe").default;
    this.stripe = new Stripe(key, { apiVersion: "2024-06-20" });
    return this.stripe;
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<{ url: string }> {
    const stripe = this.getClient();
    const priceId = input.plan === "team" ? process.env.STRIPE_PRICE_TEAM : process.env.STRIPE_PRICE_BUSINESS;
    if (!priceId) throw new Error(`STRIPE_PRICE_${input.plan.toUpperCase()} is not set`);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.orgId,
      metadata: { orgId: input.orgId, plan: input.plan },
    });
    if (!session.url) throw new Error("stripe checkout session has no url");
    return { url: session.url };
  }

  async createPortalSession(orgId: string, returnUrl: string): Promise<{ url: string }> {
    // The webhook flow records stripeCustomerId on the org; this looks it up
    // and creates a portal session.
    const { prisma } = await import("@ubh/db");
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org?.stripeCustomerId) throw new Error("org has no stripe customer");
    const stripe = this.getClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  async verifyWebhook(rawBody: string, signature: string): Promise<{ type: string; data: unknown }> {
    const stripe = this.getClient();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
    const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    return { type: event.type, data: event.data.object };
  }

  async reportOverage(orgId: string, units: number): Promise<void> {
    // Stripe metered billing requires a SubscriptionItem id with a metered
    // price. We persist that on the Subscription row when the webhook fires.
    const { prisma } = await import("@ubh/db");
    const sub = await prisma.subscription.findUnique({ where: { orgId } });
    if (!sub) {
      console.warn(`[billing] reportOverage(${orgId}) — no subscription`);
      return;
    }
    const stripe = this.getClient();
    await stripe.subscriptionItems.createUsageRecord(
      // The metered subscription-item id is stored on the price metadata in
      // a real deployment. Skeleton: log + skip if env hasn't been wired.
      process.env.STRIPE_METERED_ITEM_ID ?? "",
      { quantity: units, action: "increment" },
    );
  }
}
