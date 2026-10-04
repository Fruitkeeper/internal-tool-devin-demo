# Adding an internal app

For what existing features do, see [SPEC.md](./SPEC.md). This is the playbook for adding a new app (example: **refunds**) to the portal. Follow it as written. If you find you need to change another app's code, stop and move the shared piece into `src/platform/` instead.

## Layout

```
src/platform/        shared capabilities. Must never import from src/apps (a test enforces this).
src/apps/index.ts    the app registry, the only shared file you edit
src/apps/<app>/      everything specific to your app
src/app/<route>/     thin Next.js route files that re-export pages from src/apps/<app>/pages
prisma/schema.prisma your app's models go in a "// ---------- <App> app ----------" section
```

Dependency direction: `apps → platform`. Apps never import from each other.

## 1. Define roles

Create `src/apps/refunds/roles.ts`:

```ts
export const REFUNDS_AGENT = "refunds_agent";
export const REFUNDS_APPROVER = "refunds_approver";
```

Role ids are plain strings with an app prefix. `ADMIN_ROLE` is the only platform-level role (`@/platform/authz`). To give a demo user a role, edit `roles` in `prisma/seed.ts`. It's a comma-separated string.

## 2. Register the app

`src/apps/refunds/app.ts`:

```ts
import { ADMIN_ROLE } from "@/platform/authz";
import type { AppDefinition } from "@/platform/registry";
import { REFUNDS_AGENT, REFUNDS_APPROVER } from "@/apps/refunds/roles";

export const refundsApp: AppDefinition = {
  id: "refunds",
  name: "Refunds",
  description: "Request and approve customer refunds.",
  route: "/refunds",
  roles: [REFUNDS_AGENT, REFUNDS_APPROVER, ADMIN_ROLE], // anyone with one of these can open the app
};
```

Then add it to `src/apps/index.ts`:

```ts
export const apps: AppDefinition[] = [kycApp, refundsApp];
```

The header nav and portal home page update automatically, filtered by role.

## 3. Add routes

Put pages in `src/apps/refunds/pages/` and re-export them from thin route files:

```ts
// src/app/refunds/layout.tsx: UI guard (copy src/apps/kyc/pages/KycLayout.tsx, swap the app)
export { default } from "@/apps/refunds/pages/RefundsLayout";
// src/app/refunds/page.tsx
export { default } from "@/apps/refunds/pages/ListPage";
```

## 4. Put business logic in a service, with authorization first

`src/apps/refunds/service.ts` holds every rule. Each exported function:

1. takes `user: CurrentUser` as its first argument,
2. calls `requireRole(user, [...])` **before doing anything else**, and keeps the returned role for the audit entry,
3. performs writes inside `db.$transaction(async (tx) => …)`.

Server actions (`actions.ts`, `"use server"`) stay thin. They resolve the user and call the service:

```ts
export async function requestRefundAction(fd: FormData) {
  await runAndRedirect("/refunds", async () => svc.requestRefund(await getCurrentUser(), String(fd.get("orderId"))));
}
```

`runAndRedirect` (`@/platform/actions`) shows any `AppError` (`ForbiddenError`, `ValidationError`, `NotFoundError`) as `?error=…`. Hiding buttons in the UI is fine, but it never replaces the service check.

## 5. Audit every state change

```ts
import { recordAudit } from "@/platform/audit";

await db.$transaction(async (tx) => {
  const before = await tx.refund.findUniqueOrThrow({ where: { id } });
  const after = await tx.refund.update({ where: { id }, data: { status: "paid" } });
  await recordAudit(tx, {
    user, role, appId: refundsApp.id,
    action: "refund.paid",               // "<entity>.<verb>"
    entityType: "Refund", entityId: id,
    before, after,                        // strip sensitive fields first (see toPublic in kyc/service.ts)
  });
});
```

- `recordAudit` requires `tx`, so the entry is committed or rolled back together with the change.
- The audit log is append-only (DB triggers). Never try to edit it.
- Reads of sensitive data (like the KYC ID reveal) should be audited too.
- Admins see your entries in **Audit log** automatically. To show history on a detail page, use `auditHistoryFor([{ entityType, entityId }])`.

## 6. Use maker-checker approvals

`@/platform/approvals` is generic. It stores `appId`, `entityType`, `entityId`, `proposedAction` and `note`, and knows nothing about your domain.

```ts
// Maker: inside your transaction
await submitApproval(tx, {
  appId: refundsApp.id, entityType: "Refund", entityId: refund.id,
  user, makerRoles: [REFUNDS_AGENT], proposedAction: "pay", note,
});

// Checker: inside your transaction
const pending = await getPendingApproval("Refund", refund.id, tx);
const approval = await decideApproval(tx, {
  approvalId: pending!.id, user, checkerRoles: [REFUNDS_APPROVER], decision: "approved", note,
});
if (approval.status === "approved") { /* apply your state change + recordAudit */ }
```

The platform enforces the role checks, a non-empty note, one pending approval per entity, **no self-approval**, and no double decisions. It also audits `approval.submitted`, `approval.approved` and `approval.rejected`. Your app decides what each outcome means for its own entity.

## 7. Model state transitions explicitly

If your entity has a lifecycle, write a transition table and `assertTransition()` like `src/apps/kyc/workflow.ts`. Call it inside the transaction before updating, and use `where: { id, status: current.status }` on the update.

## 8. Test the invariants

Add `tests/<app>.test.ts`. Call service functions directly with fake `CurrentUser`s (see `tests/helpers.ts`). The minimum set:

- the wrong role gets `ForbiddenError`,
- the maker can't approve their own request,
- each mutation writes the expected audit entry,
- invalid transitions throw `ValidationError`.

## Checklist

- [ ] `src/apps/<app>/{roles,app,service,actions}.ts`, `pages/`, `components/`
- [ ] Registered in `src/apps/index.ts`
- [ ] Thin route files in `src/app/<route>/`
- [ ] Prisma models plus a migration (`npx prisma migrate dev --name <app>_init`), and seed data
- [ ] Every mutation: `requireRole` → transaction → `recordAudit`
- [ ] Tests for authz, maker-checker, audit, and transitions
- [ ] No imports from other apps, and no app imports inside `src/platform`
