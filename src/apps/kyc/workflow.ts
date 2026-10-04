import { ValidationError } from "@/platform/errors";

export const CASE_STATUSES = ["pending", "in_review", "recommended", "approved", "rejected"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  pending: ["in_review"],
  in_review: ["recommended"],
  // A reviewer approving the recommendation applies its outcome; rejecting it sends the case back.
  recommended: ["approved", "rejected", "in_review"],
  approved: [],
  rejected: [],
};

export function isCaseStatus(value: string): value is CaseStatus {
  return (CASE_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: string, to: CaseStatus): boolean {
  return isCaseStatus(from) && TRANSITIONS[from].includes(to);
}

export function assertTransition(from: string, to: CaseStatus): void {
  if (!canTransition(from, to)) throw new ValidationError(`Invalid status transition: ${from} → ${to}`);
}

export function isTerminal(status: string): boolean {
  return status === "approved" || status === "rejected";
}

export const RISK_BANDS = {
  low: { gte: 0, lt: 40 },
  medium: { gte: 40, lt: 70 },
  high: { gte: 70, lte: 100 },
} as const;
export type RiskBand = keyof typeof RISK_BANDS;

export function riskBand(score: number): RiskBand {
  return score >= 70 ? "high" : score >= 40 ? "medium" : "low";
}

export function maskIdNumber(value: string): string {
  return "•".repeat(Math.max(0, value.length - 4)) + value.slice(-4);
}
