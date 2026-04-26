import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, CredentialKind } from "@ubh/db";
import { authenticate, unauthorized } from "@/auth";
import { encryptCredentialPlaintext } from "@/billing/credentials-helper";

export const runtime = "nodejs";

const HeaderShape = z.object({ kind: z.literal("HEADER"), data: z.object({ name: z.string(), value: z.string() }) });
const CookieShape = z.object({
  kind: z.literal("COOKIE"),
  data: z.object({ name: z.string(), value: z.string(), domain: z.string().optional(), path: z.string().optional() }),
});
const BasicShape = z.object({
  kind: z.literal("BASIC_AUTH"),
  data: z.object({ username: z.string(), password: z.string() }),
});

const Body = z.intersection(
  z.object({ name: z.string().min(1).max(80) }),
  z.discriminatedUnion("kind", [HeaderShape, CookieShape, BasicShape]),
);

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await authenticate(req);
  if (!user) return unauthorized();
  const project = await prisma.project.findFirst({ where: { id: params.id, orgId: user.orgId } });
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Plaintext is never returned — only metadata.
  const creds = await prisma.credential.findMany({
    where: { projectId: project.id },
    select: { id: true, name: true, kind: true, createdAt: true, lastUsedAt: true, keyId: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ credentials: creds });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await authenticate(req);
  if (!user) return unauthorized();
  const project = await prisma.project.findFirst({ where: { id: params.id, orgId: user.orgId } });
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });

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

  const blob = await encryptCredentialPlaintext({ kind: parsed.data.kind, data: parsed.data.data } as never);
  const cred = await prisma.credential.create({
    data: {
      projectId: project.id,
      name: parsed.data.name,
      kind: parsed.data.kind as CredentialKind,
      ciphertext: blob.ciphertext,
      iv: blob.iv,
      keyId: blob.keyId,
    },
    select: { id: true, name: true, kind: true, createdAt: true },
  });
  return NextResponse.json({ credential: cred }, { status: 201 });
}
