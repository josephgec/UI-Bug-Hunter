// Phase 3 RBAC. Three roles, deny-by-default permission map.
//
// We intentionally enumerate every permission rather than use a verb-based
// scheme like "*.write" — explicit lists are easier to audit and harder to
// accidentally widen with a refactor. Adding a new resource means adding a
// row here AND the call site that checks it; both should land in the same
// PR.

export const ROLES = ["admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // Org
  "org.read",
  "org.update",
  "org.member.list",
  "org.member.invite",
  "org.member.role_change",
  "org.member.remove",
  // Projects
  "project.create",
  "project.read",
  "project.update",
  "project.delete",
  // Scans / crawls / flows
  "scan.submit",
  "scan.read",
  "crawl.submit",
  "flow.create",
  "flow.update",
  "flow.delete",
  "flow.run",
  "flow.read",
  // Findings
  "finding.read",
  "finding.feedback",
  "finding.allowlist",
  // Credentials
  "credential.create",
  "credential.delete",
  "credential.list",
  // Destinations
  "destination.create",
  "destination.update",
  "destination.delete",
  "destination.list",
  "destination.dispatch_manual",
  // Billing
  "billing.read",
  "billing.checkout",
  "billing.cancel",
  // SSO
  "sso.connection.create",
  "sso.connection.delete",
  "sso.connection.read",
  // Audit log
  "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

// Permissions only admins ever have, even though some match the
// .read/.list pattern. Audit-log access in particular stays admin-only for
// SOC 2 separation-of-duties.
const ADMIN_ONLY: Set<Permission> = new Set<Permission>([
  "org.update",
  "org.member.role_change",
  "org.member.remove",
  "project.delete",
  "destination.create",
  "destination.update",
  "destination.delete",
  "sso.connection.create",
  "sso.connection.delete",
  "sso.connection.read",
  "billing.cancel",
  "audit.read",
]);

const READS: Permission[] = ALL.filter(
  (p) =>
    (/\.(read|list)$/.test(p) || p === "finding.feedback") && !ADMIN_ONLY.has(p),
);
const MEMBER: Permission[] = [
  ...READS,
  "project.create",
  "project.update",
  "scan.submit",
  "crawl.submit",
  "flow.create",
  "flow.update",
  "flow.delete",
  "flow.run",
  "finding.allowlist",
  "credential.create",
  "credential.delete",
  "destination.dispatch_manual",
  "billing.checkout",
];

const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  admin: new Set(ALL),
  member: new Set(MEMBER),
  viewer: new Set(READS),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]].sort();
}
