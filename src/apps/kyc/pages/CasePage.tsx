import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/platform/auth";
import { ADMIN_ROLE, hasRole } from "@/platform/authz";
import { NotFoundError } from "@/platform/errors";
import { AuditChanges } from "@/platform/ui/AuditChanges";
import { buttonClass, Card, ErrorBanner, inputClass } from "@/platform/ui/components";
import { decideAction, escalateAction, recommendAction, startReviewAction } from "@/apps/kyc/actions";
import { FlagBadges, RiskBadge, StatusBadge } from "@/apps/kyc/components/badges";
import { RevealId } from "@/apps/kyc/components/RevealId";
import { KYC_ANALYST, KYC_REVIEWER } from "@/apps/kyc/roles";
import { getCase } from "@/apps/kyc/service";
import { isTerminal } from "@/apps/kyc/workflow";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function CasePage({ params, searchParams }: Props) {
  const [{ id }, { error }, user] = await Promise.all([params, searchParams, getCurrentUser()]);
  const data = await getCase(user, decodeURIComponent(id)).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { case: c, pendingApproval, history } = data;
  const isAnalyst = hasRole(user, [KYC_ANALYST]);
  const isReviewer = hasRole(user, [KYC_REVIEWER]);
  const canReveal = hasRole(user, [KYC_REVIEWER, ADMIN_ROLE]);

  return (
    <div>
      <Link href="/kyc" className="text-sm text-slate-600 underline">
        ← Queue
      </Link>
      <div className="mb-4 mt-2 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{c.customerName}</h1>
        <span className="font-mono text-sm text-slate-500">{c.id}</span>
        <StatusBadge status={c.status} />
        <FlagBadges sanctionsHit={false} pepHit={false} escalated={c.escalated} />
      </div>
      <ErrorBanner error={error} />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <Card title="Customer">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">Date of birth</dt>
              <dd>{c.dateOfBirth}</dd>
              <dt className="text-slate-500">Country</dt>
              <dd>{c.country}</dd>
              <dt className="text-slate-500">ID document</dt>
              <dd>{c.idDocType.replace("_", " ")}</dd>
              <dt className="text-slate-500">ID number</dt>
              <dd>
                <RevealId caseId={c.id} masked={c.idDocNumberMasked} canReveal={canReveal} />
              </dd>
            </dl>
          </Card>
          <Card title="Risk signals">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>Risk score:</span> <RiskBadge score={c.riskScore} />
              <span>Sanctions: {c.sanctionsHit ? "HIT" : "clear"}</span>
              <span>PEP: {c.pepHit ? "HIT" : "clear"}</span>
            </div>
          </Card>
          <Card title="History">
            {history.length === 0 ? (
              <p className="text-sm text-slate-500">No activity yet.</p>
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

        <div className="space-y-4">
          <Card title="Actions">
            <div className="space-y-4 text-sm">
              {isAnalyst && c.status === "pending" && (
                <form action={startReviewAction}>
                  <input type="hidden" name="caseId" value={c.id} />
                  <button className={buttonClass}>Start review</button>
                </form>
              )}

              {isAnalyst && c.status === "in_review" && (
                <form action={recommendAction} className="space-y-2">
                  <input type="hidden" name="caseId" value={c.id} />
                  <p className="font-medium">Submit recommendation</p>
                  <select name="outcome" className={`${inputClass} w-full`}>
                    <option value="approve">Recommend approve</option>
                    <option value="reject">Recommend reject</option>
                  </select>
                  <textarea name="note" required placeholder="Note (required)" className={`${inputClass} w-full`} rows={3} />
                  <button className={buttonClass}>Submit for review</button>
                </form>
              )}

              {pendingApproval && (
                <div className="space-y-2 rounded bg-amber-50 p-3">
                  <p>
                    <span className="font-medium">{pendingApproval.submittedBy.name}</span> recommends{" "}
                    <span className="font-medium">{pendingApproval.proposedAction}</span>
                  </p>
                  <p className="italic text-slate-700">“{pendingApproval.note}”</p>
                  {isReviewer && (
                    <form action={decideAction} className="space-y-2">
                      <input type="hidden" name="caseId" value={c.id} />
                      <textarea name="note" placeholder="Decision note (optional)" className={`${inputClass} w-full`} rows={2} />
                      <div className="flex gap-2">
                        <button name="decision" value="approved" className={buttonClass}>
                          Approve recommendation
                        </button>
                        <button name="decision" value="rejected" className={`${buttonClass} bg-red-700 hover:bg-red-600`}>
                          Send back
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {isAnalyst && !isTerminal(c.status) && !c.escalated && (
                <form action={escalateAction} className="space-y-2">
                  <input type="hidden" name="caseId" value={c.id} />
                  <p className="font-medium">Escalate</p>
                  <input name="reason" required placeholder="Reason (required)" className={`${inputClass} w-full`} />
                  <button className={`${buttonClass} bg-amber-700 hover:bg-amber-600`}>Escalate</button>
                </form>
              )}

              {isTerminal(c.status) && <p className="text-slate-600">This case is closed ({c.status}).</p>}
              {!isAnalyst && !isReviewer && <p className="text-slate-600">Read-only access.</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
