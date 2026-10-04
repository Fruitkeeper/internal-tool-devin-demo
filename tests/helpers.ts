import { randomUUID } from "node:crypto";
import type { CurrentUser } from "@/platform/auth";
import { db } from "@/platform/db";

export const users = {
  analyst: { id: "t-analyst", name: "Test Analyst", email: "t-analyst@test", roles: ["kyc_analyst"] },
  analyst2: { id: "t-analyst2", name: "Test Analyst 2", email: "t-analyst2@test", roles: ["kyc_analyst"] },
  reviewer: { id: "t-reviewer", name: "Test Reviewer", email: "t-reviewer@test", roles: ["kyc_reviewer"] },
  both: { id: "t-both", name: "Analyst+Reviewer", email: "t-both@test", roles: ["kyc_analyst", "kyc_reviewer"] },
  admin: { id: "t-admin", name: "Test Admin", email: "t-admin@test", roles: ["admin"] },
} satisfies Record<string, CurrentUser>;

export async function ensureUsers() {
  for (const u of Object.values(users)) {
    const data = { ...u, roles: u.roles.join(",") };
    await db.user.upsert({ where: { id: u.id }, create: data, update: data });
  }
}

/** Audit rows can't be deleted, so each test works on a fresh, uniquely-named case. */
export async function makeCase(status = "pending") {
  return db.kycCase.create({
    data: {
      id: `T-${randomUUID()}`,
      customerName: "Test Customer",
      dateOfBirth: "1990-01-01",
      country: "GB",
      idDocType: "passport",
      idDocNumber: "P12345678",
      riskScore: 50,
      sanctionsHit: false,
      pepHit: false,
      status,
    },
  });
}

export function auditFor(entityId: string) {
  return db.auditLog.findMany({ where: { entityId }, orderBy: { id: "asc" } });
}
