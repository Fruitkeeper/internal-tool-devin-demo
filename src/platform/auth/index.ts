import { cookies } from "next/headers";
import { db } from "@/platform/db";

/**
 * Prototype authentication: the current user is chosen with the header user switcher
 * and stored in a cookie. Replace the body of getCurrentUser() with an OIDC / Entra ID
 * session lookup later; the rest of the app only depends on this interface.
 */
export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  roles: string[];
};

export const DEMO_USER_COOKIE = "demo_user_id";

type UserRow = { id: string; name: string; email: string; roles: string };

export function toCurrentUser(row: UserRow): CurrentUser {
  return { ...row, roles: row.roles.split(",").map((r) => r.trim()).filter(Boolean) };
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const id = (await cookies()).get(DEMO_USER_COOKIE)?.value;
  const row =
    (id && (await db.user.findUnique({ where: { id } }))) ||
    (await db.user.findFirst({ orderBy: { id: "asc" } }));
  if (!row) throw new Error("No users found. Run `npm run db:setup`.");
  return toCurrentUser(row);
}

export async function listDemoUsers(): Promise<CurrentUser[]> {
  const rows = await db.user.findMany({ orderBy: { id: "asc" } });
  return rows.map(toCurrentUser);
}
