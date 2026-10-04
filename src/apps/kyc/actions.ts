"use server";

import { getCurrentUser } from "@/platform/auth";
import { runAndRedirect } from "@/platform/actions";
import { AppError } from "@/platform/errors";
import * as kyc from "@/apps/kyc/service";

// Thin wrappers: resolve the current user, then delegate to the service (which enforces authz).

const field = (fd: FormData, name: string) => String(fd.get(name) ?? "");
const casePath = (fd: FormData) => `/kyc/${encodeURIComponent(field(fd, "caseId"))}`;

export async function startReviewAction(fd: FormData) {
  await runAndRedirect(casePath(fd), async () => kyc.startReview(await getCurrentUser(), field(fd, "caseId")));
}

export async function recommendAction(fd: FormData) {
  await runAndRedirect(casePath(fd), async () =>
    kyc.recommend(await getCurrentUser(), field(fd, "caseId"), field(fd, "outcome"), field(fd, "note")),
  );
}

export async function decideAction(fd: FormData) {
  await runAndRedirect(casePath(fd), async () =>
    kyc.decide(await getCurrentUser(), field(fd, "caseId"), field(fd, "decision"), field(fd, "note")),
  );
}

export async function escalateAction(fd: FormData) {
  await runAndRedirect(casePath(fd), async () =>
    kyc.escalate(await getCurrentUser(), field(fd, "caseId"), field(fd, "reason")),
  );
}

export async function revealIdAction(caseId: string): Promise<{ value?: string; error?: string }> {
  try {
    return { value: await kyc.revealIdNumber(await getCurrentUser(), caseId) };
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
}
