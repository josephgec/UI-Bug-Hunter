import { prisma } from "@ubh/db";
import { redactPayload, type AuditAction } from "@ubh/shared";

export interface AuditInput {
  orgId: string;
  userId?: string | null;
  action: AuditAction;
  targetKind?: string;
  targetId?: string;
  payload?: unknown;
  ipAddress?: string;
}

/**
 * Best-effort audit-log write. Failures are logged but do not throw — we
 * never want a missing audit row to block a real mutation. The redactor
 * strips sensitive keys from the payload before it lands in the database.
 */
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        orgId: input.orgId,
        userId: input.userId ?? null,
        action: input.action,
        targetKind: input.targetKind ?? null,
        targetId: input.targetId ?? null,
        payload: input.payload === undefined ? undefined : (redactPayload(input.payload) as never),
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] write failed:", err);
  }
}
