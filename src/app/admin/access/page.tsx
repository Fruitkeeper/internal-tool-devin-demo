import { apps } from "@/apps";
import { setUserRolesAction } from "@/app/admin/access/actions";
import { listUserAccess } from "@/platform/access";
import { getCurrentUser } from "@/platform/auth";
import { ADMIN_ROLE, hasRole } from "@/platform/authz";
import { AccessDenied, buttonClass, ErrorBanner } from "@/platform/ui/components";

// Admin only. The page guard is for UX; listUserAccess and setUserRoles enforce admin server-side.
export default async function AccessControlPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await getCurrentUser();
  if (!hasRole(actor, [ADMIN_ROLE])) return <AccessDenied message="Access control is only available to admins." />;
  const [{ error }, rows] = await Promise.all([searchParams, listUserAccess(actor, apps)]);

  const groups = [
    { label: "Platform", roles: [{ id: ADMIN_ROLE, label: "read-only access to every app, audit log, access control" }] },
    ...apps.map((app) => ({
      label: app.name,
      roles: app.roles.filter((r) => r !== ADMIN_ROLE).map((r) => ({ id: r, label: app.permissions?.[r] ?? "" })),
    })),
  ];

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Access control</h1>
      <p className="mb-4 text-sm text-slate-600">
        App access comes from each user&apos;s roles. Changes take effect on the user&apos;s next request and are
        recorded in the audit log (app <span className="font-mono">access</span>).
      </p>
      <ErrorBanner error={error} />
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Roles</th>
              {apps.map((app) => (
                <th key={app.id} className="px-3 py-2">
                  {app.name}
                </th>
              ))}
              <th className="px-3 py-2">Change roles</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ user, apps: access }) => (
              <tr key={user.id} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2">
                  {user.name} <span className="text-xs text-slate-500">({user.id})</span>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{user.roles.join(", ") || "none"}</td>
                {access.map((a) => (
                  <td key={a.appId} className="px-3 py-2">
                    {a.canAccess ? a.permissions.join(", ") : <span className="text-slate-400">—</span>}
                  </td>
                ))}
                <td className="px-3 py-2">
                  <details>
                    <summary className="cursor-pointer text-slate-600">Edit</summary>
                    <form key={user.roles.join(",")} action={setUserRolesAction} className="mt-2 space-y-2 text-xs">
                      <input type="hidden" name="userId" value={user.id} />
                      {groups.map((g) => (
                        <fieldset key={g.label}>
                          <legend className="font-semibold text-slate-500">{g.label}</legend>
                          {g.roles.map((r) => (
                            <label key={r.id} className="block whitespace-nowrap">
                              <input type="checkbox" name="roles" value={r.id} defaultChecked={user.roles.includes(r.id)} />{" "}
                              <span className="font-mono">{r.id}</span> <span className="text-slate-500">{r.label}</span>
                            </label>
                          ))}
                        </fieldset>
                      ))}
                      <button className={buttonClass}>Save roles</button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
