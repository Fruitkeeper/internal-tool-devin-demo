import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { apps } from "@/apps";
import { kycApp } from "@/apps/kyc/app";
import { refundsApp } from "@/apps/refunds/app";
import * as kyc from "@/apps/kyc/service";
import { listUserAccess, setUserRoles } from "@/platform/access";
import { type CurrentUser, toCurrentUser } from "@/platform/auth";
import { db } from "@/platform/db";
import { ForbiddenError, ValidationError } from "@/platform/errors";
import { canAccessApp } from "@/platform/registry";
import { auditFor, ensureUsers, makeCase, users } from "./helpers";

beforeAll(ensureUsers);

/** Audit rows can't be deleted, so each test changes a fresh, uniquely-named user. */
async function makeUser(roles: string[]): Promise<CurrentUser> {
  const id = `t-ac-${randomUUID()}`;
  return toCurrentUser(await db.user.create({ data: { id, name: "AC Target", email: `${id}@test`, roles: roles.join(",") } }));
}
const reload = async (id: string) => toCurrentUser(await db.user.findUniqueOrThrow({ where: { id } }));

const nonAdmins = [users.analyst, users.reviewer, users.both, { ...users.analyst, roles: ["flags_approver", "refunds_reviewer"] }];

describe("access control is admin-only", () => {
  it("non-admins cannot list users' access", async () => {
    for (const u of nonAdmins) await expect(listUserAccess(u, apps)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("non-admins cannot change roles, including granting themselves admin", async () => {
    const target = await makeUser(["kyc_analyst"]);
    for (const u of nonAdmins) {
      await expect(setUserRoles(u, target.id, ["kyc_reviewer"], apps)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setUserRoles(u, u.id, ["admin"], apps)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await reload(target.id)).roles).toEqual(["kyc_analyst"]);
    expect(await auditFor(target.id)).toEqual([]);
  });
});

describe("admin changes roles", () => {
  it("updates the user, shows in the access matrix and writes one audit entry", async () => {
    const target = await makeUser(["kyc_analyst"]);
    await setUserRoles(users.admin, target.id, ["kyc_reviewer", "refunds_analyst"], apps);

    expect((await reload(target.id)).roles).toEqual(["kyc_reviewer", "refunds_analyst"]);
    const row = (await listUserAccess(users.admin, apps)).find((r) => r.user.id === target.id)!;
    expect(row.apps).toEqual([
      { appId: "kyc", canAccess: true, permissions: ["Approve / reject"] },
      { appId: "refunds", canAccess: true, permissions: ["Recommend"] },
      { appId: "flags", canAccess: false, permissions: [] },
    ]);

    const entries = await auditFor(target.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: users.admin.id,
      role: "admin",
      appId: "access",
      action: "user.roles_changed",
      entityType: "User",
    });
    expect(entries[0].createdAt).toBeInstanceOf(Date);
    expect(JSON.parse(entries[0].before!).roles).toEqual(["kyc_analyst"]);
    expect(JSON.parse(entries[0].after!).roles).toEqual(["kyc_reviewer", "refunds_analyst"]);
  });

  it("rejects unknown roles, no-op changes and removing your own admin role, without auditing", async () => {
    const target = await makeUser(["kyc_analyst"]);
    await expect(setUserRoles(users.admin, target.id, ["superuser"], apps)).rejects.toBeInstanceOf(ValidationError);
    await expect(setUserRoles(users.admin, target.id, ["kyc_analyst"], apps)).rejects.toThrow("No changes");
    await expect(setUserRoles(users.admin, users.admin.id, ["kyc_reviewer"], apps)).rejects.toThrow("own admin role");
    expect((await reload(target.id)).roles).toEqual(["kyc_analyst"]);
    expect((await reload(users.admin.id)).roles).toEqual(["admin"]);
    expect(await auditFor(target.id)).toEqual([]);
  });
});

describe("existing app authorization follows the new roles", () => {
  it("promoting an analyst to reviewer lets them approve; revoking KYC removes access", async () => {
    const target = await makeUser(["kyc_analyst"]);
    const c = await makeCase();
    await kyc.startReview(users.analyst, c.id);
    await kyc.recommend(users.analyst, c.id, "approve", "Docs verified");

    await expect(kyc.decide(await reload(target.id), c.id, "approved")).rejects.toBeInstanceOf(ForbiddenError);

    await setUserRoles(users.admin, target.id, ["kyc_reviewer"], apps);
    await kyc.decide(await reload(target.id), c.id, "approved");
    expect((await db.kycCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("approved");

    await setUserRoles(users.admin, target.id, ["refunds_reviewer"], apps);
    const revoked = await reload(target.id);
    expect(canAccessApp(revoked, kycApp)).toBe(false);
    expect(canAccessApp(revoked, refundsApp)).toBe(true);
    await expect(kyc.listCases(revoked)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
