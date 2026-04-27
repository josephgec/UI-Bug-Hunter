import { NextResponse } from "next/server";
import { can, type Permission } from "@ubh/shared";
import type { AuthedUser } from "./auth.js";

/**
 * Returns a 403 response if the user cannot perform `permission`, otherwise
 * `null` so the route handler can continue. Single-purpose helper rather
 * than a wrapping middleware so route handlers retain their own typing.
 *
 *   const denied = await requirePermission(user, "flow.create");
 *   if (denied) return denied;
 */
export async function requirePermission(
  user: AuthedUser,
  permission: Permission,
): Promise<Response | null> {
  if (can(user.role, permission)) return null;
  return NextResponse.json(
    { error: "forbidden", permission, role: user.role },
    { status: 403 },
  );
}
