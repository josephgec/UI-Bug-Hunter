import { describe, expect, it } from "vitest";
import { can, permissionsFor, PERMISSIONS, ROLES } from "./rbac.js";

describe("rbac", () => {
  it("admin can do everything in PERMISSIONS", () => {
    for (const p of PERMISSIONS) {
      expect(can("admin", p), `admin should have ${p}`).toBe(true);
    }
  });

  it("viewer is read-only and excludes admin-sensitive reads", () => {
    expect(can("viewer", "project.read")).toBe(true);
    expect(can("viewer", "scan.read")).toBe(true);
    expect(can("viewer", "finding.feedback")).toBe(true);
    // SSO connections + audit log are admin-only even though they're reads.
    expect(can("viewer", "sso.connection.read")).toBe(false);
    expect(can("viewer", "audit.read")).toBe(false);
    // Viewer cannot mutate.
    expect(can("viewer", "scan.submit")).toBe(false);
    expect(can("viewer", "flow.create")).toBe(false);
  });

  it("member can run scans + flows but not change roles", () => {
    expect(can("member", "scan.submit")).toBe(true);
    expect(can("member", "flow.create")).toBe(true);
    expect(can("member", "flow.run")).toBe(true);
    expect(can("member", "credential.create")).toBe(true);
    expect(can("member", "destination.dispatch_manual")).toBe(true);
    expect(can("member", "org.member.role_change")).toBe(false);
    expect(can("member", "destination.create")).toBe(false);
    expect(can("member", "sso.connection.create")).toBe(false);
    expect(can("member", "audit.read")).toBe(false);
  });

  it("permissionsFor returns sorted unique permissions", () => {
    for (const role of ROLES) {
      const perms = permissionsFor(role);
      const sorted = [...perms].sort();
      expect(perms).toEqual(sorted);
      expect(new Set(perms).size).toBe(perms.length);
    }
  });
});
