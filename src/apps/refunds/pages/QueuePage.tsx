import Link from "next/link";
import { getCurrentUser } from "@/platform/auth";
import { buttonClass, inputClass } from "@/platform/ui/components";
import { listRefunds } from "@/apps/refunds/service";
import { StatusBadge } from "@/apps/refunds/StatusBadge";
import { formatAmount, REFUND_STATUSES } from "@/apps/refunds/workflow";

type SearchParams = Promise<{ status?: string; min?: string; max?: string }>;

const toNumber = (v?: string) => (v ? Number(v) : undefined);

export default async function QueuePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const refunds = await listRefunds(user, { status: sp.status, minAmount: toNumber(sp.min), maxAmount: toNumber(sp.max) });

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Refunds queue</h1>
      <form key={JSON.stringify(sp)} className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Status
          <select name="status" defaultValue={sp.status ?? ""} className={inputClass}>
            <option value="">All</option>
            {REFUND_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Min amount ($)
          <input name="min" type="number" min="0" step="0.01" defaultValue={sp.min ?? ""} className={`${inputClass} w-28`} />
        </label>
        <label className="flex flex-col gap-1">
          Max amount ($)
          <input name="max" type="number" min="0" step="0.01" defaultValue={sp.max ?? ""} className={`${inputClass} w-28`} />
        </label>
        <button className={buttonClass}>Apply</button>
        <Link href="/refunds" className="pb-1 text-slate-600 underline">
          Reset
        </Link>
      </form>

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Refund</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {refunds.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/refunds/${r.id}`} className="font-mono text-blue-700 underline">
                    {r.id}
                  </Link>
                </td>
                <td className="px-3 py-2">{r.customerName}</td>
                <td className="px-3 py-2 font-mono">{r.orderRef}</td>
                <td className="px-3 py-2 text-right">{formatAmount(r.amountCents)}</td>
                <td className="px-3 py-2">{r.reason}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
            {refunds.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  No refunds match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">{refunds.length} refunds</p>
    </div>
  );
}
