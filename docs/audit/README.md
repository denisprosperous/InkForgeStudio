# NEGENTROPY-1 Audit — Inkforge Studio

Audit protocol: **NEGENTROPY-1** (audit → gap-rank → upgrade → guardrail → future-proof).
This directory is the upgrade charter. Re-run quarterly (see `How to re-run` below).

| Artifact                                                                           | Scope                                                        | Status                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------- |
| [phase-1-capability-inventory.md](./phase-1-capability-inventory.md)               | B1–B20 (table stakes) + C1–C13 (edge) vs. built code         | Complete — 2026-09-16 |
| [phase-2-gap-register-and-build-plan.md](./phase-2-gap-register-and-build-plan.md) | Ranked gap register + completion strategy + wiring + roadmap | Complete — 2026-09-16 |

## Audit basis (evidence)

- Full read of every source file in `packages/*` and `apps/*` (see Phase 1 evidence column).
- Live validation on 2026-09-16: `npm install` (after dependency repair), `npm test`, `npm run typecheck`, `npm run lint`, `npm run audit:stubs`, `npm run audit:dod`, `npm run bench:forge`.
- Repo forensics: git index (staged scaffold, zero commits), pre-commit hook, referenced-but-missing scripts.

## How to re-run

1. `npm run audit:stubs` — workspace completeness + stub markers (pre-commit gate).
2. `npm run audit:dod -- --strict` — definition-of-done gate (promote to CI once clean).
3. Re-score Phase 1 tables against new evidence; append a dated row to each capability's Notes.
4. Re-rank Phase 2; move items MUST → NEXT → DEFER only with a logged reason.
