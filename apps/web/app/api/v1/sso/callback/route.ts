import { NextResponse } from "next/server";
import { prisma, Role } from "@ubh/db";
import { writeAudit } from "@/audit";
import { getSso } from "@/sso/provider";

export const runtime = "nodejs";

// SSO callback. We accept the IdP's redirect, verify the state token,
// resolve / provision the user, and (in a real deploy) drop a session
// cookie. In Phase 3 the callback returns JSON so tests can assert on the
// shape; the actual session-cookie wiring lands when we replace the dev-
// header auth stub.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.json({ error: "missing_code_or_state" }, { status: 400 });
  }

  const sso = getSso();
  let profile;
  try {
    profile = await sso.verify({ code, state });
  } catch (err) {
    return NextResponse.json(
      { error: "verify_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
  if (!profile.trusted) {
    return NextResponse.json({ error: "untrusted_profile" }, { status: 400 });
  }

  // Resolve the SSO connection from the state's payload to know which org
  // the user belongs to. The mock provider emits orgId:connectionId so we
  // can look it up here without hitting the IdP again.
  const [, payload] = state.split(".");
  const decoded = decodeURIComponent(payload ?? "");
  const [orgId] = decoded.split(":");
  if (!orgId) return NextResponse.json({ error: "no_org_in_state" }, { status: 400 });

  let user = await prisma.user.findUnique({ where: { email: profile.email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: profile.email,
        name: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || null,
        orgId,
      },
    });
    await writeAudit({
      orgId,
      action: "sso.user_provisioned",
      targetKind: "user",
      targetId: user.id,
      payload: { email: profile.email },
    });
  }
  await prisma.orgMembership.upsert({
    where: { orgId_userId: { orgId, userId: user.id } },
    create: { orgId, userId: user.id, role: Role.member },
    update: {},
  });

  return NextResponse.json({
    user: { id: user.id, email: user.email, orgId },
  });
}
