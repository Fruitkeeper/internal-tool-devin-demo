import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/platform/auth";
import { hasRole } from "@/platform/authz";
import { NotFoundError } from "@/platform/errors";
import { AuditChanges } from "@/platform/ui/AuditChanges";
import { buttonClass, Card, ErrorBanner, inputClass } from "@/platform/ui/components";
import { decideRefundAction, recommendRefundAction } from "@/apps/refunds/actions";
import { REFUNDS_ANALYST, REFUNDS_REVIEWER } from "@/apps/refunds/roles";
import { getRefund } from "@/apps/refunds/service";
import { StatusBadge } from "@/apps/refunds/StatusBadge";
import { formatAmount } from "@/apps/refunds/workflow";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function RefundPage({ params, searchParams }: Props) {
  const [{ id }, { error }, user] = await Promise.all([params, searchParams, getCurrentUser()]);
  const { refund: r, pendingApproval, history } = await getRefund(user, decodeURIComponent(id)).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const isAnalyst = hasRole(user, [REFUNDS_ANALYST]);
  const isReviewer = hasRole(user, [REFUNDS_REVIEWER]);
  const closed = r.status === "approved" || r.status === "rejected";

  return (
    <div>
      <Link href="/refunds" className="text-sm text-slate-600 underline">
        ← Queue
      </Link>
      <div className="mb-4 mt-2 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{formatAmount(r.amountCents)} to {r.customerName}</h1>
        <span className="font-mono text-sm text-slate-500">{r.id}</span>
        <StatusBadge status={r.status} />
      </div>
      <ErrorBanner error={error} />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <Card title="Refund">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">Customer</dt>
              <dd>{r.customerName}</dd>
              <dt className="text-slate-500">Order</dt>
              <dd className="font-mono">{r.orderRef}</dd>
              <dt className="text-slate-500">Amount</dt>
              <dd>{formatAmount(r.amountCents)}</dd>
              <dt className="text-slate-500">Reason</dt>
              <dd>{r.reason}</dd>
              <dt className="text-slate-500">Requested</dt>
              <dd>{r.createdAt.toLocaleDateString()}</dd>
            </dl>
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

        <Card title="Actions">
          <div className="space-y-4 text-sm">
            {isAnalyst && r.status === "pending" && (
              <form action={recommendRefundAction} className="space-y-2">
                <input type="hidden" name="refundId" value={r.id} />
                <p className="font-medium">Recommend this refund</p>
                <textarea name="note" required placeholder="Note (required)" className={`${inputClass} w-full`} rows={3} />
                <button className={buttonClass}>Recommend refund</button>
              </form>
            )}

            {pendingApproval && (
              <div className="space-y-2 rounded bg-amber-50 p-3">
                <p>
                  <span className="font-medium">{pendingApproval.submittedBy.name}</span> recommends issuing this refund
                </p>
                <p className="italic text-slate-700">“{pendingApproval.note}”</p>
                {isReviewer && (
                  <form action={decideRefundAction} className="space-y-2">
                    <input type="hidden" name="refundId" value={r.id} />
                    <textarea name="note" placeholder="Decision note (optional)" className={`${inputClass} w-full`} rows={2} />
                    <div className="flex gap-2">
                      <button name="decision" value="approved" className={buttonClass}>
                        Approve refund
                      </button>
                      <button name="decision" value="rejected" className={`${buttonClass} bg-red-700 hover:bg-red-600`}>
                        Reject
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {closed && <p className="text-slate-600">This refund is closed ({r.status}).</p>}
            {!isAnalyst && !isReviewer && <p className="text-slate-600">Read-only access.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
