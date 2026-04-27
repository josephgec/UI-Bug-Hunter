import { NextResponse } from "next/server";
import { prisma, Role } from "@ubh/db";

// Phase 3: the auth stub now resolves the user's role for their primary org
// so RBAC middleware can read it without a second DB hit. First-time users
// land as `admin` (they own the org); a real auth flow will assign roles via
// invites + SSO claims.
export interface AuthedUser {
  id: string;
  email: string;
  orgId: string;
  role: Role;
}

export async function authenticate(req: Request): Promise<AuthedUser | null> {
  const headerEmail = req.headers.get("x-dev-user");
  const email = headerEmail ?? process.env.DEV_USER_EMAIL ?? null;
  if (!email) return null;

  const existing = await prisma.user.findUnique({
    where: { email },
    include: {
      memberships: {
        where: { /* primary org only — see seed below */ },
        select: { orgId: true, role: true },
      },
    },
  });

  if (existing) {
    const primary = existing.memberships.find((m) => m.orgId === existing.orgId);
    return {
      id: existing.id,
      email: existing.email,
      orgId: existing.orgId,
      role: primary?.role ?? Role.member,
    };
  }

  // Bootstrap: create user + org + admin membership.
  const created = await prisma.user.create({
    data: {
      email,
      org: { create: { name: `${email}'s org` } },
    },
    select: { id: true, email: true, orgId: true },
  });
  await prisma.orgMembership.create({
    data: { orgId: created.orgId, userId: created.id, role: Role.admin },
  });
  return { ...created, role: Role.admin };
}

export function unauthorized(): Response {
  return NextResponse.json(
    { error: "unauthorized", detail: "Set x-dev-user header (Phase 1 dev auth)." },
    { status: 401 },
  );
}
