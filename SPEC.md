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

- Each app declares an `AppDefinition`: `{ id, name, description, route, roles, permissions? }`. `permissions` maps each role to a few words describing what it can do in that app; it is display-only, shown on Access control.
- A user **can access an app** if they hold any role in `app.roles`.
- The header nav and the portal home page (`/`) show only the apps the user can access. Admins also see **Access control** and **Audit log** links.
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

### 2.6 Access control: `/admin/access`

Central role management across all apps (`src/platform/access/index.ts`). There is **no second permission model**: app access is still "holds any role in `app.roles`", and each app's service still calls `requireRole`. This page only edits `User.roles`.

- **Admin only.** The page shows Access denied to everyone else, and both service functions call `requireRole(actor, ["admin"])` themselves, so calling the server action directly as a non-admin fails with Forbidden.
- **Table:** one row per user with their role ids and, for each registered app, the `permissions` labels of the roles they hold in it, or "—" if they can't open it.
- **Change roles:** "Edit" opens a checkbox per assignable role, grouped by Platform (`admin`) and app. Granting or revoking an app means checking or unchecking its roles. "Save roles" calls `setUserRoles(actor, userId, roles, apps)`, which:
  - accepts only `admin` plus roles declared in the registry (anything else is a `ValidationError`);
  - rejects a no-op ("No changes to save");
  - rejects an admin removing their own `admin` role, so the portal can't be left without an admin by accident;
  - updates `User.roles` and writes the audit entry in one transaction.
- **Audit:** app `access`, action `user.roles_changed`, entity `User:<target id>`, `before`/`after` = `{ user, roles }`. The entry's user and role are the acting admin; `createdAt` is the timestamp.
- **Takes effect on the next request.** `getCurrentUser()` reads roles from the database on every request, so the affected user's nav, app guards and service checks change as soon as they load a page. Pending approvals are not touched; `decideApproval` checks the checker's roles at decision time.
- **Seed:** `prisma/seed.ts` creates missing demo users but no longer overwrites existing users' roles, so changes survive `npm run dev` restarts. `npm run db:reset` restores the seeded roles.

### 2.7 Maker-checker approvals

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

### 2.8 Error handling

- `ForbiddenError`, `ValidationError` and `NotFoundError` (all subclasses of `AppError`) carry messages that are safe to show to users.
- Server actions use `runAndRedirect(path, fn)`. On an `AppError`, it redirects back with `?error=<message>`, which the page shows as a red banner. Any other error is a real failure and is rethrown.

---

## 3. Apps

| App | Route | Roles with access | Spec |
| --- | --- | --- | --- |
| KYC Review | `/kyc` | `kyc_analyst`, `kyc_reviewer`, `admin` | [src/apps/kyc/SPEC.md](./src/apps/kyc/SPEC.md) |
| Refunds Dashboard | `/refunds` | `refunds_analyst`, `refunds_reviewer`, `admin` | [src/apps/refunds/SPEC.md](./src/apps/refunds/SPEC.md) |
| Feature Flag Admin | `/flags` | `flags_editor`, `flags_approver`, `admin` | [src/apps/flags/SPEC.md](./src/apps/flags/SPEC.md) |

A new app adds one row here, alongside its registry entry in `src/apps/index.ts`.

### Demo users

Users are seeded by `prisma/seed.ts` and switched in the header. App-specific seed data is described in each app's spec.

| id | Roles |
| --- | --- |
| alice, bob | `kyc_analyst` |
| carol, dave | `kyc_reviewer` |
| erin | `admin` |
| sam | `kyc_analyst`, `kyc_reviewer` |
| rita | `refunds_analyst` |
| rex | `refunds_reviewer` |
| quinn | `refunds_analyst`, `refunds_reviewer` |
| fiona | `flags_editor` |
| felix | `flags_approver` |
| pat | `flags_editor`, `flags_approver` |
| zoe | none (sees no apps) |

---

## 4. Platform invariants and where they are tested

| Invariant | Test |
| --- | --- |
| The audit log rejects UPDATE and DELETE | `tests/platform.test.ts` |
| `src/platform` never imports from `src/apps` | `tests/platform.test.ts` |
| Only admins can list access or change roles; every role change is audited; unknown roles, no-ops and self-removal of admin are rejected | `tests/access-control.test.ts` |
| App authorization follows role changes immediately (promote analyst → reviewer can approve; revoke → Forbidden) | `tests/access-control.test.ts` |
| Self-approval is blocked; approvals can't be decided twice; a note is required | Exercised through each app: `tests/kyc-workflow.test.ts`, `tests/refunds.test.ts` and `tests/feature-flags.test.ts` › maker-checker |

App invariants are listed in each app's spec. Run everything with `npm test`.

---

## 5. Out of scope (deliberate)

- Real SSO
- Production deployment
- Notifications
- Custom roles, per-user permission overrides, or a policy language (Access control only assigns existing roles)
- E2E test suite
- Per-app database schemas
- Dynamic app loading
