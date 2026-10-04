import type { CurrentUser } from "@/platform/auth";
import { requireRole } from "@/platform/authz";
import { recordAudit } from "@/platform/audit";
import { db, type Tx } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";

/**
 * Generic maker-checker. A maker submits a proposed action on an entity; a different user
 * with a checker role approves or rejects it. Apply your own entity's state change in the
 * same transaction, based on the returned approval.
 */

type ApprovalRow = { status: string; proposedAction: string; note: string; submittedById: string; decidedById: string | null; decisionNote: string | null };

/** The fields worth keeping in audit snapshots. */
const snapshot = (a: ApprovalRow) => ({
  status: a.status,
  proposedAction: a.proposedAction,
  note: a.note,
  submittedById: a.submittedById,
  decidedById: a.decidedById,
  decisionNote: a.decisionNote,
});

export type EntityRef = { appId: string; entityType: string; entityId: string };

export async function submitApproval(
  tx: Tx,
  input: EntityRef & { user: CurrentUser; makerRoles: string[]; proposedAction: string; note: string },
) {
  const role = requireRole(input.user, input.makerRoles);
  const note = input.note.trim();
  if (!note) throw new ValidationError("A note is required");

  const existing = await tx.approval.findFirst({
    where: { entityType: input.entityType, entityId: input.entityId, status: "pending" },
  });
  if (existing) throw new ValidationError("There is already a pending approval for this item");

  const approval = await tx.approval.create({
    data: {
      appId: input.appId,
      entityType: input.entityType,
      entityId: input.entityId,
      proposedAction: input.proposedAction,
      note,
      submittedById: input.user.id,
    },
  });
  await recordAudit(tx, {
    user: input.user,
    role,
    appId: input.appId,
    action: "approval.submitted",
    entityType: "Approval",
    entityId: approval.id,
    after: snapshot(approval),
  });
  return approval;
}

export async function decideApproval(
  tx: Tx,
  input: {
    approvalId: string;
    user: CurrentUser;
    checkerRoles: string[];
    decision: "approved" | "rejected";
    note?: string;
  },
) {
  const role = requireRole(input.user, input.checkerRoles);
  const before = await tx.approval.findUnique({ where: { id: input.approvalId } });
  if (!before) throw new NotFoundError("Approval not found");
  if (before.status !== "pending") throw new ValidationError("This approval has already been decided");
  if (before.submittedById === input.user.id) {
    throw new ForbiddenError("You cannot approve or reject your own submission");
  }

  const after = await tx.approval.update({
    where: { id: before.id, status: "pending" },
    data: {
      status: input.decision,
      decidedById: input.user.id,
      decisionNote: input.note?.trim() || null,
      decidedAt: new Date(),
    },
  });
  await recordAudit(tx, {
    user: input.user,
    role,
    appId: before.appId,
    action: `approval.${input.decision}`,
    entityType: "Approval",
    entityId: before.id,
    before: snapshot(before),
    after: snapshot(after),
  });
  return after;
}

export function getPendingApproval(entityType: string, entityId: string, client: Tx = db) {
  return client.approval.findFirst({
    where: { entityType, entityId, status: "pending" },
    include: { submittedBy: true },
  });
}

export function listApprovals(entityType: string, entityId: string) {
  return db.approval.findMany({
    where: { entityType, entityId },
    include: { submittedBy: true, decidedBy: true },
    orderBy: { createdAt: "asc" },
  });
}
