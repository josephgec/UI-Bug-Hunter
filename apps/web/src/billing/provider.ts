// Provider-agnostic billing interface. Phase 2 ships a Mock for dev and a
// Stripe skeleton — the Stripe integration is wired but uses placeholder
// API calls that will be replaced when STRIPE_SECRET_KEY is available in the
// real environment. Quota enforcement against the database does not depend
// on the provider; only checkout / webhook / invoice operations do.

export interface CreateCheckoutInput {
  orgId: string;
  plan: "team" | "business";
  successUrl: string;
  cancelUrl: string;
}

export interface BillingProvider {
  readonly name: string;
  /** Returns a checkout URL the user should be redirected to. */
  createCheckoutSession(input: CreateCheckoutInput): Promise<{ url: string }>;
  /** Stripe customer-portal session for managing the existing subscription. */
  createPortalSession(orgId: string, returnUrl: string): Promise<{ url: string }>;
  /** Verify a webhook signature and return the parsed event. */
  verifyWebhook(rawBody: string, signature: string): Promise<{ type: string; data: unknown }>;
  /** Record overage scan-units for a billing period. No-op on hard-cap plans. */
  reportOverage(orgId: string, units: number): Promise<void>;
}

let cached: BillingProvider | null = null;

export function getBilling(): BillingProvider {
  if (cached) return cached;
  const kind = (process.env.BILLING_PROVIDER ?? "mock").toLowerCase();
  if (kind === "stripe") {
    // Lazy import — keeps the dev path clean.
    const { StripeBillingProvider } = require("./stripe.js") as typeof import("./stripe.js");
    cached = new StripeBillingProvider();
  } else {
    const { MockBillingProvider } = require("./mock.js") as typeof import("./mock.js");
    cached = new MockBillingProvider();
  }
  return cached;
}
