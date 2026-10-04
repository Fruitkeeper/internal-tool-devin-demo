import type { CurrentUser } from "@/platform/auth";
import { ForbiddenError } from "@/platform/errors";

/** Platform-level role. Apps define their own role ids (see src/apps/<app>/roles.ts). */
export const ADMIN_ROLE = "admin";

export function hasRole(user: CurrentUser, roles: readonly string[]): boolean {
  return roles.some((r) => user.roles.includes(r));
}

/**
 * Server-side authorization check. Throws ForbiddenError unless the user holds one of `roles`.
 * Returns the matching role so it can be recorded in the audit log.
 */
export function requireRole(user: CurrentUser, roles: readonly string[]): string {
  const role = roles.find((r) => user.roles.includes(r));
  if (!role) throw new ForbiddenError(`Requires one of: ${roles.join(", ")}`);
  return role;
}
