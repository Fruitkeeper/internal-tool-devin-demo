"use server";

import { getCurrentUser } from "@/platform/auth";
import { runAndRedirect } from "@/platform/actions";
import * as flags from "@/apps/flags/service";

const field = (fd: FormData, name: string) => String(fd.get(name) ?? "");
const flagPath = (fd: FormData) => `/flags/${encodeURIComponent(field(fd, "flagId"))}`;

export async function changeFlagAction(fd: FormData) {
  await runAndRedirect(flagPath(fd), async () =>
    flags.changeFlag(
      await getCurrentUser(),
      field(fd, "flagId"),
      { enabled: field(fd, "enabled") === "true", rolloutPct: Number(field(fd, "rolloutPct")) },
      field(fd, "note"),
    ),
  );
}

export async function decideFlagChangeAction(fd: FormData) {
  await runAndRedirect(flagPath(fd), async () =>
    flags.decideFlagChange(await getCurrentUser(), field(fd, "flagId"), field(fd, "decision"), field(fd, "note")),
  );
}
