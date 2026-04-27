import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@ubh/db";
import {
  PLAN_LIMITS,
  VIEWPORTS,
  checkQuota,
  scanUnitsFor,
} from "@ubh/shared";
import { authenticate, unauthorized } from "@/auth";
import { requirePermission } from "@/rbac-middleware";
import { writeAudit } from "@/audit";
import { getQueue } from "@/queue-client";

export const runtime = "nodejs";

const Body = z.object({
  url: z.string().url(),
  viewports: z.array(z.enum(VIEWPORTS)).min(1).max(3).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await authenticate(req);
  if (!user) return unauthorized();
  const denied = await requirePermission(user, "flow.run");
  if (denied) return denied;

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

  const flow = await prisma.flow.findFirst({
    where: { id: params.id, project: { orgId: user.orgId } },
    include: { project: true },
  });
  if (!flow) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const viewports = parsed.data.viewports ?? ["desktop"];
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } });

  if (flow.credentialIds.length > 0 && !PLAN_LIMITS[org.plan].allowAuthenticatedScans) {
    return NextResponse.json(
      { error: "plan_required", detail: "flows with credentials require Team or higher" },
      { status: 402 },
    );
  }

  const units = scanUnitsFor({ pages: 1, viewports: viewports.length });
  const quota = checkQuota({
    plan: org.plan,
    quotaUsed: org.quotaUsed,
    quotaLimit: org.quotaLimit,
    units,
  });
  if (!quota.ok && quota.reason !== "overage") {
    return NextResponse.json(
      { error: "quota_exceeded", reason: quota.reason, remaining: quota.remaining },
      { status: 402 },
    );
  }

  const scan = await prisma.scan.create({
    data: {
      projectId: flow.projectId,
      flowId: flow.id,
      targetUrl: parsed.data.url,
      viewports,
    },
  });
  await prisma.organization.update({
    where: { id: org.id },
    data: { quotaUsed: { increment: units } },
  });

  const queue = getQueue();
  await queue.ensureGroup();
  await queue.enqueue({
    scanId: scan.id,
    projectId: flow.projectId,
    url: scan.targetUrl,
    viewports,
    flowId: flow.id,
    credentialIds: flow.credentialIds,
    depth: 0,
  });

  await writeAudit({
    orgId: user.orgId,
    userId: user.id,
    action: "flow.run_submitted",
    targetKind: "flow",
    targetId: flow.id,
    payload: { scanId: scan.id, viewports, units },
  });

  return NextResponse.json({ scanId: scan.id, status: "queued", unitsConsumed: units }, { status: 202 });
}
