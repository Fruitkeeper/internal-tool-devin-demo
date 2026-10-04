# Internal Tools Portal (prototype)

A small internal-tools portal for a fintech company. It shows two things:

1. A **minimal shared platform** (`src/platform/`): stub auth, server-side role checks, an append-only audit log, generic maker-checker approvals, and an app registry that drives navigation and access.
2. A **KYC review app** (`src/apps/kyc/`) built entirely on top of that platform.

The point is reusability. A second app (refunds, feature flags, …) should plug into the same platform without touching KYC code. [CONVENTIONS.md](./CONVENTIONS.md) explains how to add one.

**Feature specification:** [SPEC.md](./SPEC.md) covers the platform and indexes the apps. [src/apps/kyc/SPEC.md](./src/apps/kyc/SPEC.md) covers the KYC app's roles, workflow, pages, audit actions and invariants.

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
| Erin Admin | `admin` | Access control (change anyone's roles), audit log viewer, read-only access to every app, reveal IDs |
| Sam Senior | `kyc_analyst`, `kyc_reviewer` | demo that you **can't approve your own** recommendation |
| Rita Refunds | `refunds_analyst` | recommend refunds |
| Rex Refunds Reviewer | `refunds_reviewer` | approve or reject refund recommendations |
| Quinn Refunds Lead | `refunds_analyst`, `refunds_reviewer` | demo that you can't approve your own refund recommendation |
| Fiona Flags | `flags_editor` | change feature flags; production changes need approval |
| Felix Flag Approver | `flags_approver` | approve or reject production flag changes |
| Pat Platform Lead | `flags_editor`, `flags_approver` | demo that you can't approve your own flag change |
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

## Refunds walkthrough

The Refunds Dashboard is the second app, built on the same platform. Its full behavior is in [src/apps/refunds/SPEC.md](./src/apps/refunds/SPEC.md).

1. **Rita**: open **Refunds Dashboard**, then filter by status or amount range. Open a `pending` refund, write a note, and click **Recommend refund**.
2. **Rex**: open the same refund and click **Approve refund** or **Reject**.
3. **Self-approval check**: as **Quinn**, open RF-2022 (recommended by Quinn) and try to approve it. You get "You cannot approve or reject your own submission".
4. **Erin**: the audit log can be filtered by app `refunds`.

## Feature Flag Admin walkthrough

The third app: configuration edits rather than a case queue. Its full behavior is in [src/apps/flags/SPEC.md](./src/apps/flags/SPEC.md).

1. **Fiona**: open **Feature Flag Admin**, open `smart-alerts` in `staging`, enable it at 30% and click **Save**. It applies immediately.
2. **Fiona**: open `dark-mode` in `production`, change the rollout, add a reason and click **Request production change**. The flag is unchanged and shows "pending approval".
3. **Felix**: open the same flag and click **Approve change** or **Reject**.
4. **Self-approval check**: as **Pat**, open `new-checkout` in `production` (requested by Pat) and try to approve it. You get "You cannot approve or reject your own submission".
5. **Erin**: the audit log can be filtered by app `flags`.

## Access control walkthrough

1. **Erin**: open **Access control**. Each row shows a user's roles and what they can do in KYC, Refunds and Feature Flags.
2. Click **Edit** on **Alice**, uncheck `kyc_analyst`, check `kyc_reviewer`, and click **Save roles**. Alice's KYC column now reads "Approve / reject".
3. Switch to **Alice** and open KYC-1028, a `recommended` case submitted by Sam. She can now approve it or send it back. She no longer has the analyst actions, and still can't approve the cases she recommended herself (KYC-1027, KYC-1029).
4. **Erin**: grant **Zoe** `refunds_analyst`. Switch to Zoe: Refunds appears in her nav. Revoke it again and it disappears, and `/refunds` shows Access denied.
5. **Erin**: filter the audit log by app `access` to see each `user.roles_changed` entry with before and after roles.

Role changes persist across `npm run dev` restarts. `npm run db:reset` restores the seeded roles.

## What is enforced, and where

- **Authorization is server-side.** Every function in each app's `service.ts` calls `requireRole` first. Server actions only resolve the current user and delegate to the service. Hidden buttons are convenience, not security.
- **Audit entries are written in the same transaction as the change.** `recordAudit(tx, …)` takes a transaction client. If an action fails, no audit row is written.
- **The audit log is append-only.** SQLite triggers in the initial migration abort any `UPDATE` or `DELETE` on `AuditLog`, and the app has no code path that edits it.
- **Maker-checker.** `decideApproval` rejects decisions by the submitter, users without a checker role, and requests that were already decided.
- **Invalid status transitions are rejected.** They are defined in `src/apps/kyc/workflow.ts`.
- **ID numbers are masked by default.** Pages and audit snapshots only ever get the masked value. The full number is returned only by `revealIdNumber`, which writes an audit entry.

- **Role changes are admin-only on the server.** `setUserRoles` calls `requireRole(actor, ["admin"])`, accepts only roles declared in the registry, and audits every change in the same transaction.

Tests covering these rules are in `tests/`.

## Prototype tradeoffs (deliberate)

- **Stub auth.** Any visitor can pick any user. Replace `getCurrentUser()` with OIDC or Entra ID.
- **Roles are stored as a comma-separated string on `User`.** Access control assigns the roles apps already declare; there are no custom roles or per-user overrides.
- **No pagination, case assignment, notifications, or E2E tests.**
- **Audit snapshots are JSON strings** (SQLite has no JSON column type). The audit viewer shows the latest 200 entries.
- **Seed history.** Seeded in-progress cases have audit history written directly by the seed script.
