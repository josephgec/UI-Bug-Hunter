import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@ubh/db";
import { authenticate, unauthorized } from "@/auth";

export const runtime = "nodejs";

const Body = z.object({
  verdict: z.enum(["real", "false_positive", "wont_fix"]),
  note: z.string().max(2000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
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

  const finding = await prisma.finding.findFirst({
    where: { id: params.id, scan: { project: { orgId: user.orgId } } },
    select: { id: true },
  });
  if (!finding) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const feedback = await prisma.feedback.create({
    data: {
      findingId: finding.id,
      userId: user.id,
      verdict: parsed.data.verdict,
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
    },
  });

  return NextResponse.json({ feedbackId: feedback.id }, { status: 201 });
}
