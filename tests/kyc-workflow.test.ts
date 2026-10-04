import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { ForbiddenError, ValidationError } from "@/platform/errors";
import * as kyc from "@/apps/kyc/service";
import { auditFor, ensureUsers, makeCase, users } from "./helpers";

beforeAll(ensureUsers);

async function recommendedCase(by = users.analyst, outcome = "approve") {
  const c = await makeCase();
  await kyc.startReview(by, c.id);
  await kyc.recommend(by, c.id, outcome, "Docs verified");
  return c;
}

describe("authorization", () => {
  it("an analyst cannot invoke the approve (decide) action", async () => {
    const c = await recommendedCase();
    await expect(kyc.decide(users.analyst2, c.id, "approved")).rejects.toBeInstanceOf(ForbiddenError);
    expect((await db.kycCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("recommended");
  });

  it("a reviewer cannot perform analyst actions", async () => {
    const c = await makeCase();
    await expect(kyc.startReview(users.reviewer, c.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only reviewers/admins can reveal ID numbers", async () => {
    const c = await makeCase();
    await expect(kyc.revealIdNumber(users.analyst, c.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await kyc.revealIdNumber(users.admin, c.id)).toBe("P12345678");
  });

  it("listed cases never include the full ID number", async () => {
    const c = await makeCase();
    const { case: shown } = await kyc.getCase(users.analyst, c.id);
    expect(JSON.stringify(shown)).not.toContain("P12345678");
    expect(shown.idDocNumberMasked).toBe("•••••5678");
  });
});

describe("maker-checker", () => {
  it("a user cannot approve their own recommendation", async () => {
    const c = await recommendedCase(users.both);
    await expect(kyc.decide(users.both, c.id, "approved")).rejects.toThrow("your own submission");
    expect((await db.kycCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("recommended");
    expect(await db.approval.findFirstOrThrow({ where: { entityId: c.id } })).toMatchObject({ status: "pending" });
  });

  it("a different reviewer can approve, applying the recommended outcome", async () => {
    const c = await recommendedCase(users.analyst, "reject");
    await kyc.decide(users.reviewer, c.id, "approved");
    expect((await db.kycCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("rejected");
  });

  it("rejecting a recommendation sends the case back to in_review", async () => {
    const c = await recommendedCase();
    await kyc.decide(users.reviewer, c.id, "rejected", "Need proof of address");
    expect((await db.kycCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("in_review");
  });

  it("recommendations require a note", async () => {
    const c = await makeCase();
    await kyc.startReview(users.analyst, c.id);
    await expect(kyc.recommend(users.analyst, c.id, "approve", "  ")).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("audit trail", () => {
  it("each mutation writes the expected audit entry with before/after state", async () => {
    const c = await makeCase();
    await kyc.startReview(users.analyst, c.id);
    await kyc.escalate(users.analyst, c.id, "Unusual activity");
    await kyc.recommend(users.analyst, c.id, "approve", "Docs verified");
    await kyc.decide(users.reviewer, c.id, "approved", "Agreed");
    await kyc.revealIdNumber(users.reviewer, c.id);

    const caseEntries = await auditFor(c.id);
    expect(caseEntries.map((e) => [e.action, e.userId, e.role])).toEqual([
      ["case.review_started", users.analyst.id, "kyc_analyst"],
      ["case.escalated", users.analyst.id, "kyc_analyst"],
      ["case.recommended", users.analyst.id, "kyc_analyst"],
      ["case.decided", users.reviewer.id, "kyc_reviewer"],
      ["case.id_revealed", users.reviewer.id, "kyc_reviewer"],
    ]);
    const started = caseEntries[0];
    expect(JSON.parse(started.before!).status).toBe("pending");
    expect(JSON.parse(started.after!).status).toBe("in_review");
    expect(JSON.parse(caseEntries[3].after!).status).toBe("approved");
    // Audit snapshots never contain the full ID number.
    expect(caseEntries.map((e) => `${e.before}${e.after}`).join("")).not.toContain("P12345678");

    const approval = await db.approval.findFirstOrThrow({ where: { entityId: c.id } });
    expect((await auditFor(approval.id)).map((e) => e.action)).toEqual(["approval.submitted", "approval.approved"]);
  });

  it("failed actions leave no audit entry (same transaction)", async () => {
    const c = await recommendedCase(users.both);
    const before = (await auditFor(c.id)).length;
    await expect(kyc.decide(users.both, c.id, "approved")).rejects.toThrow();
    expect((await auditFor(c.id)).length).toBe(before);
  });
});

describe("workflow transitions", () => {
  it.each([
    ["pending", () => (id: string) => kyc.recommend(users.analyst, id, "approve", "note")],
    ["pending", () => (id: string) => kyc.decide(users.reviewer, id, "approved")],
    ["in_review", () => (id: string) => kyc.startReview(users.analyst, id)],
    ["approved", () => (id: string) => kyc.startReview(users.analyst, id)],
    ["rejected", () => (id: string) => kyc.escalate(users.analyst, id, "late")],
  ])("rejects invalid action on a %s case", async (status, make) => {
    const c = await makeCase(status);
    await expect(make()(c.id)).rejects.toBeInstanceOf(ValidationError);
    expect((await db.kycCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe(status);
    expect(await auditFor(c.id)).toHaveLength(0);
  });
});
