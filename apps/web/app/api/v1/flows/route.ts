import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@ubh/db";
import { FlowDefinitionSchema } from "@ubh/shared";
import { authenticate, unauthorized } from "@/auth";
import { requirePermission } from "@/rbac-middleware";
import { writeAudit } from "@/audit";

export const runtime = "nodejs";

const CreateBody = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  definition: FlowDefinitionSchema,
  credentialIds: z.array(z.string()).optional(),
  strictAssertions: z.boolean().optional(),
});

export async function GET(req: Request) {
  const user = await authenticate(req);
  if (!user) return unauthorized();
  const denied = await requirePermission(user, "flow.read");
  if (denied) return denied;

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const flows = await prisma.flow.findMany({
    where: {
      project: { orgId: user.orgId },
      ...(projectId ? { projectId } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ flows });
}

export async function POST(req: Request) {
  const user = await authenticate(req);
  if (!user) return unauthorized();
  const denied = await requirePermission(user, "flow.create");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, orgId: user.orgId },
  });
  if (!project) return NextResponse.json({ error: "project_not_found" }, { status: 404 });

  const flow = await prisma.flow.create({
    data: {
      projectId: project.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      steps: parsed.data.definition.steps as unknown as object[],
      credentialIds: parsed.data.credentialIds ?? [],
      strictAssertions: parsed.data.strictAssertions ?? true,
    },
  });

  await writeAudit({
    orgId: user.orgId,
    userId: user.id,
    action: "flow.created",
    targetKind: "flow",
    targetId: flow.id,
    payload: { name: flow.name, stepCount: parsed.data.definition.steps.length },
  });

  return NextResponse.json({ flow }, { status: 201 });
}
