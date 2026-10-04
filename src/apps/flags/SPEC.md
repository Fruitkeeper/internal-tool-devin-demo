# Feature Flag Admin: functional specification

This file describes **what the Feature Flag Admin app does**. Shared platform behavior (auth, `requireRole`, the audit log, maker-checker approvals, the registry) is specified in the [root SPEC.md](../../../SPEC.md) and isn't repeated here.

Keep this file in sync with `src/apps/flags/`. If a change alters a role, rule, page, audit action or invariant, update the matching section in the same PR.

The app id is `flags` and the route is `/flags`. Users with `flags_editor`, `flags_approver` or `admin` can access it. It edits configuration records only; nothing reads these flags at runtime.

## 1. Flag data (`FeatureFlag`)

One row per flag per environment.

| Field | Notes |
| --- | --- |
| `id` | `<key>.<environment>`, e.g. `new-checkout.production` |
| `key`, `description` | Flag name and what it controls |
| `environment` | `development`, `staging` or `production` |
| `enabled` | On or off |
| `rolloutPct` | Whole number, 0–100 |
| `updatedAt` | When the config last changed |

## 2. Permissions

| Capability | flags_editor | flags_approver | admin | other users |
| --- | :-: | :-: | :-: | :-: |
| View list and flag detail | ✓ | ✓ | ✓ (read-only) | ✗ |
| Change development or staging config | ✓ | ✗ | ✗ | ✗ |
| Request a production change | ✓ | ✗ | ✗ | ✗ |
| Approve or reject a production change | ✗ | ✓ (not your own) | ✗ | ✗ |

## 3. Change rules

- **Development and staging:** an editor's change applies immediately. A reason note is optional and isn't stored.
- **Production:** an editor's change creates a pending `Approval` and the flag is **unchanged**. A reason note is required.
  - Approve, by a different user with `flags_approver`: the proposed config is applied.
  - Reject: the flag stays as it was.
  - Only one pending change per flag; the platform rejects a second.
- Validation: rollout must be a whole number from 0 to 100, and a change identical to the current config is rejected with "No changes to save".
- The proposed config is stored as JSON in `Approval.proposedAction`, e.g. `{"enabled":true,"rolloutPct":10}`, because the platform approval has no payload field.

## 4. Pages

**List (`/flags`)**
- Table columns: key (link), description, environment, state, rollout, and a "pending approval" badge. Sorted by key, then environment.
- Filter: `env` query param, applied with **Apply**; **Reset** clears it.

**Flag detail (`/flags/[id]`)**
- Flag card and history, which shows audit entries for the flag and its approvals.
- Actions card:
  - **Pending change**: who requested it, current → proposed, and the note. Approvers get Approve and Reject buttons.
  - **Edit form** for editors when no change is pending: state, rollout %, a note for production, and a **Save** or **Request production change** button.
  - "Read-only access" for users with neither role.

## 5. Audit actions emitted

| Action | Entity | When |
| --- | --- | --- |
| `flag.updated` | FeatureFlag | Config applied: directly (development/staging) or on approval (production, `after` includes the `approvalId`) |
| `flag.change_requested` | FeatureFlag | Production change requested. `before` is the current config; `after` is the proposed config plus the `approvalId` |
| `approval.submitted` / `approval.approved` / `approval.rejected` | Approval | Written by the platform |

## 6. Seed data (`prisma/seed.ts`)

- 6 flags × 3 environments = 18 rows.
- Pending production changes:
  - `new-checkout.production`, off → on at 10%, requested by Pat
  - `instant-payouts.production`, 25% → 50%, requested by Fiona
- Demo users:

| User | Roles |
| --- | --- |
| fiona | `flags_editor` |
| felix | `flags_approver` |
| pat | `flags_editor` and `flags_approver`, to demo that self-approval is blocked |
| erin | `admin`, read-only |

## 7. Invariants and where they are tested

All of these are tested in `tests/feature-flags.test.ts`.

| Invariant | `describe` block |
| --- | --- |
| Approvers and admins can't change flags; admins can read; editors can't approve | flags authorization |
| Users without a flags role can't read flags | flags authorization |
| Non-production changes apply immediately and are audited | flags non-production changes |
| Invalid rollout values and no-op changes are rejected, with no audit entries | flags non-production changes |
| A production change has no effect until approved, and requires a note | flags production maker-checker |
| The requester can't approve their own change | flags production maker-checker |
| One pending change per flag | flags production maker-checker |
| Approval applies the change; rejection leaves it unchanged; both are audited | flags production maker-checker |

## 8. Out of scope (deliberate)

- Flag evaluation or SDKs, i.e. nothing consumes these flags
- Creating or deleting flags, and editing descriptions
- Targeting rules or segments
- Promoting a config between environments
- Pagination
