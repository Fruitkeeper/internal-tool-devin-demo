# Internal Tools Portal (prototype)

A small internal-tools portal for a fintech company. It shows two things:

1. A **minimal shared platform** (`src/platform/`): stub auth, server-side role checks, an append-only audit log, generic maker-checker approvals, and an app registry that drives navigation and access.
2. A **KYC review app** (`src/apps/kyc/`) built entirely on top of that platform.

The point is reusability. A second app (refunds, feature flags, …) should plug into the same platform without touching KYC code. [CONVENTIONS.md](./CONVENTIONS.md) explains how to add one.

Stack: Next.js 15 (App Router) · TypeScript · Prisma + SQLite · Tailwind CSS 4 · Vitest. It needs no external services.

## Run it

Requires Node 20+.

```bash
npm install
npm run dev        # applies migrations, seeds on first run, starts http://localhost:3000
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | Vitest suite (uses a separate `prisma/test.db`) |
| `npm run db:reset` | Wipe and reseed the local database |
| `npm run typecheck` | `tsc --noEmit` |

## Demo users

Use the **"Signed in as"** switcher in the header. This is stub auth (a cookie); real SSO would replace `getCurrentUser()`.

| User | Roles | Use it to… |
| --- | --- | --- |
| Alice Analyst | `kyc_analyst` | work cases, recommend, escalate |
| Bob Analyst | `kyc_analyst` | second analyst |
| Carol Reviewer | `kyc_reviewer` | approve or send back recommendations, reveal IDs |
| Dave Reviewer | `kyc_reviewer` | second reviewer |
| Erin Admin | `admin` | read-only KYC access, audit log viewer, reveal IDs |
| Sam Senior | `kyc_analyst`, `kyc_reviewer` | demo that you **can't approve your own** recommendation |
| Zoe Visitor | none | demo access denied |

## KYC workflow walkthrough

```
pending → in_review → recommended → approved / rejected
                ↑            │
                └── sent back┘   (reviewer rejects the recommendation)
```

1. **Alice**: open **KYC Review** and filter or sort the queue (status, risk band, risk score, case age, escalated only). Open a `pending` case and click **Start review**.
2. **Alice**: choose *Recommend approve* or *Recommend reject*, write a note (required), and submit. The case becomes `recommended` and a maker-checker approval is created.
3. **Carol**: open the same case.
   - **Approve recommendation** applies the analyst's outcome, so the case becomes `approved` or `rejected`.
   - **Send back** returns it to `in_review`.
4. **Carol**: click **Reveal (audited)** next to the masked ID number. The reveal shows up in the case history.
5. **Self-approval check**: as **Sam**, recommend on a case, then try to approve it. You get "You cannot approve or reject your own submission". Cases KYC-1028 and KYC-1030 are seeded with recommendations from Sam.
6. **Escalate**: as an analyst, escalate any open case. A reason is required, and the case gets an `escalated` flag in the queue.
7. **Erin**: open **Audit log** and filter by app, action, entity or user.

Every step appears in the case's **History** panel, which reads from the audit log.

## What is enforced, and where

- **Authorization is server-side.** Every function in `src/apps/kyc/service.ts` calls `requireRole` first. Server actions only resolve the current user and delegate to the service. Hidden buttons are convenience, not security.
- **Audit entries are written in the same transaction as the change.** `recordAudit(tx, …)` takes a transaction client. If an action fails, no audit row is written.
- **The audit log is append-only.** SQLite triggers in the initial migration abort any `UPDATE` or `DELETE` on `AuditLog`, and the app has no code path that edits it.
- **Maker-checker.** `decideApproval` rejects decisions by the submitter, users without a checker role, and requests that were already decided.
- **Invalid status transitions are rejected.** They are defined in `src/apps/kyc/workflow.ts`.
- **ID numbers are masked by default.** Pages and audit snapshots only ever get the masked value. The full number is returned only by `revealIdNumber`, which writes an audit entry.

Tests covering these rules are in `tests/`.

## Prototype tradeoffs (deliberate)

- **Stub auth.** Any visitor can pick any user. Replace `getCurrentUser()` with OIDC or Entra ID.
- **Roles are stored as a comma-separated string on `User`.** There is no role-management UI.
- **No pagination, case assignment, notifications, or E2E tests.**
- **Audit snapshots are JSON strings** (SQLite has no JSON column type). The audit viewer shows the latest 200 entries.
- **Seed history.** Seeded in-progress cases have audit history written directly by the seed script.
