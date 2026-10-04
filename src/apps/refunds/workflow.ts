import { ValidationError } from "@/platform/errors";

export const REFUND_STATUSES = ["pending", "recommended", "approved", "rejected"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

const TRANSITIONS: Record<RefundStatus, RefundStatus[]> = {
  pending: ["recommended"],
  recommended: ["approved", "rejected"],
  approved: [],
  rejected: [],
};

export function isRefundStatus(value: string): value is RefundStatus {
  return (REFUND_STATUSES as readonly string[]).includes(value);
}

export function assertTransition(from: string, to: RefundStatus): void {
  if (!isRefundStatus(from) || !TRANSITIONS[from].includes(to)) {
    throw new ValidationError(`Invalid status transition: ${from} → ${to}`);
  }
}

export function formatAmount(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
