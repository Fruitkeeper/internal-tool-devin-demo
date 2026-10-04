import Link from "next/link";
import { apps } from "@/apps";
import { getCurrentUser } from "@/platform/auth";
import { accessibleApps } from "@/platform/registry";

export default async function PortalHome() {
  const user = await getCurrentUser();
  const visible = accessibleApps(user, apps);
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Welcome, {user.name}</h1>
      <p className="mb-6 text-sm text-slate-600">Roles: {user.roles.join(", ") || "none"}</p>
      {visible.length === 0 ? (
        <p className="text-sm text-slate-600">You don&apos;t have access to any apps. Try switching user.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((app) => (
            <Link key={app.id} href={app.route} className="rounded border border-slate-200 bg-white p-4 hover:border-slate-400">
              <h2 className="font-semibold">{app.name}</h2>
              <p className="text-sm text-slate-600">{app.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
