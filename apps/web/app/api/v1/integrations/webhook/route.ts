import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@ubh/db";
import { VIEWPORTS, validateScanUrl } from "@ubh/shared";
import { authenticate, unauthorized } from "@/auth";
import { writeAudit } from "@/audit";
import { getQueue } from "@/queue-client";

export const runtime = "nodejs";

// Generic webhook fallback so any CI provider (or one-off cron, or curl) can
// submit a batch of scans. The body is a list of {projectId, url} pairs;
// each item is enqueued as its own Scan and the response returns the list
// of scanIds for the caller to poll. This is the seam that backs the
// "works with any CI" claim.
const Body = z.object({
  scans: z
    .array(
      z.object({
        projectId: z.string().min(1),
        url: z.string().url(),
        viewports: z.array(z.enum(VIEWPORTS)).min(1).max(3).optional(),
      }),
    )
    .min(1)
    .max(50),
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
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  // Validate that every project belongs to this org.
  const projectIds = [...new Set(parsed.data.scans.map((s) => s.projectId))];
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds }, orgId: user.orgId },
    select: { id: true },
  });
  const knownIds = new Set(projects.map((p) => p.id));

  const queue = getQueue();
  await queue.ensureGroup();

  const scanIds: string[] = [];
  const errors: { url: string; reason: string }[] = [];
  for (const item of parsed.data.scans) {
    if (!knownIds.has(item.projectId)) {
      errors.push({ url: item.url, reason: "project_not_found" });
      continue;
    }
    const validation = await validateScanUrl(item.url);
    if (!validation.ok) {
      errors.push({ url: item.url, reason: `url_rejected:${validation.reason}` });
      continue;
    }
    const scan = await prisma.scan.create({
      data: {
        projectId: item.projectId,
        targetUrl: validation.url.toString(),
        viewports: item.viewports ?? ["desktop"],
      },
    });
    await queue.enqueue({
      scanId: scan.id,
      projectId: item.projectId,
      url: scan.targetUrl,
      viewports: scan.viewports as (typeof VIEWPORTS)[number][],
      depth: 0,
      credentialIds: [],
    });
    scanIds.push(scan.id);
  }

  await writeAudit({
    orgId: user.orgId,
    userId: user.id,
    action: "scan.submitted",
    targetKind: "scan",
    payload: { source: "webhook", count: scanIds.length, errorsCount: errors.length },
  });

  return NextResponse.json(
    { scanIds, errors },
    { status: errors.length === 0 ? 202 : 207 },
  );
}
