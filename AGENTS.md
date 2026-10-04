# Agent guide

- **What the system does:** [SPEC.md](./SPEC.md). Read it first.
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
- Update SPEC.md whenever a change affects behavior.
