# Refunds Dashboard: functional specification

This file describes **what the Refunds app does**. Shared platform behavior (auth, `requireRole`, the audit log, maker-checker approvals, the registry) is specified in the [root SPEC.md](../../../SPEC.md) and isn't repeated here.

Keep this file in sync with `src/apps/refunds/`. If a change alters a role, transition, page, audit action or invariant, update the matching section in the same PR.

The app id is `refunds` and the route is `/refunds`. Users with `refunds_analyst`, `refunds_reviewer` or `admin` can access it.

## 1. Refund data (`Refund`)

| Field | Notes |
| --- | --- |
| `id` | e.g. `RF-2001` |
| `customerName`, `orderRef` | Who the refund is for, and the order it relates to |
| `amountCents` | Integer cents, shown in USD |
| `reason` | Free-text reason for the request |
| `status` | See section 3 |
| `createdAt` | When the refund was requested |

## 2. Permissions

| Capability | refunds_analyst | refunds_reviewer | admin | other users |
| --- | :-: | :-: | :-: | :-: |
| View queue and refund detail | ✓ | ✓ | ✓ (read-only) | ✗ |
| Recommend a refund | ✓ | ✗ | ✗ | ✗ |
| Approve or reject a recommendation | ✗ | ✓ (not your own) | ✗ | ✗ |

## 3. Workflow

```
pending ──analyst recommends──▶ recommended ──reviewer approves──▶ approved
                                     └──────reviewer rejects──────▶ rejected
```

| From | To | Triggered by | Conditions |
| --- | --- | --- | --- |
| `pending` | `recommended` | Analyst: **Recommend refund** with a note | Note required. Creates a pending `Approval` with `proposedAction = "refund"` |
| `recommended` | `approved` | Reviewer: **Approve refund** | Reviewer must not be the person who recommended it |
| `recommended` | `rejected` | Reviewer: **Reject** | Reviewer must not be the person who recommended it |

- `approved` and `rejected` are terminal states.
- Any other transition is rejected server-side with `Invalid status transition: <from> → <to>`.
- The reviewer's decision note is optional.
- The app models the decision only. No money is moved.

## 4. Pages

**Queue (`/refunds`)**
- Table columns: refund id (link), customer, order, amount, reason, status. Rows are sorted oldest first.
- Filters are URL query params, applied with **Apply**:
  - `status`
  - `min` and `max`, in dollars, inclusive
- **Reset** clears all filters.

**Refund detail (`/refunds/[id]`)**
- A refund card.
- History: audit entries for the refund and its approvals.
- An actions card, depending on role and status:
  - the recommend form
  - the pending recommendation, with Approve and Reject buttons for reviewers
  - a closed message
  - "Read-only access" for users without a refunds role

## 5. Audit actions emitted

| Action | Entity | When |
| --- | --- | --- |
| `approval.submitted` | Approval | A recommendation is submitted (written by the platform) |
| `refund.recommended` | Refund | `pending → recommended`. `after` includes the `approvalId` |
| `approval.approved` / `approval.rejected` | Approval | A reviewer decides (written by the platform) |
| `refund.approved` / `refund.rejected` | Refund | `recommended → approved / rejected`. `after` includes the `approvalId` |

Refund entries store full `before` and `after` snapshots. Refunds have no sensitive fields.

## 6. Seed data (`prisma/seed.ts`)

- 25 refunds, `RF-2001` to `RF-2025`, generated deterministically. About 20% are over $1,000.
- `RF-2022` and `RF-2024` are `recommended` by Quinn. `RF-2023` and `RF-2025` are `recommended` by Rita. The rest are `pending`.
- Demo users:

| User | Roles |
| --- | --- |
| rita | `refunds_analyst` |
| rex | `refunds_reviewer` |
| quinn | `refunds_analyst` and `refunds_reviewer`, to demo that self-approval is blocked |
| erin | `admin`, read-only |

## 7. Invariants and where they are tested

All of these are tested in `tests/refunds.test.ts`.

| Invariant | `describe` block |
| --- | --- |
| An analyst cannot approve a refund | refunds authorization |
| Reviewers and admins cannot recommend. Admins can read | refunds authorization |
| Users without a refunds role cannot read refunds | refunds authorization |
| A user cannot approve their own recommendation | refunds maker-checker |
| A different reviewer can approve or reject | refunds maker-checker |
| A recommendation requires a note | refunds maker-checker |
| Recommending and deciding write the expected audit entries, including the approval entries | refunds audit and transitions |
| Invalid transitions are rejected and write no audit entries | refunds audit and transitions |

## 8. Out of scope (deliberate)

- Payment execution
- Partial refunds
- Multi-currency
- Send-back to `pending`
- Sorting
- Pagination
