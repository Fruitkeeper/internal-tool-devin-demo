# Agent guide

- **What the system does:** [SPEC.md](./SPEC.md) covers the platform and indexes the apps. Each app's behavior is in `src/apps/<app>/SPEC.md` (for example [KYC](./src/apps/kyc/SPEC.md)). Read the spec for the area you're changing first.
- **How to add an app:** [CONVENTIONS.md](./CONVENTIONS.md).
- **Setup and demo:** [README.md](./README.md).

Commands. Node comes from nvm, so run `source ~/.nvm/nvm.sh` first if `node` is missing.

| Command | What it does |
| --- | --- |
| `npm run dev` | Migrates and seeds on first run, then serves http://localhost:3000 |
| `npm test` | Vitest |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:reset` | Destroys local data and reseeds |

Rules:
- `src/platform` must never import from `src/apps`.
- Every mutation follows the same pattern: `requireRole` → transaction → `recordAudit`.
- Update the matching spec in the same PR whenever a change affects behavior: the root `SPEC.md` for platform changes, `src/apps/<app>/SPEC.md` for app changes.
