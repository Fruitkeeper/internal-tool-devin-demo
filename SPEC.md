# Functional specification

This is the source of truth for **what the portal does**. Read it to understand any feature without reading the code. For **how to add a new app**, see [CONVENTIONS.md](./CONVENTIONS.md). For setup and the demo walkthrough, see [README.md](./README.md).

Keep this file in sync with the code. If a change alters a feature, role, transition, audit action or invariant, update the matching section in the same PR.

---

## 1. System overview

| Part | Location | Responsibility |
| --- | --- | --- |
| Platform | `src/platform/` | Auth, authorization, audit log, maker-checker approvals, app registry, shared UI. Knows nothing about any specific app. |
| App registry | `src/apps/index.ts` | List of installed apps. Drives navigation, portal tiles and app access. |
| KYC app | `src/apps/kyc/` | Customer identity case review. |
| Routes | `src/app/` | Thin Next.js route files that re-export pages from the platform or apps. |
| Data | `prisma/schema.prisma` | SQLite database (`prisma/dev.db`). Tests use `prisma/test.db`. |

Dependency rule: `apps → platform`, never the reverse, and never app → app.

---

## 2. Platform features

### 2.1 Authentication (stub)

- The current user is stored in the `demo_user_id` cookie. You change it with the **"Signed in as"** dropdown in the header, which redirects to `/`.
- If the cookie is missing or invalid, the first user by id (`alice`) is used.
- `getCurrentUser()` in `src/platform/auth/index.ts` is the **only** entry point. Swapping in OIDC or Entra ID means changing that function alone.
- There are no passwords or sessions. Anyone can pick any user. This is intentional for the prototype.

### 2.2 Authorization

- Roles are plain strings. `admin` is the only platform role. Apps define their own roles (KYC: `kyc_analyst`, `kyc_reviewer`).
- A user can hold several roles (stored comma-separated in `User.roles`).
- `requireRole(user, roles)` throws `ForbiddenError` unless the user holds at least one of `roles`. It returns the matching role, which is recorded in the audit log.
- **Every server-side query and mutation calls `requireRole` itself.** Hiding a button is only a convenience. Calling a server action directly with the wrong role still fails.

### 2.3 App registry and navigation

- Each app declares an `AppDefinition`: `{ id, name, description, route, roles }`.
- A user **can access an app** if they hold any role in `app.roles`.
- The header nav and the portal home page (`/`) show only the apps the user can access. Admins also see an **Audit log** link.
- Each app's route layout shows **Access denied** for users without access. Service functions enforce the same rule independently.

### 2.4 Audit log

- One table, `AuditLog`, shared by all apps.
- Each entry holds: `createdAt`, `userId`, `userName`, `role` (the role that authorized the action), `appId`, `action`, `entityType`, `entityId`, `before` (JSON or null), `after` (JSON or null).
- `recordAudit(tx, …)` requires a transaction client. The entry is committed **atomically** with the state change. If the action fails, no entry is written.
- **Append-only.** SQLite triggers abort any `UPDATE` or `DELETE` on `AuditLog`, including raw SQL.
- Sensitive values (full ID numbers) are never written to snapshots. Only the masked form appears.

### 2.5 Audit log viewer: `/admin/audit`

- **Admin only.** Other users see Access denied.
- Read-only table showing the newest 200 entries, newest first: id, time, user (role), app, action, entity, and changed fields.
- Exact-match filters: app id, action, entity type, entity id, user.
- "Changes" lists only the fields that differ between `before` and `after`. Timestamps are ignored.

### 2.6 Maker-checker approvals

Generic and app-agnostic (`src/platform/approvals/index.ts`). Each `Approval` record has: `appId`, `entityType`, `entityId`, `proposedAction`, `note`, `status` (`pending | approved | rejected`), `submittedById`, `decidedById`, `decisionNote`, `createdAt` and `decidedAt`.

| Rule | Enforced in |
| --- | --- |
| The maker must hold one of `makerRoles` | `submitApproval` |
| A note is required (non-blank) | `submitApproval` |
| At most one **pending** approval per entity | `submitApproval` |
| The checker must hold one of `checkerRoles` | `decideApproval` |
| **The checker cannot be the maker** (no self-approval, even with both roles) | `decideApproval` |
| Only `pending` approvals can be decided (no double decisions) | `decideApproval` |
| Each submission and decision is audited (`approval.submitted`, `approval.approved`, `approval.rejected`) | both |

The platform does not change the app's entity. The calling app applies its own state change in the same transaction, based on the decision.

### 2.7 Error handling

- `ForbiddenError`, `ValidationError` and `NotFoundError` (all subclasses of `AppError`) carry messages that are safe to show to users.
- Server actions use `runAndRedirect(path, fn)`. On an `AppError`, it redirects back with `?error=<message>`, which the page shows as a red banner. Any other error is a real failure and is rethrown.

---

## 3. KYC app

App id `kyc`, route `/kyc`. Access: `kyc_analyst`, `kyc_reviewer` or `admin`.

### 3.1 Case data (`KycCase`)

| Field | Notes |
| --- | --- |
| `id` | e.g. `KYC-1001` |
| `customerName`, `dateOfBirth` (YYYY-MM-DD), `country` (ISO-2) | Customer info |
| `idDocType` | `passport`, `national_id` or `drivers_license` |
| `idDocNumber` | Mock number, **masked by default** (`•••••5678`) |
| `riskScore` | 0–100 |
| `sanctionsHit`, `pepHit` | Risk flags |
| `status` | See 3.3 |
| `escalated` | Boolean flag, see 3.4 |
| `createdAt` | Drives "case age" |

Risk bands: **low** 0–39, **medium** 40–69, **high** 70–100.

### 3.2 Permissions

| Capability | kyc_analyst | kyc_reviewer | admin | no role |
| --- | :-: | :-: | :-: | :-: |
| View queue and case detail | ✓ | ✓ | ✓ (read-only) | ✗ |
| Start review | ✓ | ✗ | ✗ | ✗ |
| Submit recommendation | ✓ | ✗ | ✗ | ✗ |
| Escalate | ✓ | ✗ | ✗ | ✗ |
| Decide on a recommendation (approve or send back) | ✗ | ✓ (not your own) | ✗ | ✗ |
| Reveal full ID number | ✗ | ✓ | ✓ | ✗ |
| View audit log viewer | ✗ | ✗ | ✓ | ✗ |

A user holding both analyst and reviewer roles can do both, but can never decide on their own recommendation.

### 3.3 Workflow

```
pending ──start review──▶ in_review ──recommend──▶ recommended ──reviewer approves──▶ approved | rejected
                              ▲                          │
                              └──────── send back ───────┘
```

| From | To | Triggered by | Conditions |
| --- | --- | --- | --- |
| `pending` | `in_review` | Analyst: **Start review** | — |
| `in_review` | `recommended` | Analyst: **Submit for review** with outcome `approve` or `reject` and a note | Note required; creates a pending `Approval` with `proposedAction = outcome` |
| `recommended` | `approved` | Reviewer: **Approve recommendation** on an `approve` proposal | Reviewer ≠ submitter |
| `recommended` | `rejected` | Reviewer: **Approve recommendation** on a `reject` proposal | Reviewer ≠ submitter |
| `recommended` | `in_review` | Reviewer: **Send back** (rejects the recommendation) | Reviewer ≠ submitter; analyst can recommend again |

- `approved` and `rejected` are **terminal**. No further actions are allowed.
- Any other transition is rejected server-side with `Invalid status transition: <from> → <to>`. The case and the audit log are left unchanged.
- The reviewer's decision note is optional.
- Any analyst can work on any case; there is no case assignment.

### 3.4 Escalation

- An analyst can escalate any **non-terminal** case that isn't already escalated. A reason is required.
- Escalation sets `escalated = true` and does **not** change the status. The reason is recorded in the audit entry.
- Escalated cases show a red **escalated** badge in the queue and on the case page, and can be filtered. There is no "de-escalate" action.

### 3.5 ID number masking and reveal

- Pages and audit snapshots only ever receive the masked value. All but the last 4 characters are replaced with `•`.
- **Reveal (audited)** (reviewer or admin) calls a server action that writes a `case.id_revealed` audit entry, then returns the full number for display. Reloading the page masks it again.

### 3.6 Pages

**Queue: `/kyc`**
- Table columns: case id (link), customer, country, risk (score and band), flags (sanctions / PEP / escalated), status, age in days.
- Filters are URL query params, applied with **Apply**:
  - `status`: any status
  - `risk`: `low`, `medium` or `high`
  - `escalated=1`: escalated cases only
- `sort` options: `risk_desc` (default), `risk_asc`, `age_desc` (oldest first), `age_asc` (newest first).
- **Reset** clears all filters.

**Case detail: `/kyc/[id]`**
- Customer card, including the masked ID number and a Reveal button for reviewers and admins.
- Risk signals card: score, sanctions and PEP results.
- History: every audit entry for the case and its approvals, oldest first, with user, role, time and changed fields.
- Actions card, depending on role and status:
  - Start review
  - Recommendation form
  - Pending-recommendation box, with Approve and Send back buttons for reviewers
  - Escalation form
  - "Closed" message for terminal cases
  - "Read-only access" for users without analyst or reviewer roles
- Errors appear as a red banner at the top.

### 3.7 Audit actions emitted

| Action | Entity | Emitted when | `after` contains |
| --- | --- | --- | --- |
| `case.review_started` | KycCase | pending → in_review | masked case, `status: in_review` |
| `approval.submitted` | Approval | Recommendation submitted | approval snapshot (`proposedAction`, `note`, `status: pending`, …) |
| `case.recommended` | KycCase | in_review → recommended | masked case, `recommendation`, `approvalId` |
| `approval.approved` | Approval | Reviewer approves the recommendation | approval snapshot with `decidedById` and `decisionNote` |
| `case.decided` | KycCase | recommended → approved or rejected | masked case, `approvalId` |
| `approval.rejected` | Approval | Reviewer sends back | approval snapshot |
| `case.recommendation_rejected` | KycCase | recommended → in_review | masked case, `approvalId` |
| `case.escalated` | KycCase | Escalation | masked case with `escalated: true`, `escalationReason` |
| `case.id_revealed` | KycCase | Full ID number revealed | `{ field: "idDocNumber" }` |

KycCase entries also store the masked `before` snapshot.

### 3.8 Seed data (`prisma/seed.ts`)

- Seeding is deterministic, so every install gets the same data.
- `npm run dev` seeds only when the database is empty. `npm run db:reset` wipes and reseeds.
- Users:

| id | Roles |
| --- | --- |
| alice, bob | `kyc_analyst` |
| carol, dave | `kyc_reviewer` |
| erin | `admin` |
| sam | `kyc_analyst`, `kyc_reviewer` |
| zoe | none |

- Cases:

| Cases | Status |
| --- | --- |
| KYC-1001 to 1022 | `pending` |
| KYC-1023 to 1026 | `in_review` |
| KYC-1027, KYC-1029 | `recommended`, by Alice |
| KYC-1028, KYC-1030 | `recommended`, by Sam |

- Seeded in-progress cases come with matching audit history.

---

## 4. Invariants and where they are tested

| Invariant | Test |
| --- | --- |
| An analyst cannot invoke the decide/approve action | `tests/kyc-workflow.test.ts` › authorization |
| Reviewers cannot perform analyst actions; analysts cannot reveal IDs | same |
| Page data never contains the full ID number | same |
| A user cannot approve their own recommendation | `tests/kyc-workflow.test.ts` › maker-checker |
| Approve applies the proposed outcome; send back returns to `in_review` | same |
| A recommendation requires a note | same |
| Each mutation writes the expected audit entries (user, role, before/after) | `tests/kyc-workflow.test.ts` › audit trail |
| Failed actions write no audit entry (same transaction) | same |
| Invalid transitions are rejected and leave state and audit unchanged | `tests/kyc-workflow.test.ts` › workflow transitions |
| The audit log rejects UPDATE and DELETE | `tests/platform.test.ts` |
| `src/platform` never imports from `src/apps` | `tests/platform.test.ts` |

Run them with `npm test`.

---

## 5. Out of scope (deliberate)

- Real SSO
- Production deployment
- Real identity-verification integrations
- Notifications
- Pagination
- Case assignment
- Role-management UI
- De-escalation
- E2E test suite
- Per-app database schemas
- Dynamic app loading
