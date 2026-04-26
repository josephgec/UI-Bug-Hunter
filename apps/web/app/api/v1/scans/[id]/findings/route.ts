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

  const url = new URL(req.url);
  const minConfidence = Number(url.searchParams.get("min_confidence") ?? "0");
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);

  const scan = await prisma.scan.findFirst({
    where: { id: params.id, project: { orgId: user.orgId } },
    select: { id: true },
  });
  if (!scan) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const findings = await prisma.finding.findMany({
    where: { scanId: scan.id, confidence: { gte: minConfidence } },
    orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = findings.length > limit;
  const page = hasMore ? findings.slice(0, limit) : findings;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  return NextResponse.json({
    findings: page,
    nextCursor,
  });
}
