import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@ubh/db";
import {
  PLAN_LIMITS,
  VIEWPORTS,
  checkQuota,
  scanUnitsFor,
  validateScanUrl,
} from "@ubh/shared";
import { authenticate, unauthorized } from "@/auth";
import { getCrawlQueue } from "@/queue-client";

export const runtime = "nodejs";

const Body = z.object({
  projectId: z.string().min(1),
  seedUrl: z.string().url(),
  viewports: z.array(z.enum(VIEWPORTS)).min(1).max(3).optional(),
  maxDepth: z.number().int().min(0).max(5).optional(),
  maxPages: z.number().int().min(1).max(200).optional(),
  credentialIds: z.array(z.string()).optional(),
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
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, orgId: user.orgId },
  });
  if (!project) return NextResponse.json({ error: "project_not_found" }, { status: 404 });

  const validation = await validateScanUrl(parsed.data.seedUrl);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "url_rejected", reason: validation.reason, detail: validation.detail },
      { status: 400 },
    );
  }

  const viewports = parsed.data.viewports ?? ["desktop"];
  const maxPages = parsed.data.maxPages ?? 25;
  const maxDepth = parsed.data.maxDepth ?? 2;
  const credentialIds = parsed.data.credentialIds ?? [];

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } });

  if (credentialIds.length > 0 && !PLAN_LIMITS[org.plan].allowAuthenticatedScans) {
    return NextResponse.json(
      { error: "plan_required", detail: "authenticated scans require Team or higher" },
      { status: 402 },
    );
  }

  // Worst-case unit count: pages × viewports.
  const units = scanUnitsFor({ pages: maxPages, viewports: viewports.length });
  const quota = checkQuota({
    plan: org.plan,
    quotaUsed: org.quotaUsed,
    quotaLimit: org.quotaLimit,
    units,
  });
  if (!quota.ok && quota.reason !== "overage") {
    return NextResponse.json(
      { error: "quota_exceeded", reason: quota.reason, remaining: quota.remaining, units },
      { status: 402 },
    );
  }

  const crawl = await prisma.crawl.create({
    data: {
      projectId: project.id,
      seedUrl: validation.url.toString(),
      viewports,
      maxDepth,
      maxPages,
    },
  });

  // We don't increment the org's quota here — the per-scan endpoint does that
  // as each page-scan is created. Otherwise we'd double-count if the crawl
  // discovers fewer pages than maxPages.

  const queue = getCrawlQueue();
  await queue.ensureGroup();
  await queue.enqueue({
    crawlId: crawl.id,
    projectId: project.id,
    seedUrl: crawl.seedUrl,
    maxDepth,
    maxPages,
    viewports,
    credentialIds,
  });

  return NextResponse.json(
    { crawlId: crawl.id, status: "queued", maxUnits: units },
    { status: 202 },
  );
}
