import { type CurrentUser, toCurrentUser } from "@/platform/auth";
import { ADMIN_ROLE, requireRole } from "@/platform/authz";
import { recordAudit } from "@/platform/audit";
import { db } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import { type AppDefinition, canAccessApp } from "@/platform/registry";

/**
 * Central access control (admin only). There is no separate permission model: a user's
 * access to every app is derived from `User.roles` and each app's registry entry.
 * Callers pass the registry in, because src/platform never imports from src/apps.
 */
export const ACCESS_APP_ID = "access";

/** Every role an admin can assign: the platform admin role, then each app's roles in registry order. */
export function assignableRoles(apps: AppDefinition[]): string[] {
  return [...new Set([ADMIN_ROLE, ...apps.flatMap((a) => a.roles)])];
}

export type AppAccess = { appId: string; canAccess: boolean; permissions: string[] };

export function appAccessFor(user: CurrentUser, apps: AppDefinition[]): AppAccess[] {
  return apps.map((app) => ({
    appId: app.id,
    canAccess: canAccessApp(user, app),
    permissions: app.roles.filter((r) => user.roles.includes(r)).map((r) => app.permissions?.[r] ?? r),
  }));
}

export async function listUserAccess(actor: CurrentUser, apps: AppDefinition[]) {
  requireRole(actor, [ADMIN_ROLE]);
  const rows = await db.user.findMany({ orderBy: { id: "asc" } });
  return rows.map(toCurrentUser).map((user) => ({ user, apps: appAccessFor(user, apps) }));
}

/** Replace a user's roles. Granting or revoking an app = adding or removing that app's roles. */
export async function setUserRoles(actor: CurrentUser, targetUserId: string, roles: string[], apps: AppDefinition[]) {
  const actorRole = requireRole(actor, [ADMIN_ROLE]);
  const known = assignableRoles(apps);
  const unknown = roles.filter((r) => !known.includes(r));
  if (unknown.length > 0) throw new ValidationError(`Unknown role: ${unknown.join(", ")}`);
  const next = known.filter((r) => roles.includes(r));

  return db.$transaction(async (tx) => {
    const row = await tx.user.findUnique({ where: { id: targetUserId } });
    if (!row) throw new NotFoundError("User not found");
    const target = toCurrentUser(row);
    if (target.id === actor.id && target.roles.includes(ADMIN_ROLE) && !next.includes(ADMIN_ROLE)) {
      throw new ValidationError("You can't remove your own admin role");
    }
    if (target.roles.length === next.length && next.every((r) => target.roles.includes(r))) {
      throw new ValidationError("No changes to save");
    }
    await tx.user.update({ where: { id: target.id }, data: { roles: next.join(",") } });
    await recordAudit(tx, {
      user: actor,
      role: actorRole,
      appId: ACCESS_APP_ID,
      action: "user.roles_changed",
      entityType: "User",
      entityId: target.id,
      before: { user: target.name, roles: target.roles },
      after: { user: target.name, roles: next },
    });
    return { before: target.roles, after: next };
  });
}
