// Stable audit-action verbs. Keep these lowercase noun.verb so they sort and
// filter cleanly in the dashboard; do not rename without adding a migration
// for the audit_log.action column (see packages/db/prisma/schema.prisma).
export const AUDIT_ACTIONS = [
  // Auth
  "user.login",
  "user.logout",
  "user.invited",
  "user.role_changed",
  "user.removed",
  "api_token.created",
  "api_token.revoked",
  // Project / scan
  "project.created",
  "project.updated",
  "project.deleted",
  "scan.submitted",
  "scan.canceled",
  "crawl.submitted",
  "flow.created",
  "flow.updated",
  "flow.deleted",
  "flow.run_submitted",
  // Credentials
  "credential.created",
  "credential.deleted",
  "credential.used", // worker decrypted at scan time
  // Allowlists / feedback
  "finding.feedback_submitted",
  "finding.allowlisted",
  // Destinations
  "destination.created",
  "destination.updated",
  "destination.deleted",
  "destination.dispatched",
  // Billing
  "billing.checkout_started",
  "billing.plan_changed",
  "billing.subscription_canceled",
  // SSO
  "sso.connection_created",
  "sso.connection_deleted",
  "sso.user_provisioned", // SCIM
  "sso.user_deprovisioned",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// Keys we must never persist into the audit_log.payload JSON. Any property
// matching one of these names (case-insensitive, anywhere in the payload's
// nested structure) gets replaced with the literal string "[redacted]".
export const REDACT_KEYS = new Set([
  "password",
  "secret",
  "apikey",
  "api_key",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "ciphertext",
  "iv",
  "private_key",
  "client_secret",
  "stripe_secret_key",
]);

/**
 * Deep-clone `payload`, replacing any key whose lowercased name is in
 * REDACT_KEYS with "[redacted]". Used by the audit logger before writing.
 *
 * Cycle-safe: tracks visited objects and stops recursing.
 */
export function redactPayload(payload: unknown): unknown {
  const seen = new WeakSet<object>();
  return walk(payload);

  function walk(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value as object)) return "[circular]";
    seen.add(value as object);

    if (Array.isArray(value)) return value.map(walk);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(k.toLowerCase())) {
        out[k] = "[redacted]";
      } else {
        out[k] = walk(v);
      }
    }
    return out;
  }
}
