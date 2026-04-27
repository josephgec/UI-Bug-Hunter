import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@ubh/db";
import { authenticate, unauthorized } from "@/auth";
import { getSso } from "@/sso/provider";

export const runtime = "nodejs";

const Body = z.object({
  connectionId: z.string().min(1),
  redirectUri: z.string().url(),
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

  // Validate that the connection belongs to this org.
  const connection = await prisma.ssoConnection.findFirst({
    where: { externalId: parsed.data.connectionId, orgId: user.orgId, enabled: true },
  });
  if (!connection) return NextResponse.json({ error: "connection_not_found" }, { status: 404 });

  const sso = getSso();
  const { url, state } = await sso.authorize({
    orgId: user.orgId,
    connectionId: parsed.data.connectionId,
    redirectUri: parsed.data.redirectUri,
  });
  return NextResponse.json({ redirectTo: url, state });
}
