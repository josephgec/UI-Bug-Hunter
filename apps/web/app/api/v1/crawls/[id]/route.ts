import { NextResponse } from "next/server";
import { prisma } from "@ubh/db";
import { authenticate, unauthorized } from "@/auth";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await authenticate(req);
  if (!user) return unauthorized();
  const crawl = await prisma.crawl.findFirst({
    where: { id: params.id, project: { orgId: user.orgId } },
    include: {
      _count: { select: { scans: true } },
      scans: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          targetUrl: true,
          status: true,
          depth: true,
          _count: { select: { findings: true } },
        },
      },
    },
  });
  if (!crawl) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    id: crawl.id,
    status: crawl.status,
    seedUrl: crawl.seedUrl,
    pagesScanned: crawl.pagesScanned,
    maxPages: crawl.maxPages,
    maxDepth: crawl.maxDepth,
    viewports: crawl.viewports,
    startedAt: crawl.startedAt,
    finishedAt: crawl.finishedAt,
    errorMessage: crawl.errorMessage,
    scans: crawl.scans.map((s) => ({
      id: s.id,
      targetUrl: s.targetUrl,
      status: s.status,
      depth: s.depth,
      findingsCount: s._count.findings,
    })),
  });
}
