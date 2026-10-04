import Link from "next/link";
import type { CurrentUser } from "@/platform/auth";
import { ADMIN_ROLE, hasRole } from "@/platform/authz";
import type { AppDefinition } from "@/platform/registry";
import { UserSwitcher } from "@/platform/ui/UserSwitcher";

/** Navigation is derived from the app registry, already filtered to apps the user can access. */
export function Header({ user, users, apps }: { user: CurrentUser; users: CurrentUser[]; apps: AppDefinition[] }) {
  return (
    <header className="bg-slate-900 text-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
        <Link href="/" className="font-semibold">
          Internal Tools
        </Link>
        <nav className="flex flex-1 gap-4 text-sm">
          {apps.map((app) => (
            <Link key={app.id} href={app.route} className="text-slate-300 hover:text-white">
              {app.name}
            </Link>
          ))}
          {hasRole(user, [ADMIN_ROLE]) && (
            <>
              <Link href="/admin/access" className="text-slate-300 hover:text-white">
                Access control
              </Link>
              <Link href="/admin/audit" className="text-slate-300 hover:text-white">
                Audit log
              </Link>
            </>
          )}
        </nav>
        <UserSwitcher user={user} users={users} />
      </div>
    </header>
  );
}
