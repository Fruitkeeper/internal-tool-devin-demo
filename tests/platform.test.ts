import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { recordAudit } from "@/platform/audit";
import { db } from "@/platform/db";
import { users } from "./helpers";

describe("audit log is append-only", () => {
  it("rejects updates and deletes at the database level", async () => {
    const entry = await db.$transaction((tx) =>
      recordAudit(tx, { user: users.admin, role: "admin", appId: "test", action: "test.created", entityType: "Test", entityId: "1" }),
    );
    // The trigger aborts the statement (Prisma surfaces it as a generic constraint error).
    await expect(db.auditLog.update({ where: { id: entry.id }, data: { action: "tampered" } })).rejects.toThrow();
    await expect(db.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`DELETE FROM "AuditLog"`)).rejects.toThrow(/append-only/);
    expect(await db.auditLog.findUnique({ where: { id: entry.id } })).toMatchObject({ action: "test.created" });
  });
});

describe("architecture", () => {
  it("src/platform never imports from src/apps", () => {
    const files: string[] = [];
    const walk = (dir: string) =>
      readdirSync(dir).forEach((f) => {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(p);
      });
    walk(path.resolve(__dirname, "../src/platform"));
    const offenders = files.filter((f) => /from ["']@\/apps|from ["']\.\.\/.*apps/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
