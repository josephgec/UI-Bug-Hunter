import { NextResponse } from "next/server";
import { prisma } from "@ubh/db";
import { authenticate, unauthorized } from "@/auth";
import { requirePermission } from "@/rbac-middleware";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await authenticate(req);
  if (!user) return unauthorized();
  const denied = await requirePermission(user, "audit.read");
  if (denied) return denied;

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
  const targetKind = url.searchParams.get("targetKind");
  const action = url.searchParams.get("action");

  const rows = await prisma.auditLog.findMany({
    where: {
      orgId: user.orgId,
      ...(targetKind ? { targetKind } : {}),
      ...(action ? { action } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { user: { select: { id: true, email: true, name: true } } },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return NextResponse.json({
    entries: page.map((r) => ({
      id: r.id,
      action: r.action,
      targetKind: r.targetKind,
      targetId: r.targetId,
      payload: r.payload,
      actor: r.user ? { id: r.user.id, email: r.user.email, name: r.user.name } : null,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt,
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  });
}
