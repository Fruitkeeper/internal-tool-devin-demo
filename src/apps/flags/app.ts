import { ADMIN_ROLE } from "@/platform/authz";
import type { AppDefinition } from "@/platform/registry";
import { FLAGS_APPROVER, FLAGS_EDITOR } from "@/apps/flags/roles";

export const flagsApp: AppDefinition = {
  id: "flags",
  name: "Feature Flag Admin",
  description: "Change feature flags per environment; production changes need a second approver.",
  route: "/flags",
  roles: [FLAGS_EDITOR, FLAGS_APPROVER, ADMIN_ROLE],
  permissions: {
    [FLAGS_EDITOR]: "Edit (production needs approval)",
    [FLAGS_APPROVER]: "Approve production changes",
    [ADMIN_ROLE]: "View",
  },
};
