# Functional specification

This is the entry point for **what the portal does**. It specifies the shared platform and indexes each app's own spec. Read it to understand any feature without reading the code. For **how to add a new app**, see [CONVENTIONS.md](./CONVENTIONS.md). For setup and the demo walkthrough, see [README.md](./README.md).

Each app's behavior is specified in `src/apps/<app>/SPEC.md`, next to its code (see [section 3](#3-apps)). Keep each spec in sync with the code it describes, and update it in the same PR as any behavior change.

---

## 1. System overview

| Part | Location | Responsibility |
| --- | --- | --- |
| Platform | `src/platform/` | Auth, authorization, audit log, maker-checker approvals, app registry, shared UI. Knows nothing about any specific app. |
| App registry | `src/apps/index.ts` | List of installed apps. Drives navigation, portal tiles and app access. |
| Apps | `src/apps/<app>/` | One directory per app, each with its own `SPEC.md`. |
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

## 3. Apps

| App | Route | Roles with access | Spec |
| --- | --- | --- | --- |
| KYC Review | `/kyc` | `kyc_analyst`, `kyc_reviewer`, `admin` | [src/apps/kyc/SPEC.md](./src/apps/kyc/SPEC.md) |

A new app adds one row here, alongside its registry entry in `src/apps/index.ts`.

### Demo users

Users are seeded by `prisma/seed.ts` and switched in the header. App-specific seed data is described in each app's spec.

| id | Roles |
| --- | --- |
| alice, bob | `kyc_analyst` |
| carol, dave | `kyc_reviewer` |
| erin | `admin` |
| sam | `kyc_analyst`, `kyc_reviewer` |
| zoe | none (sees no apps) |

---

## 4. Platform invariants and where they are tested

| Invariant | Test |
| --- | --- |
| The audit log rejects UPDATE and DELETE | `tests/platform.test.ts` |
| `src/platform` never imports from `src/apps` | `tests/platform.test.ts` |
| Self-approval is blocked; approvals can't be decided twice; a note is required | Exercised through the KYC app in `tests/kyc-workflow.test.ts` › maker-checker |

App invariants are listed in each app's spec. Run everything with `npm test`.

---

## 5. Out of scope (deliberate)

- Real SSO
- Production deployment
- Notifications
- Role-management UI
- E2E test suite
- Per-app database schemas
- Dynamic app loading
