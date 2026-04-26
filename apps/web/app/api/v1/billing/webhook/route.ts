import { NextResponse } from "next/server";
import { prisma } from "@ubh/db";
import { getBilling } from "@/billing/provider";

export const runtime = "nodejs";

// Stripe (or Mock) webhook receiver. Idempotently translates lifecycle events
// into subscription / quota state on the Organization + Subscription tables.
export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature") ?? req.headers.get("x-mock-signature") ?? "";
  const raw = await req.text();
  const billing = getBilling();
  let event: { type: string; data: unknown };
  try {
    event = await billing.verifyWebhook(raw, sig);
  } catch (err) {
    console.error("[billing] webhook signature failed:", err);
    return new NextResponse("invalid signature", { status: 400 });
  }

  // Skeleton handlers — full implementations land when STRIPE_SECRET_KEY ships.
  // We translate enough of Stripe's checkout.session.completed and
  // invoice.created events to keep quota and Subscription rows in sync.
  switch (event.type) {
    case "checkout.session.completed": {
      const data = event.data as { metadata?: { orgId?: string; plan?: string }; customer?: string; subscription?: string };
      if (!data.metadata?.orgId || !data.metadata.plan) break;
      await prisma.organization.update({
        where: { id: data.metadata.orgId },
        data: {
          plan: data.metadata.plan as "team" | "business",
          ...(data.customer ? { stripeCustomerId: data.customer } : {}),
          quotaLimit: data.metadata.plan === "team" ? 1000 : 10000,
        },
      });
      break;
    }
    case "invoice.created": {
      // Reset the period-counter at the start of each billing cycle.
      const data = event.data as { customer?: string };
      if (!data.customer) break;
      await prisma.organization.updateMany({
        where: { stripeCustomerId: data.customer },
        data: { quotaUsed: 0, quotaResetAt: new Date() },
      });
      break;
    }
    case "customer.subscription.deleted": {
      const data = event.data as { customer?: string };
      if (!data.customer) break;
      await prisma.organization.updateMany({
        where: { stripeCustomerId: data.customer },
        data: { plan: "free", quotaLimit: 25 },
      });
      break;
    }
    default: {
      // Acknowledge unhandled events so Stripe doesn't keep retrying.
      console.log(`[billing] unhandled event: ${event.type}`);
    }
  }

  return NextResponse.json({ ok: true });
}
