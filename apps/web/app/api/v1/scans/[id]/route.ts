import { NextResponse } from "next/server";
import { prisma } from "@ubh/db";
import { authenticate, unauthorized } from "@/auth";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const user = await authenticate(req);
  if (!user) return unauthorized();

  const scan = await prisma.scan.findFirst({
    where: { id: params.id, project: { orgId: user.orgId } },
    include: { _count: { select: { findings: true } } },
  });
  if (!scan) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    id: scan.id,
    status: scan.status,
    targetUrl: scan.targetUrl,
    viewport: scan.viewport,
    startedAt: scan.startedAt,
    finishedAt: scan.finishedAt,
    findingsCount: scan._count.findings,
    toolCalls: scan.toolCalls,
    errorMessage: scan.errorMessage,
  });
}
