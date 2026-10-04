import { ADMIN_ROLE } from "@/platform/authz";
import type { AppDefinition } from "@/platform/registry";
import { KYC_ANALYST, KYC_REVIEWER } from "@/apps/kyc/roles";

export const kycApp: AppDefinition = {
  id: "kyc",
  name: "KYC Review",
  description: "Review customer identity cases with maker-checker approval.",
  route: "/kyc",
  roles: [KYC_ANALYST, KYC_REVIEWER, ADMIN_ROLE],
  permissions: {
    [KYC_ANALYST]: "Review & recommend",
    [KYC_REVIEWER]: "Approve / reject",
    [ADMIN_ROLE]: "View + reveal IDs",
  },
};
