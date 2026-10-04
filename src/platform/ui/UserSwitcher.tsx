"use client";

import { switchUser } from "@/platform/auth/actions";
import type { CurrentUser } from "@/platform/auth";

export function UserSwitcher({ user, users }: { user: CurrentUser; users: CurrentUser[] }) {
  return (
    <form action={switchUser} className="flex items-center gap-2 text-sm">
      <label htmlFor="userId" className="text-slate-300">
        Signed in as
      </label>
      <select
        id="userId"
        name="userId"
        defaultValue={user.id}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded bg-slate-800 px-2 py-1 text-white"
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.roles.join(", ") || "no roles"})
          </option>
        ))}
      </select>
    </form>
  );
}
