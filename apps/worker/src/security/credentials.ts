import { z } from "zod";
import { prisma, CredentialKind } from "@ubh/db";
import { getKms } from "@ubh/shared";
import type { AuthInjection } from "../browser.js";

// Plaintext shapes for each kind of credential. The validator exists to keep
// "garbage in the database" from blowing up the worker — credentials are
// trusted on insert (the API does the same validation), but a corrupt row
// shouldn't crash a scan.
const HeaderPlaintext = z.object({ name: z.string(), value: z.string() });
const CookiePlaintext = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().optional(),
  path: z.string().optional(),
});
const BasicAuthPlaintext = z.object({ username: z.string(), password: z.string() });

export type CredentialPlaintext =
  | { kind: "HEADER"; data: z.infer<typeof HeaderPlaintext> }
  | { kind: "COOKIE"; data: z.infer<typeof CookiePlaintext> }
  | { kind: "BASIC_AUTH"; data: z.infer<typeof BasicAuthPlaintext> };

export async function encryptCredentialPlaintext(
  pt: CredentialPlaintext,
): Promise<{ ciphertext: Buffer; iv: Buffer; keyId: string }> {
  const kms = getKms();
  const json = JSON.stringify(pt.data);
  return kms.encrypt(Buffer.from(json, "utf8"));
}

/**
 * Load credentials by id, decrypt them, and shape into an AuthInjection. The
 * BrowserSession applies the result to its contexts; plaintext never leaves
 * this function's stack.
 */
export async function loadAuthInjection(credentialIds: string[]): Promise<AuthInjection | undefined> {
  if (credentialIds.length === 0) return undefined;
  const rows = await prisma.credential.findMany({
    where: { id: { in: credentialIds } },
  });
  if (rows.length === 0) return undefined;

  const kms = getKms();
  const out: AuthInjection = {};
  for (const row of rows) {
    const plaintext = await kms.decrypt({
      ciphertext: Buffer.from(row.ciphertext as unknown as Buffer),
      iv: Buffer.from(row.iv as unknown as Buffer),
      keyId: row.keyId,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext.toString("utf8"));
    } catch {
      continue;
    }
    if (row.kind === CredentialKind.HEADER) {
      const v = HeaderPlaintext.safeParse(parsed);
      if (!v.success) continue;
      out.headers = { ...(out.headers ?? {}), [v.data.name]: v.data.value };
    } else if (row.kind === CredentialKind.COOKIE) {
      const v = CookiePlaintext.safeParse(parsed);
      if (!v.success) continue;
      out.cookies = [
        ...(out.cookies ?? []),
        {
          name: v.data.name,
          value: v.data.value,
          ...(v.data.domain ? { domain: v.data.domain } : {}),
          ...(v.data.path ? { path: v.data.path } : {}),
        },
      ];
    } else if (row.kind === CredentialKind.BASIC_AUTH) {
      const v = BasicAuthPlaintext.safeParse(parsed);
      if (!v.success) continue;
      out.basicAuth = { username: v.data.username, password: v.data.password };
    }
    // Best-effort: bump lastUsedAt so the dashboard can show staleness.
    void prisma.credential
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }
  return out;
}

export const CredentialKindSchema = z.enum(["HEADER", "COOKIE", "BASIC_AUTH"]);
export const CredentialPlaintextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("HEADER"), data: HeaderPlaintext }),
  z.object({ kind: z.literal("COOKIE"), data: CookiePlaintext }),
  z.object({ kind: z.literal("BASIC_AUTH"), data: BasicAuthPlaintext }),
]);
