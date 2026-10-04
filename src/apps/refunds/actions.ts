"use server";

import { getCurrentUser } from "@/platform/auth";
import { runAndRedirect } from "@/platform/actions";
import * as refunds from "@/apps/refunds/service";

const field = (fd: FormData, name: string) => String(fd.get(name) ?? "");
const refundPath = (fd: FormData) => `/refunds/${encodeURIComponent(field(fd, "refundId"))}`;

export async function recommendRefundAction(fd: FormData) {
  await runAndRedirect(refundPath(fd), async () =>
    refunds.recommendRefund(await getCurrentUser(), field(fd, "refundId"), field(fd, "note")),
  );
}

export async function decideRefundAction(fd: FormData) {
  await runAndRedirect(refundPath(fd), async () =>
    refunds.decideRefund(await getCurrentUser(), field(fd, "refundId"), field(fd, "decision"), field(fd, "note")),
  );
}
