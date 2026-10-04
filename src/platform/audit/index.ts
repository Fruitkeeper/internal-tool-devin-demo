import type { CurrentUser } from "@/platform/auth";
import { db, type Tx } from "@/platform/db";

export type AuditInput = {
  user: CurrentUser;
  /** The role that authorized the action (returned by requireRole). */
  role: string;
  appId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
};

/**
 * Append an audit entry. Requires a transaction client so the entry is written
 * atomically with the state change it describes.
 */
export function recordAudit(tx: Tx, input: AuditInput) {
  return tx.auditLog.create({
    data: {
      userId: input.user.id,
      userName: input.user.name,
      role: input.role,
      appId: input.appId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before === undefined ? null : JSON.stringify(input.before),
      after: input.after === undefined ? null : JSON.stringify(input.after),
    },
  });
}

export type AuditFilters = {
  appId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  userId?: string;
};

export function listAuditEntries(filters: AuditFilters = {}, take = 200) {
  const where = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  return db.auditLog.findMany({ where, orderBy: { id: "desc" }, take });
}

/** Audit history for a set of entities, e.g. a case plus its approval requests. */
export function auditHistoryFor(refs: { entityType: string; entityId: string }[]) {
  if (refs.length === 0) return Promise.resolve([]);
  return db.auditLog.findMany({ where: { OR: refs }, orderBy: { id: "asc" } });
}
