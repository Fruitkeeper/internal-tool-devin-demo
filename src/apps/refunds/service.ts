import type { Prisma, Refund } from "@prisma/client";
import type { CurrentUser } from "@/platform/auth";
import { requireRole } from "@/platform/authz";
import { auditHistoryFor, recordAudit } from "@/platform/audit";
import { decideApproval, getPendingApproval, listApprovals, submitApproval } from "@/platform/approvals";
import { db, type Tx } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import { refundsApp } from "@/apps/refunds/app";
import { REFUNDS_ANALYST, REFUNDS_REVIEWER } from "@/apps/refunds/roles";
import { assertTransition, isRefundStatus } from "@/apps/refunds/workflow";

const ENTITY = "Refund";
const READ_ROLES = refundsApp.roles;
const ANALYST_ROLES = [REFUNDS_ANALYST];
const REVIEWER_ROLES = [REFUNDS_REVIEWER];

async function loadRefund(tx: Tx, id: string): Promise<Refund> {
  const r = await tx.refund.findUnique({ where: { id } });
  if (!r) throw new NotFoundError("Refund not found");
  return r;
}

async function setStatus(
  tx: Tx,
  ctx: { user: CurrentUser; role: string; action: string },
  current: Refund,
  status: string,
  auditExtra: Record<string, unknown> = {},
) {
  const updated = await tx.refund.update({ where: { id: current.id, status: current.status }, data: { status } });
  await recordAudit(tx, {
    user: ctx.user,
    role: ctx.role,
    appId: refundsApp.id,
    action: ctx.action,
    entityType: ENTITY,
    entityId: current.id,
    before: current,
    after: { ...updated, ...auditExtra },
  });
  return updated;
}

// ---------- Queries ----------

/** Amount bounds are in dollars, as typed into the queue filters. */
export type RefundFilters = { status?: string; minAmount?: number; maxAmount?: number };

export async function listRefunds(user: CurrentUser, filters: RefundFilters = {}) {
  requireRole(user, READ_ROLES);
  const where: Prisma.RefundWhereInput = {};
  if (filters.status && isRefundStatus(filters.status)) where.status = filters.status;
  const amountCents: Prisma.IntFilter = {};
  if (filters.minAmount !== undefined && !Number.isNaN(filters.minAmount)) amountCents.gte = Math.round(filters.minAmount * 100);
  if (filters.maxAmount !== undefined && !Number.isNaN(filters.maxAmount)) amountCents.lte = Math.round(filters.maxAmount * 100);
  if (Object.keys(amountCents).length) where.amountCents = amountCents;
  return db.refund.findMany({ where, orderBy: { createdAt: "asc" } });
}

export async function getRefund(user: CurrentUser, id: string) {
  requireRole(user, READ_ROLES);
  const refund = await loadRefund(db, id);
  const approvals = await listApprovals(ENTITY, id);
  const history = await auditHistoryFor([
    { entityType: ENTITY, entityId: id },
    ...approvals.map((a) => ({ entityType: "Approval", entityId: a.id })),
  ]);
  return { refund, pendingApproval: approvals.find((a) => a.status === "pending") ?? null, history };
}

// ---------- Mutations ----------

/** Analyst recommends issuing the refund; creates a maker-checker approval. */
export async function recommendRefund(user: CurrentUser, refundId: string, note: string) {
  const role = requireRole(user, ANALYST_ROLES);
  return db.$transaction(async (tx) => {
    const r = await loadRefund(tx, refundId);
    assertTransition(r.status, "recommended");
    const approval = await submitApproval(tx, {
      appId: refundsApp.id,
      entityType: ENTITY,
      entityId: r.id,
      user,
      makerRoles: ANALYST_ROLES,
      proposedAction: "refund",
      note,
    });
    return setStatus(tx, { user, role, action: "refund.recommended" }, r, "recommended", { approvalId: approval.id });
  });
}

/** Reviewer approves (refund is issued) or rejects (refund is denied) the pending recommendation. */
export async function decideRefund(user: CurrentUser, refundId: string, decision: string, note?: string) {
  const role = requireRole(user, REVIEWER_ROLES);
  if (decision !== "approved" && decision !== "rejected") throw new ValidationError("Decision must be approved or rejected");
  return db.$transaction(async (tx) => {
    const r = await loadRefund(tx, refundId);
    assertTransition(r.status, decision);
    const pending = await getPendingApproval(ENTITY, r.id, tx);
    if (!pending) throw new ValidationError("This refund has no pending recommendation");
    await decideApproval(tx, { approvalId: pending.id, user, checkerRoles: REVIEWER_ROLES, decision, note });
    return setStatus(tx, { user, role, action: `refund.${decision}` }, r, decision, { approvalId: pending.id });
  });
}
