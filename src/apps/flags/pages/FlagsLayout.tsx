import type { ReactNode } from "react";
import { getCurrentUser } from "@/platform/auth";
import { canAccessApp } from "@/platform/registry";
import { AccessDenied } from "@/platform/ui/components";
import { flagsApp } from "@/apps/flags/app";

// UI guard only; every service function enforces authorization independently.
export default async function FlagsLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!canAccessApp(user, flagsApp)) return <AccessDenied />;
  return <>{children}</>;
}
