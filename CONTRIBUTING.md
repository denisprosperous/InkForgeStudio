# Contributing to Inkforge Studio

Thanks for helping forge books. This repo runs a few non-negotiable gates —
read this before your first commit.

## Setup

```bash
nvm use                 # Node ≥ 22.12.0 (.nvmrc); npm ≥ 9.0.0
npm install
cp .env.example .env    # DATABASE_URL at minimum; provider keys optional
npm run docker:up       # local Postgres 16
npm run db:generate && npm run db:migrate && npm run db:seed
npm run dev             # forge :4000 + web :3000
```

## Workflow

1. Branch off `main` with a descriptive name (`feat/outline-generator`,
   `fix/export-ttl`, `chore/audit-2027q1`).
2. Keep commits small and imperative; prefix with `feat:`, `fix:`, `chore:`,
   `docs:`, `test:`, `refactor:`.
3. Run the full battery before pushing (the pre-commit hook only covers
   staged files):

   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run audit:dod -- --strict
   ```

## Quality gates (enforced by `.husky/pre-commit`)

| Gate                  | What it enforces                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `lint-staged`         | `eslint --fix` + `prettier --write` on staged files; lint errors block the commit.                               |
| `npm run audit:stubs` | Every workspace must have package.json, build config, entry point, tests — and zero TODO/FIXME/XXX/HACK markers. |

### Tenancy guard (`inkforge/no-unscoped-user-query`)

Every drizzle `select`/`update`/`delete` touching a user-scoped table must
filter with `eq(table.userId, userId)` **inside the same statement** — a
predicates array built earlier doesn't count, spell the userId scope inline.
The only acceptable suppression is a genuinely system-scoped worker/retention
query with a justification comment directly above the statement:

```ts
// System scope by design — the fleet worker competes for due jobs across
// ALL users; per-user caps are applied before enqueue (§6.4).
// eslint-disable-next-line inkforge/no-unscoped-user-query
const claimed = await db.update(jobs)…
```

If you find yourself suppressing a user-facing query, stop: that's a
cross-tenant leak, not a lint nit.

## Dependency policy

Every new dependency pin must be verified against the registry
(`npm view <name>@<version>`) **before** it lands in a `package.json` — a
fabricated version once blocked all installs (gap G-01). CI installs from
`package-lock.json` only, so commit the lockfile with dependency changes.

## Protected core

`packages/core` is the frozen core (book model, humanize engine incl. the
`POLISH_SYSTEM` prompt, formatting, EPUB export): **additive wrappers only**.
Prompt changes and engine rewrites go through the guardrail process described
in `docs/audit/phase-2-gap-register-and-build-plan.md` §7 (eval deltas, diff
budget, rollback registry) — don't hot-tweak them in a feature PR.

## Audits

`docs/audit/` is the upgrade charter (protocol **NEGENTROPY-1**), re-run
quarterly: `npm run audit:stubs`, `npm run audit:dod -- --strict`, then
re-score the Phase 1 tables and re-rank the Phase 2 register with a dated
note. Move register items MUST → NEXT → DEFER only with a logged reason.
