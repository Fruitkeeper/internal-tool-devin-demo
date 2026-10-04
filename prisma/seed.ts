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
  { id: "rita", name: "Rita Refunds", email: "rita@example.com", roles: "refunds_analyst" },
  { id: "rex", name: "Rex Refunds Reviewer", email: "rex@example.com", roles: "refunds_reviewer" },
  { id: "quinn", name: "Quinn Refunds Lead", email: "quinn@example.com", roles: "refunds_analyst,refunds_reviewer" },
  { id: "fiona", name: "Fiona Flags", email: "fiona@example.com", roles: "flags_editor" },
  { id: "felix", name: "Felix Flag Approver", email: "felix@example.com", roles: "flags_approver" },
  { id: "pat", name: "Pat Platform Lead", email: "pat@example.com", roles: "flags_editor,flags_approver" },
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

// Idempotent: missing users are created and each app's data is seeded only if its table is empty,
// so adding a new app's seed works on an existing database. Existing users keep their roles, so
// changes made on Admin → Access control survive `npm run dev` restarts (`npm run db:reset` restores them).
async function main() {
  for (const u of USERS) await db.user.upsert({ where: { id: u.id }, create: u, update: {} });
  if ((await db.kycCase.count()) === 0) await seedKyc();
  if ((await db.refund.count()) === 0) await seedRefunds();
  if ((await db.featureFlag.count()) === 0) await seedFlags();
}

async function seedKyc() {
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
  console.log("Seeded 30 KYC cases.");
}

// ---------- Refunds app ----------

const REASONS = ["Item not received", "Damaged on arrival", "Duplicate charge", "Wrong item sent", "Subscription cancelled", "Service outage credit"];

async function seedRefunds() {
  let s = 7; // separate PRNG so refunds data doesn't depend on KYC seeding
  const r = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pickR = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const now = Date.now();
  for (let i = 0; i < 25; i++) {
    const id = `RF-${2001 + i}`;
    const createdAt = new Date(now - (i * 1.3 + r()) * 24 * 60 * 60 * 1000);
    const dollars = r() < 0.2 ? 1000 + r() * 4000 : 10 + r() * 600;
    const status = i >= 21 ? "recommended" : "pending";
    await db.refund.create({
      data: {
        id,
        customerName: `${pickR(FIRST)} ${pickR(LAST)}`,
        orderRef: `ORD-${String(Math.floor(r() * 1e6)).padStart(6, "0")}`,
        amountCents: Math.round(dollars * 100),
        reason: pickR(REASONS),
        status,
        createdAt,
      },
    });
    if (status === "recommended") {
      const analyst = USERS.find((u) => u.id === (i % 2 === 0 ? "rita" : "quinn"))!;
      const note = "Seeded recommendation: order history checked.";
      const approval = await db.approval.create({
        data: { appId: "refunds", entityType: "Refund", entityId: id, proposedAction: "refund", note, submittedById: analyst.id, createdAt },
      });
      await db.auditLog.create({
        data: { userId: analyst.id, userName: analyst.name, role: "refunds_analyst", appId: "refunds", action: "approval.submitted",
          entityType: "Approval", entityId: approval.id, after: JSON.stringify({ status: "pending", proposedAction: "refund", note, submittedById: analyst.id }), createdAt },
      });
      await db.auditLog.create({
        data: { userId: analyst.id, userName: analyst.name, role: "refunds_analyst", appId: "refunds", action: "refund.recommended",
          entityType: "Refund", entityId: id, before: JSON.stringify({ status: "pending" }), after: JSON.stringify({ status: "recommended", approvalId: approval.id }), createdAt },
      });
    }
  }
  console.log("Seeded 25 refunds.");
}

// ---------- Feature Flags app ----------

const FLAGS = [
  { key: "new-checkout", description: "Redesigned checkout flow" },
  { key: "instant-payouts", description: "Same-day merchant payouts" },
  { key: "card-freeze-v2", description: "New card freeze/unfreeze screen" },
  { key: "smart-alerts", description: "ML-based spending alerts" },
  { key: "crypto-wallet", description: "Crypto wallet tab" },
  { key: "dark-mode", description: "Dark theme in the customer app" },
];
// [development, staging, production] as [enabled, rolloutPct]
const FLAG_STATES: [boolean, number][][] = [
  [[true, 100], [true, 100], [false, 0]],
  [[true, 100], [true, 50], [true, 25]],
  [[true, 100], [true, 100], [true, 100]],
  [[true, 100], [false, 0], [false, 0]],
  [[false, 0], [false, 0], [false, 0]],
  [[true, 100], [true, 100], [true, 10]],
];
const ENVS = ["development", "staging", "production"];

async function seedFlags() {
  for (const [i, f] of FLAGS.entries()) {
    for (const [j, environment] of ENVS.entries()) {
      const [enabled, rolloutPct] = FLAG_STATES[i][j];
      await db.featureFlag.create({ data: { id: `${f.key}.${environment}`, ...f, environment, enabled, rolloutPct } });
    }
  }
  // Two pending production changes: one by Pat (to demo self-approval being blocked), one by Fiona.
  const pending = [
    { flagId: "new-checkout.production", by: "pat", before: { enabled: false, rolloutPct: 0 }, proposed: { enabled: true, rolloutPct: 10 }, note: "Start canary at 10%." },
    { flagId: "instant-payouts.production", by: "fiona", before: { enabled: true, rolloutPct: 25 }, proposed: { enabled: true, rolloutPct: 50 }, note: "No incidents at 25%; widening." },
  ];
  for (const p of pending) {
    const u = USERS.find((x) => x.id === p.by)!;
    const proposedAction = JSON.stringify(p.proposed);
    const approval = await db.approval.create({
      data: { appId: "flags", entityType: "FeatureFlag", entityId: p.flagId, proposedAction, note: p.note, submittedById: u.id },
    });
    await db.auditLog.create({
      data: { userId: u.id, userName: u.name, role: "flags_editor", appId: "flags", action: "approval.submitted", entityType: "Approval",
        entityId: approval.id, after: JSON.stringify({ status: "pending", proposedAction, note: p.note, submittedById: u.id }) },
    });
    await db.auditLog.create({
      data: { userId: u.id, userName: u.name, role: "flags_editor", appId: "flags", action: "flag.change_requested", entityType: "FeatureFlag",
        entityId: p.flagId, before: JSON.stringify(p.before), after: JSON.stringify({ ...p.proposed, approvalId: approval.id }) },
    });
  }
  console.log(`Seeded ${FLAGS.length * ENVS.length} feature flag settings.`);
}

main().finally(() => db.$disconnect());
