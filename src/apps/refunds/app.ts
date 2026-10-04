import { ADMIN_ROLE } from "@/platform/authz";
import type { AppDefinition } from "@/platform/registry";
import { REFUNDS_ANALYST, REFUNDS_REVIEWER } from "@/apps/refunds/roles";

export const refundsApp: AppDefinition = {
  id: "refunds",
  name: "Refunds Dashboard",
  description: "Recommend and approve customer refunds with maker-checker approval.",
  route: "/refunds",
  roles: [REFUNDS_ANALYST, REFUNDS_REVIEWER, ADMIN_ROLE],
};
