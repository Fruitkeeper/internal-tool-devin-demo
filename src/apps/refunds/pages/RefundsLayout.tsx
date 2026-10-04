import type { ReactNode } from "react";
import { getCurrentUser } from "@/platform/auth";
import { canAccessApp } from "@/platform/registry";
import { AccessDenied } from "@/platform/ui/components";
import { refundsApp } from "@/apps/refunds/app";

// UI guard only; every service function enforces authorization independently.
export default async function RefundsLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!canAccessApp(user, refundsApp)) return <AccessDenied />;
  return <>{children}</>;
}
