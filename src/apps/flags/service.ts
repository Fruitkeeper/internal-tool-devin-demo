import type { FeatureFlag, Prisma } from "@prisma/client";
import type { CurrentUser } from "@/platform/auth";
import { requireRole } from "@/platform/authz";
import { auditHistoryFor, recordAudit } from "@/platform/audit";
import { decideApproval, getPendingApproval, listApprovals, submitApproval } from "@/platform/approvals";
import { db, type Tx } from "@/platform/db";
import { NotFoundError, ValidationError } from "@/platform/errors";
import { flagsApp } from "@/apps/flags/app";
import { decodeProposal, encodeProposal, isEnvironment, requiresApproval, sameConfig, validateConfig, type FlagConfig } from "@/apps/flags/config";
import { FLAGS_APPROVER, FLAGS_EDITOR } from "@/apps/flags/roles";

const ENTITY = "FeatureFlag";
const READ_ROLES = flagsApp.roles;
const EDITOR_ROLES = [FLAGS_EDITOR];
const APPROVER_ROLES = [FLAGS_APPROVER];

async function loadFlag(tx: Tx, id: string): Promise<FeatureFlag> {
  const f = await tx.featureFlag.findUnique({ where: { id } });
  if (!f) throw new NotFoundError("Flag not found");
  return f;
}

async function applyConfig(
  tx: Tx,
  ctx: { user: CurrentUser; role: string },
  current: FeatureFlag,
  config: FlagConfig,
  auditExtra: Record<string, unknown> = {},
) {
  const updated = await tx.featureFlag.update({ where: { id: current.id }, data: config });
  await recordAudit(tx, {
    user: ctx.user,
    role: ctx.role,
    appId: flagsApp.id,
    action: "flag.updated",
    entityType: ENTITY,
    entityId: current.id,
    before: current,
    after: { ...updated, ...auditExtra },
  });
  return updated;
}

// ---------- Queries ----------

export async function listFlags(user: CurrentUser, filters: { environment?: string } = {}) {
  requireRole(user, READ_ROLES);
  const where: Prisma.FeatureFlagWhereInput = {};
  if (filters.environment && isEnvironment(filters.environment)) where.environment = filters.environment;
  const [flags, pending] = await Promise.all([
    db.featureFlag.findMany({ where, orderBy: [{ key: "asc" }, { environment: "asc" }] }),
    db.approval.findMany({ where: { appId: flagsApp.id, status: "pending" }, select: { entityId: true } }),
  ]);
  const pendingIds = new Set(pending.map((p) => p.entityId));
  return flags.map((f) => ({ ...f, hasPendingChange: pendingIds.has(f.id) }));
}

export async function getFlag(user: CurrentUser, id: string) {
  requireRole(user, READ_ROLES);
  const flag = await loadFlag(db, id);
  const approvals = await listApprovals(ENTITY, id);
  const history = await auditHistoryFor([
    { entityType: ENTITY, entityId: id },
    ...approvals.map((a) => ({ entityType: "Approval", entityId: a.id })),
  ]);
  const pending = approvals.find((a) => a.status === "pending") ?? null;
  return { flag, pendingChange: pending && { approval: pending, proposed: decodeProposal(pending.proposedAction) }, history };
}

// ---------- Mutations ----------

/**
 * Editor changes a flag's config. Development and staging apply immediately;
 * production creates a pending approval and the flag is unchanged until a different approver approves.
 */
export async function changeFlag(user: CurrentUser, flagId: string, input: FlagConfig, note = "") {
  const role = requireRole(user, EDITOR_ROLES);
  const config = validateConfig(input);
  return db.$transaction(async (tx) => {
    const flag = await loadFlag(tx, flagId);
    if (sameConfig(flag, config)) throw new ValidationError("No changes to save");

    if (!requiresApproval(flag.environment)) {
      await applyConfig(tx, { user, role }, flag, config);
      return { applied: true };
    }

    const approval = await submitApproval(tx, {
      appId: flagsApp.id,
      entityType: ENTITY,
      entityId: flag.id,
      user,
      makerRoles: EDITOR_ROLES,
      proposedAction: encodeProposal(config),
      note,
    });
    await recordAudit(tx, {
      user,
      role,
      appId: flagsApp.id,
      action: "flag.change_requested",
      entityType: ENTITY,
      entityId: flag.id,
      before: { enabled: flag.enabled, rolloutPct: flag.rolloutPct },
      after: { ...config, approvalId: approval.id },
    });
    return { applied: false, approvalId: approval.id };
  });
}

/** Approver approves (the proposed config takes effect) or rejects (flag unchanged) a pending production change. */
export async function decideFlagChange(user: CurrentUser, flagId: string, decision: string, note?: string) {
  const role = requireRole(user, APPROVER_ROLES);
  if (decision !== "approved" && decision !== "rejected") throw new ValidationError("Decision must be approved or rejected");
  return db.$transaction(async (tx) => {
    const flag = await loadFlag(tx, flagId);
    const pending = await getPendingApproval(ENTITY, flag.id, tx);
    if (!pending) throw new ValidationError("This flag has no pending change");
    await decideApproval(tx, { approvalId: pending.id, user, checkerRoles: APPROVER_ROLES, decision, note });
    if (decision === "approved") {
      await applyConfig(tx, { user, role }, flag, decodeProposal(pending.proposedAction), { approvalId: pending.id });
    }
  });
}
