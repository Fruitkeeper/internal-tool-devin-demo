import Link from "next/link";
import { getCurrentUser } from "@/platform/auth";
import { Badge, buttonClass, inputClass } from "@/platform/ui/components";
import { ENVIRONMENTS } from "@/apps/flags/config";
import { listFlags } from "@/apps/flags/service";

type SearchParams = Promise<{ env?: string }>;

export default async function ListPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const flags = await listFlags(user, { environment: sp.env });

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Feature flags</h1>
      <form key={JSON.stringify(sp)} className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Environment
          <select name="env" defaultValue={sp.env ?? ""} className={inputClass}>
            <option value="">All</option>
            {ENVIRONMENTS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <button className={buttonClass}>Apply</button>
        <Link href="/flags" className="pb-1 text-slate-600 underline">
          Reset
        </Link>
      </form>

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Flag</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Environment</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2 text-right">Rollout</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/flags/${f.id}`} className="font-mono text-blue-700 underline">
                    {f.key}
                  </Link>
                </td>
                <td className="px-3 py-2">{f.description}</td>
                <td className="px-3 py-2">{f.environment}</td>
                <td className="px-3 py-2">
                  <Badge tone={f.enabled ? "green" : "slate"}>{f.enabled ? "enabled" : "disabled"}</Badge>
                </td>
                <td className="px-3 py-2 text-right">{f.rolloutPct}%</td>
                <td className="px-3 py-2">{f.hasPendingChange && <Badge tone="amber">pending approval</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">{flags.length} flag settings</p>
    </div>
  );
}
