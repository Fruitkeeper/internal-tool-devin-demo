import type { CurrentUser } from "@/platform/auth";
import { hasRole } from "@/platform/authz";

/** What every internal app declares about itself. The list of apps lives in src/apps/index.ts. */
export type AppDefinition = {
  id: string;
  name: string;
  description: string;
  route: string;
  /** Users need at least one of these roles to see or open the app. */
  roles: string[];
};

export function canAccessApp(user: CurrentUser, app: AppDefinition): boolean {
  return hasRole(user, app.roles);
}

export function accessibleApps(user: CurrentUser, apps: AppDefinition[]): AppDefinition[] {
  return apps.filter((app) => canAccessApp(user, app));
}
