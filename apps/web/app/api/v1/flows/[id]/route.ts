import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@ubh/db";
import { FlowDefinitionSchema } from "@ubh/shared";
import { authenticate, unauthorized } from "@/auth";
import { requirePermission } from "@/rbac-middleware";
import { writeAudit } from "@/audit";

export const runtime = "nodejs";

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  definition: FlowDefinitionSchema.optional(),
  credentialIds: z.array(z.string()).optional(),
  strictAssertions: z.boolean().optional(),
});

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await authenticate(req);
  if (!user) return unauthorized();
  const denied = await requirePermission(user, "flow.read");
  if (denied) return denied;

  const flow = await prisma.flow.findFirst({
    where: { id: params.id, project: { orgId: user.orgId } },
  });
  if (!flow) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ flow });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await authenticate(req);
  if (!user) return unauthorized();
  const denied = await requirePermission(user, "flow.update");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  const existing = await prisma.flow.findFirst({
    where: { id: params.id, project: { orgId: user.orgId } },
  });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const flow = await prisma.flow.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.definition !== undefined
        ? { steps: parsed.data.definition.steps as unknown as object[] }
        : {}),
      ...(parsed.data.credentialIds !== undefined ? { credentialIds: parsed.data.credentialIds } : {}),
      ...(parsed.data.strictAssertions !== undefined
        ? { strictAssertions: parsed.data.strictAssertions }
        : {}),
    },
  });

  await writeAudit({
    orgId: user.orgId,
    userId: user.id,
    action: "flow.updated",
    targetKind: "flow",
    targetId: flow.id,
    payload: { fields: Object.keys(parsed.data) },
  });

  return NextResponse.json({ flow });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const user = await authenticate(req);
  if (!user) return unauthorized();
  const denied = await requirePermission(user, "flow.delete");
  if (denied) return denied;

  const existing = await prisma.flow.findFirst({
    where: { id: params.id, project: { orgId: user.orgId } },
  });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.flow.delete({ where: { id: existing.id } });
  await writeAudit({
    orgId: user.orgId,
    userId: user.id,
    action: "flow.deleted",
    targetKind: "flow",
    targetId: existing.id,
    payload: { name: existing.name },
  });
  return NextResponse.json({ ok: true });
}
