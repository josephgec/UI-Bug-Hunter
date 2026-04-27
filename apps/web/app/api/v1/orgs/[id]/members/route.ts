import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, Role } from "@ubh/db";
import { authenticate, unauthorized } from "@/auth";
import { requirePermission } from "@/rbac-middleware";
import { writeAudit } from "@/audit";

export const runtime = "nodejs";

const InviteBody = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member", "viewer"]).default("member"),
});

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await authenticate(req);
  if (!user) return unauthorized();
  if (user.orgId !== params.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const denied = await requirePermission(user, "org.member.list");
  if (denied) return denied;

  const members = await prisma.orgMembership.findMany({
    where: { orgId: params.id },
    include: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({
    members: members.map((m) => ({
      id: m.id,
      role: m.role,
      user: m.user,
      createdAt: m.createdAt,
    })),
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await authenticate(req);
  if (!user) return unauthorized();
  if (user.orgId !== params.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const denied = await requirePermission(user, "org.member.invite");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = InviteBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  // Phase 3 stub: create the user (or reuse) and add a membership. A real
  // invite flow would email a magic-link and only create the membership on
  // accept.
  let target = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!target) {
    target = await prisma.user.create({
      data: { email: parsed.data.email, orgId: params.id },
    });
  }
  const membership = await prisma.orgMembership.upsert({
    where: { orgId_userId: { orgId: params.id, userId: target.id } },
    create: { orgId: params.id, userId: target.id, role: parsed.data.role as Role },
    update: { role: parsed.data.role as Role },
  });

  await writeAudit({
    orgId: params.id,
    userId: user.id,
    action: "user.invited",
    targetKind: "user",
    targetId: target.id,
    payload: { email: parsed.data.email, role: parsed.data.role },
  });

  return NextResponse.json({ membership }, { status: 201 });
}
