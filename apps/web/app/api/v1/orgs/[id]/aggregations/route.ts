import { NextResponse } from "next/server";
import { prisma } from "@ubh/db";
import { aggregateFindings, type FindingRow } from "@ubh/shared";
import { authenticate, unauthorized } from "@/auth";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await authenticate(req);
  if (!user) return unauthorized();
  if (user.orgId !== params.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const minConfidence = Number(url.searchParams.get("min_confidence") ?? "0.6");
  const sinceDays = Number(url.searchParams.get("since_days") ?? "30");
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const rows = await prisma.finding.findMany({
    where: {
      scan: { project: { orgId: params.id } },
      createdAt: { gte: since },
    },
    select: {
      id: true,
      category: true,
      severity: true,
      confidence: true,
      createdAt: true,
      scanId: true,
      scan: { select: { projectId: true } },
    },
  });
  const flat: FindingRow[] = rows.map((r) => ({
    id: r.id,
    projectId: r.scan.projectId,
    scanId: r.scanId,
    category: r.category as FindingRow["category"],
    severity: r.severity as FindingRow["severity"],
    confidence: r.confidence,
    createdAt: r.createdAt,
  }));

  return NextResponse.json({
    sinceDays,
    minConfidence,
    aggregation: aggregateFindings(flat, minConfidence),
  });
}
