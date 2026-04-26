import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, unauthorized } from "@/auth";
import { getBilling } from "@/billing/provider";

export const runtime = "nodejs";

const Body = z.object({
  plan: z.enum(["team", "business"]),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export async function POST(req: Request) {
  const user = await authenticate(req);
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  const billing = getBilling();
  const session = await billing.createCheckoutSession({
    orgId: user.orgId,
    plan: parsed.data.plan,
    successUrl: parsed.data.successUrl,
    cancelUrl: parsed.data.cancelUrl,
  });
  return NextResponse.json(session);
}
