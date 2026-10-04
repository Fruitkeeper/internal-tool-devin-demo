import { getCurrentUser, listDemoUsers } from "@/platform/auth";
import { ADMIN_ROLE, hasRole } from "@/platform/authz";
import { listAuditEntries } from "@/platform/audit";
import { AuditChanges } from "@/platform/ui/AuditChanges";
import { AccessDenied, buttonClass, inputClass } from "@/platform/ui/components";

type SearchParams = Promise<{ appId?: string; action?: string; entityType?: string; entityId?: string; userId?: string }>;

// Read-only audit viewer (platform feature, admin only). There are intentionally no mutations here.
export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!hasRole(user, [ADMIN_ROLE])) return <AccessDenied message="The audit log is only available to admins." />;
  const filters = await searchParams;
  const [entries, users] = await Promise.all([listAuditEntries(filters), listDemoUsers()]);

  const text = (name: keyof Awaited<SearchParams>, placeholder: string) => (
    <input name={name} defaultValue={filters[name] ?? ""} placeholder={placeholder} className={inputClass} />
  );

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Audit log</h1>
      <form className="mb-4 flex flex-wrap gap-2 text-sm">
        {text("appId", "App (e.g. kyc)")}
        {text("action", "Action (e.g. case.decided)")}
        {text("entityType", "Entity type")}
        {text("entityId", "Entity id")}
        <select name="userId" defaultValue={filters.userId ?? ""} className={inputClass}>
          <option value="">Any user</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <button className={buttonClass}>Filter</button>
      </form>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">User (role)</th>
              <th className="px-3 py-2">App</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Changes</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 text-slate-500">{e.id}</td>
                <td className="whitespace-nowrap px-3 py-2">{e.createdAt.toLocaleString()}</td>
                <td className="px-3 py-2">
                  {e.userName} <span className="text-slate-500">({e.role})</span>
                </td>
                <td className="px-3 py-2">{e.appId}</td>
                <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {e.entityType}:{e.entityId}
                </td>
                <td className="px-3 py-2">
                  <AuditChanges before={e.before} after={e.after} />
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  No audit entries match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Showing the latest {entries.length} entries.</p>
    </div>
  );
}
