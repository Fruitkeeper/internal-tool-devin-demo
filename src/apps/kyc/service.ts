import type { KycCase, Prisma } from "@prisma/client";
import type { CurrentUser } from "@/platform/auth";
import { ADMIN_ROLE, requireRole } from "@/platform/authz";
import { auditHistoryFor, recordAudit } from "@/platform/audit";
import { decideApproval, getPendingApproval, listApprovals, submitApproval } from "@/platform/approvals";
import { db, type Tx } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import { kycApp } from "@/apps/kyc/app";
import { KYC_ANALYST, KYC_REVIEWER } from "@/apps/kyc/roles";
import { assertTransition, isCaseStatus, isTerminal, maskIdNumber, RISK_BANDS, type CaseStatus, type RiskBand } from "@/apps/kyc/workflow";

// All business rules and authorization live here. Server actions and tests call these functions.

const ENTITY = "KycCase";
const READ_ROLES = kycApp.roles;
const ANALYST_ROLES = [KYC_ANALYST];
const REVIEWER_ROLES = [KYC_REVIEWER];
const REVEAL_ROLES = [KYC_REVIEWER, ADMIN_ROLE];

export type PublicCase = Omit<KycCase, "idDocNumber"> & { idDocNumberMasked: string };

/** Strips the full ID number. Used for pages and for audit snapshots. */
function toPublic(c: KycCase): PublicCase {
  const { idDocNumber, ...rest } = c;
  return { ...rest, idDocNumberMasked: maskIdNumber(idDocNumber) };
}

async function loadCase(tx: Tx, id: string): Promise<KycCase> {
  const c = await tx.kycCase.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("Case not found");
  return c;
}

async function updateCase(
  tx: Tx,
  ctx: { user: CurrentUser; role: string; action: string },
  current: KycCase,
  data: Prisma.KycCaseUpdateInput,
  auditExtra: Record<string, unknown> = {},
) {
  // Optimistic check: only update if the status hasn't changed since we read it.
  const updated = await tx.kycCase.update({ where: { id: current.id, status: current.status }, data });
  await recordAudit(tx, {
    user: ctx.user,
    role: ctx.role,
    appId: kycApp.id,
    action: ctx.action,
    entityType: ENTITY,
    entityId: current.id,
    before: toPublic(current),
    after: { ...toPublic(updated), ...auditExtra },
  });
  return updated;
}

// ---------- Queries ----------

export type CaseSort = "risk_desc" | "risk_asc" | "age_desc" | "age_asc";
export type CaseFilters = { status?: string; risk?: string; sort?: CaseSort; escalated?: boolean };

const SORTS: Record<CaseSort, Prisma.KycCaseOrderByWithRelationInput> = {
  risk_desc: { riskScore: "desc" },
  risk_asc: { riskScore: "asc" },
  age_desc: { createdAt: "asc" }, // oldest first
  age_asc: { createdAt: "desc" }, // newest first
};

export async function listCases(user: CurrentUser, filters: CaseFilters = {}): Promise<PublicCase[]> {
  requireRole(user, READ_ROLES);
  const where: Prisma.KycCaseWhereInput = {};
  if (filters.status && isCaseStatus(filters.status)) where.status = filters.status;
  if (filters.risk && filters.risk in RISK_BANDS) where.riskScore = RISK_BANDS[filters.risk as RiskBand];
  if (filters.escalated) where.escalated = true;
  const cases = await db.kycCase.findMany({ where, orderBy: SORTS[filters.sort ?? "risk_desc"] ?? SORTS.risk_desc });
  return cases.map(toPublic);
}

export async function getCase(user: CurrentUser, id: string) {
  requireRole(user, READ_ROLES);
  const c = await loadCase(db, id);
  const approvals = await listApprovals(ENTITY, id);
  const history = await auditHistoryFor([
    { entityType: ENTITY, entityId: id },
    ...approvals.map((a) => ({ entityType: "Approval", entityId: a.id })),
  ]);
  return {
    case: toPublic(c),
    pendingApproval: approvals.find((a) => a.status === "pending") ?? null,
    approvals,
    history,
  };
}

// ---------- Mutations ----------

export async function startReview(user: CurrentUser, caseId: string) {
  const role = requireRole(user, ANALYST_ROLES);
  return db.$transaction(async (tx) => {
    const c = await loadCase(tx, caseId);
    assertTransition(c.status, "in_review");
    return updateCase(tx, { user, role, action: "case.review_started" }, c, { status: "in_review" });
  });
}

export async function recommend(user: CurrentUser, caseId: string, outcome: string, note: string) {
  const role = requireRole(user, ANALYST_ROLES);
  if (outcome !== "approve" && outcome !== "reject") throw new ValidationError("Recommendation must be approve or reject");
  return db.$transaction(async (tx) => {
    const c = await loadCase(tx, caseId);
    assertTransition(c.status, "recommended");
    const approval = await submitApproval(tx, {
      appId: kycApp.id,
      entityType: ENTITY,
      entityId: c.id,
      user,
      makerRoles: ANALYST_ROLES,
      proposedAction: outcome,
      note,
    });
    return updateCase(tx, { user, role, action: "case.recommended" }, c, { status: "recommended" }, {
      recommendation: outcome,
      approvalId: approval.id,
    });
  });
}

/** Reviewer's final decision on the pending recommendation (maker-checker). */
export async function decide(user: CurrentUser, caseId: string, decision: string, note?: string) {
  const role = requireRole(user, REVIEWER_ROLES);
  if (decision !== "approved" && decision !== "rejected") throw new ValidationError("Decision must be approved or rejected");
  return db.$transaction(async (tx) => {
    const c = await loadCase(tx, caseId);
    const pending = await getPendingApproval(ENTITY, c.id, tx);
    if (!pending) throw new ValidationError("This case has no pending recommendation");
    const next: CaseStatus =
      decision === "approved" ? (pending.proposedAction === "approve" ? "approved" : "rejected") : "in_review";
    assertTransition(c.status, next);
    await decideApproval(tx, { approvalId: pending.id, user, checkerRoles: REVIEWER_ROLES, decision, note });
    const action = decision === "approved" ? "case.decided" : "case.recommendation_rejected";
    return updateCase(tx, { user, role, action }, c, { status: next }, { approvalId: pending.id });
  });
}

export async function escalate(user: CurrentUser, caseId: string, reason: string) {
  const role = requireRole(user, ANALYST_ROLES);
  if (!reason.trim()) throw new ValidationError("An escalation reason is required");
  return db.$transaction(async (tx) => {
    const c = await loadCase(tx, caseId);
    if (isTerminal(c.status)) throw new ValidationError("Closed cases cannot be escalated");
    if (c.escalated) throw new ValidationError("Case is already escalated");
    return updateCase(tx, { user, role, action: "case.escalated" }, c, { escalated: true }, {
      escalationReason: reason.trim(),
    });
  });
}

/** Returns the full ID document number and records the reveal in the audit log. */
export async function revealIdNumber(user: CurrentUser, caseId: string): Promise<string> {
  const role = requireRole(user, REVEAL_ROLES);
  return db.$transaction(async (tx) => {
    const c = await loadCase(tx, caseId);
    await recordAudit(tx, {
      user,
      role,
      appId: kycApp.id,
      action: "case.id_revealed",
      entityType: ENTITY,
      entityId: c.id,
      after: { field: "idDocNumber" },
    });
    return c.idDocNumber;
  });
}
