import { kycApp } from "@/apps/kyc/app";
import type { AppDefinition } from "@/platform/registry";

/** The app registry. Add new internal apps here; navigation and access checks derive from it. */
export const apps: AppDefinition[] = [kycApp];
