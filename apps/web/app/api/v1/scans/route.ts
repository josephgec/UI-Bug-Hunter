import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@ubh/db";
import { VIEWPORTS, validateScanUrl } from "@ubh/shared";
import { authenticate, unauthorized } from "@/auth";
import { getQueue } from "@/queue-client";

export const runtime = "nodejs";

const Body = z.object({
  projectId: z.string().min(1),
  url: z.string().url(),
  viewport: z.enum(VIEWPORTS).optional(),
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
  if (!project) {
    return NextResponse.json({ error: "project_not_found" }, { status: 404 });
  }

  const validation = await validateScanUrl(parsed.data.url);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "url_rejected", reason: validation.reason, detail: validation.detail },
      { status: 400 },
    );
  }

  const scan = await prisma.scan.create({
    data: {
      projectId: project.id,
      targetUrl: validation.url.toString(),
      viewport: parsed.data.viewport ?? "desktop",
    },
  });

  const queue = getQueue();
  await queue.ensureGroup();
  await queue.enqueue({
    scanId: scan.id,
    projectId: project.id,
    url: scan.targetUrl,
    viewport: scan.viewport as (typeof VIEWPORTS)[number],
  });

  return NextResponse.json({ scanId: scan.id, status: "queued" }, { status: 202 });
}
