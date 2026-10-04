import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/platform/auth";
import { hasRole } from "@/platform/authz";
import { NotFoundError } from "@/platform/errors";
import { AuditChanges } from "@/platform/ui/AuditChanges";
import { Badge, buttonClass, Card, ErrorBanner, inputClass } from "@/platform/ui/components";
import { changeFlagAction, decideFlagChangeAction } from "@/apps/flags/actions";
import { describeConfig, requiresApproval } from "@/apps/flags/config";
import { FLAGS_APPROVER, FLAGS_EDITOR } from "@/apps/flags/roles";
import { getFlag } from "@/apps/flags/service";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function FlagPage({ params, searchParams }: Props) {
  const [{ id }, { error }, user] = await Promise.all([params, searchParams, getCurrentUser()]);
  const { flag: f, pendingChange, history } = await getFlag(user, decodeURIComponent(id)).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const isEditor = hasRole(user, [FLAGS_EDITOR]);
  const isApprover = hasRole(user, [FLAGS_APPROVER]);
  const needsApproval = requiresApproval(f.environment);

  return (
    <div>
      <Link href="/flags" className="text-sm text-slate-600 underline">
        ← Flags
      </Link>
      <div className="mb-4 mt-2 flex items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold">{f.key}</h1>
        <Badge tone={needsApproval ? "red" : "blue"}>{f.environment}</Badge>
        <Badge tone={f.enabled ? "green" : "slate"}>{f.enabled ? "enabled" : "disabled"}</Badge>
      </div>
      <ErrorBanner error={error} />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <Card title="Flag">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">Description</dt>
              <dd>{f.description}</dd>
              <dt className="text-slate-500">Environment</dt>
              <dd>{f.environment}</dd>
              <dt className="text-slate-500">Enabled</dt>
              <dd>{f.enabled ? "Yes" : "No"}</dd>
              <dt className="text-slate-500">Rollout</dt>
              <dd>{f.rolloutPct}%</dd>
              <dt className="text-slate-500">Last changed</dt>
              <dd>{f.updatedAt.toLocaleString()}</dd>
            </dl>
          </Card>
          <Card title="History">
            {history.length === 0 ? (
              <p className="text-sm text-slate-500">No changes yet.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="border-l-2 border-slate-200 pl-3">
                    <div>
                      <span className="font-medium">{h.action}</span> by {h.userName}{" "}
                      <span className="text-slate-500">({h.role})</span>
                    </div>
                    <div className="text-xs text-slate-500">{h.createdAt.toLocaleString()}</div>
                    <AuditChanges before={h.before} after={h.after} />
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <Card title="Actions">
          <div className="space-y-4 text-sm">
            {pendingChange && (
              <div className="space-y-2 rounded bg-amber-50 p-3">
                <p>
                  <span className="font-medium">{pendingChange.approval.submittedBy.name}</span> requests:{" "}
                  <span className="font-mono">{describeConfig(f)}</span> → <span className="font-mono">{describeConfig(pendingChange.proposed)}</span>
                </p>
                <p className="italic text-slate-700">“{pendingChange.approval.note}”</p>
                {isApprover && (
                  <form action={decideFlagChangeAction} className="space-y-2">
                    <input type="hidden" name="flagId" value={f.id} />
                    <textarea name="note" placeholder="Decision note (optional)" className={`${inputClass} w-full`} rows={2} />
                    <div className="flex gap-2">
                      <button name="decision" value="approved" className={buttonClass}>
                        Approve change
                      </button>
                      <button name="decision" value="rejected" className={`${buttonClass} bg-red-700 hover:bg-red-600`}>
                        Reject
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {isEditor && !pendingChange && (
              <form key={f.updatedAt.toISOString()} action={changeFlagAction} className="space-y-2">
                <input type="hidden" name="flagId" value={f.id} />
                <p className="font-medium">Change configuration</p>
                <label className="flex items-center justify-between gap-2">
                  State
                  <select name="enabled" defaultValue={String(f.enabled)} className={inputClass}>
                    <option value="true">enabled</option>
                    <option value="false">disabled</option>
                  </select>
                </label>
                <label className="flex items-center justify-between gap-2">
                  Rollout %
                  <input name="rolloutPct" type="number" min="0" max="100" step="1" defaultValue={f.rolloutPct} className={`${inputClass} w-24`} />
                </label>
                {needsApproval && (
                  <textarea name="note" required placeholder="Reason (required)" className={`${inputClass} w-full`} rows={2} />
                )}
                <button className={buttonClass}>{needsApproval ? "Request production change" : "Save"}</button>
                <p className="text-xs text-slate-500">
                  {needsApproval ? "Takes effect only after a different approver approves it." : "Takes effect immediately."}
                </p>
              </form>
            )}

            {!isEditor && !isApprover && <p className="text-slate-600">Read-only access.</p>}
            {!pendingChange && isApprover && !isEditor && <p className="text-slate-600">No pending change to review.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
