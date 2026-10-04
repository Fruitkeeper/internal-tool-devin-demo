import Link from "next/link";
import { getCurrentUser } from "@/platform/auth";
import { buttonClass, inputClass } from "@/platform/ui/components";
import { listCases, type CaseSort } from "@/apps/kyc/service";
import { CASE_STATUSES } from "@/apps/kyc/workflow";
import { FlagBadges, RiskBadge, StatusBadge } from "@/apps/kyc/components/badges";

type SearchParams = Promise<{ status?: string; risk?: string; sort?: string; escalated?: string }>;

const DAY = 24 * 60 * 60 * 1000;

export default async function QueuePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const cases = await listCases(user, {
    status: sp.status,
    risk: sp.risk,
    sort: (sp.sort as CaseSort) || "risk_desc",
    escalated: sp.escalated === "1",
  });
  const now = Date.now();

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">KYC queue</h1>
      <form className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Status
          <select name="status" defaultValue={sp.status ?? ""} className={inputClass}>
            <option value="">All</option>
            {CASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Risk
          <select name="risk" defaultValue={sp.risk ?? ""} className={inputClass}>
            <option value="">All</option>
            <option value="high">High (70+)</option>
            <option value="medium">Medium (40–69)</option>
            <option value="low">Low (&lt;40)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Sort
          <select name="sort" defaultValue={sp.sort ?? "risk_desc"} className={inputClass}>
            <option value="risk_desc">Risk: high → low</option>
            <option value="risk_asc">Risk: low → high</option>
            <option value="age_desc">Age: oldest first</option>
            <option value="age_asc">Age: newest first</option>
          </select>
        </label>
        <label className="flex items-center gap-1 pb-1">
          <input type="checkbox" name="escalated" value="1" defaultChecked={sp.escalated === "1"} /> Escalated only
        </label>
        <button className={buttonClass}>Apply</button>
        <Link href="/kyc" className="pb-1 text-slate-600 underline">
          Reset
        </Link>
      </form>

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Case</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Country</th>
              <th className="px-3 py-2">Risk</th>
              <th className="px-3 py-2">Flags</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Age</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/kyc/${c.id}`} className="font-mono text-blue-700 underline">
                    {c.id}
                  </Link>
                </td>
                <td className="px-3 py-2">{c.customerName}</td>
                <td className="px-3 py-2">{c.country}</td>
                <td className="px-3 py-2">
                  <RiskBadge score={c.riskScore} />
                </td>
                <td className="px-3 py-2">
                  <FlagBadges sanctionsHit={c.sanctionsHit} pepHit={c.pepHit} escalated={c.escalated} />
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-3 py-2">{Math.floor((now - c.createdAt.getTime()) / DAY)}d</td>
              </tr>
            ))}
            {cases.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  No cases match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">{cases.length} cases</p>
    </div>
  );
}
