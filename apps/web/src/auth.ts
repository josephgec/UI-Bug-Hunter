import { NextResponse } from "next/server";
import { prisma } from "@ubh/db";

// Phase-1 stub: trust an `x-dev-user` header (or DEV_USER_EMAIL env var fallback)
// and resolve to a User record, creating one + an org on first sight. Replace
// with NextAuth + a real provider before any external traffic touches this.
export interface AuthedUser {
  id: string;
  email: string;
  orgId: string;
}

export async function authenticate(req: Request): Promise<AuthedUser | null> {
  const headerEmail = req.headers.get("x-dev-user");
  const email = headerEmail ?? process.env.DEV_USER_EMAIL ?? null;
  if (!email) return null;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { id: existing.id, email: existing.email, orgId: existing.orgId };
  }

  const user = await prisma.user.create({
    data: {
      email,
      org: { create: { name: `${email}'s org` } },
    },
    select: { id: true, email: true, orgId: true },
  });
  return user;
}

export function unauthorized(): Response {
  return NextResponse.json(
    { error: "unauthorized", detail: "Set x-dev-user header (Phase 1 dev auth)." },
    { status: 401 },
  );
}
