import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/platform/auth";
import { db } from "@/platform/db";
import { ForbiddenError, ValidationError } from "@/platform/errors";
import * as flags from "@/apps/flags/service";
import { auditFor } from "./helpers";

const u = {
  editor: { id: "t-ff-editor", name: "FF Editor", email: "ffe@test", roles: ["flags_editor"] },
  approver: { id: "t-ff-approver", name: "FF Approver", email: "ffa@test", roles: ["flags_approver"] },
  both: { id: "t-ff-both", name: "FF Both", email: "ffb@test", roles: ["flags_editor", "flags_approver"] },
  admin: { id: "t-ff-admin", name: "FF Admin", email: "ffadmin@test", roles: ["admin"] },
  refundsAnalyst: { id: "t-ff-rf", name: "Refunds only", email: "ffrf@test", roles: ["refunds_analyst"] },
} satisfies Record<string, CurrentUser>;

beforeAll(async () => {
  for (const user of Object.values(u)) {
    const data = { ...user, roles: user.roles.join(",") };
    await db.user.upsert({ where: { id: user.id }, create: data, update: data });
  }
});

/** Audit rows can't be deleted, so each test uses a fresh flag. */
const makeFlag = (environment: string) => {
  const key = `t-${randomUUID()}`;
  return db.featureFlag.create({ data: { id: `${key}.${environment}`, key, description: "Test", environment, enabled: false, rolloutPct: 0 } });
};

const configOf = async (id: string) => {
  const f = await db.featureFlag.findUniqueOrThrow({ where: { id } });
  return { enabled: f.enabled, rolloutPct: f.rolloutPct };
};

const ON_50 = { enabled: true, rolloutPct: 50 };
const OFF = { enabled: false, rolloutPct: 0 };

describe("flags authorization", () => {
  it("approvers and admins cannot change flags; admins can read", async () => {
    const f = await makeFlag("staging");
    await expect(flags.changeFlag(u.approver, f.id, ON_50)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(flags.changeFlag(u.admin, f.id, ON_50)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await flags.getFlag(u.admin, f.id)).flag.id).toBe(f.id);
    expect(await configOf(f.id)).toEqual(OFF);
  });

  it("an editor cannot approve a production change", async () => {
    const f = await makeFlag("production");
    await flags.changeFlag(u.both, f.id, ON_50, "canary");
    await expect(flags.decideFlagChange(u.editor, f.id, "approved")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("users without a flags role cannot read flags", async () => {
    await expect(flags.listFlags(u.refundsAnalyst)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("flags non-production changes", () => {
  it("apply immediately and are audited", async () => {
    const f = await makeFlag("development");
    expect(await flags.changeFlag(u.editor, f.id, ON_50)).toEqual({ applied: true });
    expect(await configOf(f.id)).toEqual(ON_50);
    const [entry] = await auditFor(f.id);
    expect([entry.action, entry.userId, entry.role, entry.appId]).toEqual(["flag.updated", u.editor.id, "flags_editor", "flags"]);
    expect(JSON.parse(entry.before!)).toMatchObject(OFF);
    expect(JSON.parse(entry.after!)).toMatchObject(ON_50);
  });

  it("reject invalid rollout values and no-op changes", async () => {
    const f = await makeFlag("staging");
    for (const rolloutPct of [-1, 101, 12.5, NaN]) {
      await expect(flags.changeFlag(u.editor, f.id, { enabled: true, rolloutPct })).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(flags.changeFlag(u.editor, f.id, OFF)).rejects.toThrow(/No changes/);
    expect(await auditFor(f.id)).toHaveLength(0);
  });
});

describe("flags production maker-checker", () => {
  it("a production change does not take effect until approved", async () => {
    const f = await makeFlag("production");
    const res = await flags.changeFlag(u.editor, f.id, ON_50, "canary");
    expect(res.applied).toBe(false);
    expect(await configOf(f.id)).toEqual(OFF);
    const { pendingChange } = await flags.getFlag(u.editor, f.id);
    expect(pendingChange?.proposed).toEqual(ON_50);
  });

  it("a production change requires a note", async () => {
    const f = await makeFlag("production");
    await expect(flags.changeFlag(u.editor, f.id, ON_50, " ")).rejects.toBeInstanceOf(ValidationError);
  });

  it("the person making the change cannot approve it", async () => {
    const f = await makeFlag("production");
    await flags.changeFlag(u.both, f.id, ON_50, "canary");
    await expect(flags.decideFlagChange(u.both, f.id, "approved")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await configOf(f.id)).toEqual(OFF);
  });

  it("only one pending change per flag", async () => {
    const f = await makeFlag("production");
    await flags.changeFlag(u.editor, f.id, ON_50, "canary");
    await expect(flags.changeFlag(u.editor, f.id, { enabled: true, rolloutPct: 100 }, "more")).rejects.toThrow(/already a pending/);
  });

  it("approval applies the change; rejection leaves the flag unchanged; both are audited", async () => {
    const a = await makeFlag("production");
    const { approvalId } = await flags.changeFlag(u.both, a.id, ON_50, "canary");
    await flags.decideFlagChange(u.approver, a.id, "approved", "LGTM");
    expect(await configOf(a.id)).toEqual(ON_50);
    expect((await auditFor(a.id)).map((e) => [e.action, e.userId])).toEqual([
      ["flag.change_requested", u.both.id],
      ["flag.updated", u.approver.id],
    ]);
    expect((await auditFor(approvalId!)).map((e) => e.action)).toEqual(["approval.submitted", "approval.approved"]);

    const b = await makeFlag("production");
    const rej = await flags.changeFlag(u.editor, b.id, ON_50, "canary");
    await flags.decideFlagChange(u.approver, b.id, "rejected", "Not during freeze");
    expect(await configOf(b.id)).toEqual(OFF);
    expect((await auditFor(rej.approvalId!)).map((e) => e.action)).toEqual(["approval.submitted", "approval.rejected"]);
  });
});
