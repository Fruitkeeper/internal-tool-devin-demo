import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const USERS = [
  { id: "alice", name: "Alice Analyst", email: "alice@example.com", roles: "kyc_analyst" },
  { id: "bob", name: "Bob Analyst", email: "bob@example.com", roles: "kyc_analyst" },
  { id: "carol", name: "Carol Reviewer", email: "carol@example.com", roles: "kyc_reviewer" },
  { id: "dave", name: "Dave Reviewer", email: "dave@example.com", roles: "kyc_reviewer" },
  { id: "erin", name: "Erin Admin", email: "erin@example.com", roles: "admin" },
  { id: "sam", name: "Sam Senior", email: "sam@example.com", roles: "kyc_analyst,kyc_reviewer" },
  { id: "zoe", name: "Zoe Visitor", email: "zoe@example.com", roles: "" },
];

const FIRST = ["Ana", "Ben", "Chen", "Dara", "Elif", "Farah", "Goran", "Hana", "Ivan", "Jae", "Kofi", "Lena", "Mateo", "Nia", "Omar"];
const LAST = ["Silva", "Okafor", "Novak", "Haddad", "Kim", "Larsen", "Mendes", "Petrov", "Rossi", "Tanaka", "Weber", "Yilmaz"];
const COUNTRIES = ["GB", "DE", "FR", "ES", "NG", "BR", "AE", "SG", "US", "TR", "RU", "MX"];
const DOC_TYPES = ["passport", "national_id", "drivers_license"];

// Deterministic PRNG so every install gets the same data.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join("");

async function main() {
  if (process.argv.includes("--if-empty") && (await db.user.count()) > 0) {
    console.log("Database already seeded.");
    return;
  }

  for (const u of USERS) await db.user.create({ data: u });

  const now = Date.now();
  for (let i = 0; i < 30; i++) {
    const sanctionsHit = rand() < 0.1;
    const pepHit = rand() < 0.12;
    const base = Math.floor(rand() * 75) + 5;
    const docType = pick(DOC_TYPES);
    const prefix = docType === "passport" ? "P" : docType === "national_id" ? "N" : "D";
    const id = `KYC-${1001 + i}`;
    const createdAt = new Date(now - (i * 1.7 + rand()) * 24 * 60 * 60 * 1000);

    // Most cases start pending; a few are mid-workflow so every step can be demoed immediately.
    const status = i >= 26 ? "recommended" : i >= 22 ? "in_review" : "pending";

    await db.kycCase.create({
      data: {
        id,
        customerName: `${pick(FIRST)} ${pick(LAST)}`,
        dateOfBirth: `${1950 + Math.floor(rand() * 55)}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`,
        country: pick(COUNTRIES),
        idDocType: docType,
        idDocNumber: `${prefix}${digits(8)}`,
        riskScore: Math.min(99, base + (sanctionsHit ? 30 : 0) + (pepHit ? 15 : 0)),
        sanctionsHit,
        pepHit,
        status,
        createdAt,
      },
    });

    if (status === "in_review" || status === "recommended") {
      const analyst = USERS[i % 2 === 0 ? 0 : 5]; // alice or sam
      await db.auditLog.create({
        data: { userId: analyst.id, userName: analyst.name, role: "kyc_analyst", appId: "kyc", action: "case.review_started",
          entityType: "KycCase", entityId: id, before: JSON.stringify({ status: "pending" }), after: JSON.stringify({ status: "in_review" }), createdAt },
      });
      if (status === "recommended") {
        const proposedAction = i % 2 === 0 ? "approve" : "reject";
        const approval = await db.approval.create({
          data: { appId: "kyc", entityType: "KycCase", entityId: id, proposedAction, note: "Seeded recommendation: documents checked.", submittedById: analyst.id, createdAt },
        });
        await db.auditLog.create({
          data: { userId: analyst.id, userName: analyst.name, role: "kyc_analyst", appId: "kyc", action: "approval.submitted",
            entityType: "Approval", entityId: approval.id, after: JSON.stringify(approval), createdAt },
        });
        await db.auditLog.create({
          data: { userId: analyst.id, userName: analyst.name, role: "kyc_analyst", appId: "kyc", action: "case.recommended",
            entityType: "KycCase", entityId: id, before: JSON.stringify({ status: "in_review" }), after: JSON.stringify({ status: "recommended", recommendation: proposedAction }), createdAt },
        });
      }
    }
  }
  console.log(`Seeded ${USERS.length} users and 30 KYC cases.`);
}

main().finally(() => db.$disconnect());
