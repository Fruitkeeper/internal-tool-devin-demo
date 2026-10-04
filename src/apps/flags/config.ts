import { ValidationError } from "@/platform/errors";

export const ENVIRONMENTS = ["development", "staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export type FlagConfig = { enabled: boolean; rolloutPct: number };

export const isEnvironment = (v: string): v is Environment => (ENVIRONMENTS as readonly string[]).includes(v);

/** Production changes go through maker-checker; other environments apply immediately. */
export const requiresApproval = (environment: string) => environment === "production";

export function validateConfig(c: FlagConfig): FlagConfig {
  if (typeof c.enabled !== "boolean") throw new ValidationError("Enabled must be true or false");
  if (!Number.isInteger(c.rolloutPct) || c.rolloutPct < 0 || c.rolloutPct > 100) {
    throw new ValidationError("Rollout must be a whole number from 0 to 100");
  }
  return { enabled: c.enabled, rolloutPct: c.rolloutPct };
}

export const sameConfig = (a: FlagConfig, b: FlagConfig) => a.enabled === b.enabled && a.rolloutPct === b.rolloutPct;

// The platform Approval stores the proposal as a string, so the proposed config is JSON in `proposedAction`.
export const encodeProposal = (c: FlagConfig) => JSON.stringify(c);
export const decodeProposal = (s: string): FlagConfig => validateConfig(JSON.parse(s));

export const describeConfig = (c: FlagConfig) => (c.enabled ? `on, ${c.rolloutPct}%` : "off");
