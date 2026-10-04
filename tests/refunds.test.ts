import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/platform/auth";
import { db } from "@/platform/db";
import { ForbiddenError, ValidationError } from "@/platform/errors";
import * as refunds from "@/apps/refunds/service";
import { auditFor } from "./helpers";

const u = {
  analyst: { id: "t-rf-analyst", name: "RF Analyst", email: "rfa@test", roles: ["refunds_analyst"] },
  reviewer: { id: "t-rf-reviewer", name: "RF Reviewer", email: "rfr@test", roles: ["refunds_reviewer"] },
  both: { id: "t-rf-both", name: "RF Both", email: "rfb@test", roles: ["refunds_analyst", "refunds_reviewer"] },
  admin: { id: "t-rf-admin", name: "RF Admin", email: "rfadmin@test", roles: ["admin"] },
  kycAnalyst: { id: "t-rf-kyc", name: "KYC only", email: "rfkyc@test", roles: ["kyc_analyst"] },
} satisfies Record<string, CurrentUser>;

beforeAll(async () => {
  for (const user of Object.values(u)) {
    const data = { ...user, roles: user.roles.join(",") };
    await db.user.upsert({ where: { id: user.id }, create: data, update: data });
  }
});

const makeRefund = (status = "pending") =>
  db.refund.create({
    data: { id: `TR-${randomUUID()}`, customerName: "Test", orderRef: "ORD-1", amountCents: 12_345, reason: "Test", status },
  });

async function recommended(by: CurrentUser = u.analyst) {
  const r = await makeRefund();
  await refunds.recommendRefund(by, r.id, "Order checked");
  return r;
}

const statusOf = async (id: string) => (await db.refund.findUniqueOrThrow({ where: { id } })).status;

describe("refunds authorization", () => {
  it("an analyst cannot approve a refund", async () => {
    const r = await recommended();
    await expect(refunds.decideRefund(u.analyst, r.id, "approved")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await statusOf(r.id)).toBe("recommended");
  });

  it("reviewers and admins cannot recommend; admins can read", async () => {
    const r = await makeRefund();
    await expect(refunds.recommendRefund(u.reviewer, r.id, "x")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(refunds.recommendRefund(u.admin, r.id, "x")).rejects.toBeInstanceOf(ForbiddenError);
    expect((await refunds.getRefund(u.admin, r.id)).refund.id).toBe(r.id);
  });

  it("users without a refunds role cannot read refunds", async () => {
    await expect(refunds.listRefunds(u.kycAnalyst)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("refunds maker-checker", () => {
  it("a user cannot approve their own recommendation", async () => {
    const r = await recommended(u.both);
    await expect(refunds.decideRefund(u.both, r.id, "approved")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await statusOf(r.id)).toBe("recommended");
  });

  it("a different reviewer can approve or reject", async () => {
    const a = await recommended(u.both);
    await refunds.decideRefund(u.reviewer, a.id, "approved");
    expect(await statusOf(a.id)).toBe("approved");
    const b = await recommended();
    await refunds.decideRefund(u.reviewer, b.id, "rejected", "Outside policy");
    expect(await statusOf(b.id)).toBe("rejected");
  });

  it("a recommendation requires a note", async () => {
    const r = await makeRefund();
    await expect(refunds.recommendRefund(u.analyst, r.id, "  ")).rejects.toBeInstanceOf(ValidationError);
    expect(await statusOf(r.id)).toBe("pending");
  });
});

describe("refunds audit and transitions", () => {
  it("recommend and decide write audit entries in the refunds app", async () => {
    const r = await recommended();
    await refunds.decideRefund(u.reviewer, r.id, "approved");
    const entries = await auditFor(r.id);
    expect(entries.map((e) => [e.action, e.userId, e.role, e.appId])).toEqual([
      ["refund.recommended", u.analyst.id, "refunds_analyst", "refunds"],
      ["refund.approved", u.reviewer.id, "refunds_reviewer", "refunds"],
    ]);
    expect(JSON.parse(entries[1].before!).status).toBe("recommended");
    expect(JSON.parse(entries[1].after!).status).toBe("approved");
    const approvalId = JSON.parse(entries[0].after!).approvalId;
    expect((await auditFor(approvalId)).map((e) => e.action)).toEqual(["approval.submitted", "approval.approved"]);
  });

  it("invalid transitions are rejected without writing audit entries", async () => {
    const pending = await makeRefund();
    await expect(refunds.decideRefund(u.reviewer, pending.id, "approved")).rejects.toThrow(/Invalid status transition/);
    const closed = await makeRefund("approved");
    await expect(refunds.recommendRefund(u.analyst, closed.id, "again")).rejects.toThrow(/Invalid status transition/);
    expect(await auditFor(pending.id)).toHaveLength(0);
    expect(await auditFor(closed.id)).toHaveLength(0);
  });
});
