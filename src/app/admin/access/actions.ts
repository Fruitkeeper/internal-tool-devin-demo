"use server";

import { apps } from "@/apps";
import { setUserRoles } from "@/platform/access";
import { runAndRedirect } from "@/platform/actions";
import { getCurrentUser } from "@/platform/auth";

export async function setUserRolesAction(fd: FormData) {
  const actor = await getCurrentUser();
  await runAndRedirect("/admin/access", () =>
    setUserRoles(actor, String(fd.get("userId") ?? ""), fd.getAll("roles").map(String), apps),
  );
}
