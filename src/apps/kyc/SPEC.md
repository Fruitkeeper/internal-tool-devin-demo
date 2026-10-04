# KYC Review: functional specification

This file describes **what the KYC app does**. Shared platform behavior (auth, `requireRole`, the audit log, maker-checker approvals, the registry) is specified in the [root SPEC.md](../../../SPEC.md) and isn't repeated here.

Keep this file in sync with `src/apps/kyc/`. If a change alters a role, transition, page, audit action or invariant, update the matching section in the same PR.

App id `kyc`, route `/kyc`. Access: `kyc_analyst`, `kyc_reviewer` or `admin`.

## 1. Case data (`KycCase`)

| Field | Notes |
| --- | --- |
| `id` | e.g. `KYC-1001` |
| `customerName`, `dateOfBirth` (YYYY-MM-DD), `country` (ISO-2) | Customer info |
| `idDocType` | `passport`, `national_id` or `drivers_license` |
| `idDocNumber` | Mock number, **masked by default** (`•••••5678`) |
| `riskScore` | 0–100 |
| `sanctionsHit`, `pepHit` | Risk flags |
| `status` | See section 3 |
| `escalated` | Boolean flag, see section 4 |
| `createdAt` | Drives "case age" |

Risk bands: **low** 0–39, **medium** 40–69, **high** 70–100.

## 2. Permissions

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

## 3. Workflow

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

## 4. Escalation

- An analyst can escalate any **non-terminal** case that isn't already escalated. A reason is required.
- Escalation sets `escalated = true` and does **not** change the status. The reason is recorded in the audit entry.
- Escalated cases show a red **escalated** badge in the queue and on the case page, and can be filtered. There is no "de-escalate" action.

## 5. ID number masking and reveal

- Pages and audit snapshots only ever receive the masked value. All but the last 4 characters are replaced with `•`.
- **Reveal (audited)** (reviewer or admin) calls a server action that writes a `case.id_revealed` audit entry, then returns the full number for display. Reloading the page masks it again.

## 6. Pages

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

## 7. Audit actions emitted

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

## 8. Seed data (`prisma/seed.ts`)

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

## 9. Invariants and where they are tested

All in `tests/kyc-workflow.test.ts`:

| Invariant | `describe` block |
| --- | --- |
| An analyst cannot invoke the decide/approve action | authorization |
| Reviewers cannot perform analyst actions; analysts cannot reveal IDs | authorization |
| Page data never contains the full ID number | authorization |
| A user cannot approve their own recommendation | maker-checker |
| Approve applies the proposed outcome; send back returns to `in_review` | maker-checker |
| A recommendation requires a note | maker-checker |
| Each mutation writes the expected audit entries (user, role, before/after) | audit trail |
| Failed actions write no audit entry (same transaction) | audit trail |
| Invalid transitions are rejected and leave state and audit unchanged | workflow transitions |

---

## 10. Out of scope (deliberate)

- Real identity-verification integrations
- Case assignment or claiming
- De-escalation
- Pagination
