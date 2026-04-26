import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@ubh/db";
import { authenticate, unauthorized } from "@/auth";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
});

export async function GET(req: Request) {
  const user = await authenticate(req);
  if (!user) return unauthorized();
  const projects = await prisma.project.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ projects });
}

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
  const project = await prisma.project.create({
    data: {
      orgId: user.orgId,
      name: parsed.data.name,
      baseUrl: parsed.data.baseUrl,
    },
  });
  return NextResponse.json({ project }, { status: 201 });
}
