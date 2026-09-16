# Inkforge Studio

**Forge books. Not prompts.**

Inkforge Studio is the complete studio for authors publishing KDP-compliant
ebooks: outline → draft → humanize → validate → export, with a multi-provider
AI core, a tenancy-guarded Postgres backbone, and an export pipeline that
refuses to ship an EPUB that EPUBCheck would reject.

This repository is a private, npm-workspaces monorepo (Node ≥ 24.9, npm ≥ 11.6
— see `.nvmrc` and `engines`).

---

## What's inside

| Path              | Workspace          | What it is                                                                                                                       |
| ----------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | `@inkforge/web`    | Author-facing studio. Next.js 15 + React 19 + Tailwind 4 + Radix + TipTap editor. Deploys to Cloudflare Pages.                   |
| `apps/forge`      | `@inkforge/forge`  | Generation service. Express 5 API + job worker loop, EPUB/DOCX pipelines (`epub-gen-memory`, `mammoth`), covers (`sharp`), pino. |
| `packages/core`   | `@inkforge/core`   | **Frozen core**: book model, seeded humanize engine, formatting, EPUB export, EPUBCheck validation. Additive-only.               |
| `packages/ai`     | `@inkforge/ai`     | `LlmClient` interface + provider adapters (OpenAI, Gemini, DeepSeek) with injectable transports for offline tests.               |
| `packages/db`     | `@inkforge/db`     | Drizzle schema of record + repository layer. Tenancy enforced in schema, queries, and a custom ESLint guard.                     |
| `packages/covers` | `@inkforge/covers` | Cover _contract_: spec every generator must produce + KDP trim constants (1600×2560, 1:1.6). Renderers are swappable.            |
| `packages/ui`     | `@inkforge/ui`     | Shared UI primitives for the studio.                                                                                             |
| `packages/config` | `@inkforge/config` | Typed env/feature-flag config (provider keys, rate limits, `ALLOW_*` gates, fallbacks).                                          |
| `scripts/`        | —                  | Dev/build/start orchestrators, stub & definition-of-done audits, forge benchmark, asset fetcher.                                 |
| `docker/`         | —                  | `docker compose` for the one hard runtime dependency: Postgres 16.                                                               |
| `docs/audit/`     | —                  | **NEGENTROPY-1** audit charter: capability inventory, ranked gap register, build plan, guardrail map.                            |

## Architecture at a glance

- **Two runtimes, one database.** `web` is the edge-rendered studio (Cloudflare
  Pages); `forge` is a Node service (`http://localhost:4000` by default) that
  owns auth bridging, the job API, and the worker loop. **Postgres is the only
  durable store**; jobs run in-process (no external queue) until scale demands
  otherwise (audit assumption A3).
- **Multi-provider AI.** `packages/ai` isolates vendor SDKs behind adapters;
  selection order is _user key → platform key → local fallback_
  (`LOCAL_LLM_ENABLED`, `PUBLIC_FALLBACK_ENABLED` flags gate the risky paths).
- **Humanize engine.** A deterministic, seeded rule engine (contractions,
  filler trims, stock-phrase rewrites, sentence-length variance) plus an
  optional injected LLM polish pass — same manuscript + seed always reproduces
  the same diff, so authors can audit every change.
- **KDP compliance by construction.** Covers validate against KDP trim specs;
  exports must pass EPUBCheck (fail-soft when Java is absent); the
  AI-disclosure layer is tracked as open gap
  [G-06](docs/audit/phase-2-gap-register-and-build-plan.md).
- **Tenancy is guarded three ways.** Every user-scoped table carries `userId`;
  every repo query filters on it; and the custom
  `inkforge/no-unscoped-user-query` ESLint rule fails any statement that
  touches user-owned tables without a visible `userId` scope (system-scoped
  worker/retention queries carry explicit, justified suppressions).

## Quickstart

Prerequisites: **Node ≥ 24.9.0** (`.nvmrc`), **npm ≥ 11.6.0**, Docker (for the
bundled Postgres) or any Postgres 16+ instance.

```bash
nvm use                     # pick up Node 24.9 from .nvmrc
npm install                 # installs all workspaces from the lockfile
cp .env.example .env        # fill in DATABASE_URL + any provider keys you have
npm run docker:up           # Postgres 16 on localhost:5432 (inkforge/inkforge/inkforge)
```

```bash
npm run db:generate         # generate SQL migrations from the Drizzle schema
npm run db:migrate          # apply them to DATABASE_URL
npm run db:seed             # optional: idempotent demo author + starter book
```

Run the studio:

```bash
npm run dev                 # forge :4000 + web :3000, prefixed concurrent output
```

`npm run db:seed` plants a demo author (`author@inkforge.local`, two-chapter
starter book) so `npm run dev` shows a living studio immediately.

## npm scripts

| Script                          | What it does                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`                   | `forge` (tsx watch) + `web` (next dev) concurrently, prefixed logs.                 |
| `npm run build`                 | Solution build in dependency order: `tsc -b` → web via `@cloudflare/next-on-pages`. |
| `npm run start`                 | Start the built forge service (`node dist/index.js`).                               |
| `npm run lint`                  | ESLint 9 (flat config) incl. the `inkforge/no-unscoped-user-query` guard.           |
| `npm run typecheck`             | `tsc -b` (all packages) + `tsc --noEmit` for `apps/web`.                            |
| `npm test`                      | Vitest across all workspaces **with v8 coverage**.                                  |
| `npm run test:e2e`              | Playwright end-to-end suite.                                                        |
| `npm run audit:stubs`           | Pre-commit gate: workspace completeness + TODO/FIXME/stub markers.                  |
| `npm run audit:dod -- --strict` | Definition-of-done audit (promote to CI once clean).                                |
| `npm run db:generate`           | `drizzle-kit generate` from `packages/db/src/schema.ts` → `packages/db/drizzle/`.   |
| `npm run db:migrate`            | `drizzle-kit migrate` against `DATABASE_URL`.                                       |
| `npm run db:seed`               | Idempotent demo seed.                                                               |
| `npm run db:studio`             | `drizzle-kit studio` (schema browser).                                              |
| `npm run docker:up`             | `docker compose up --build` for Postgres 16.                                        |
| `npm run bench:forge`           | Forge pipeline benchmark.                                                           |
| `npm run deploy:web`            | `wrangler pages deploy` → Cloudflare Pages project `inkforge-studio`.               |
| `npm run preview:web`           | Local Cloudflare Pages preview (next-on-pages + wrangler).                          |

## Testing & quality gates

The repo enforces its own gates — a commit can't slip through with the
guardrails off (`.husky/pre-commit`):

1. **`lint-staged`** — `eslint --fix` + `prettier --write` on every staged file.
2. **`npm run audit:stubs`** — every workspace must have its package.json,
   build config, entry point and tests, with zero TODO/FIXME/XXX/HACK markers.

Before pushing, run the full battery:

```bash
npm run lint               # 0 errors expected
npm run typecheck          # solution graph + web
npm test                   # vitest + coverage (13 suites / 91 tests as of 2026-09-16)
npm run audit:dod -- --strict
```

### Tenancy guard protocol

The `inkforge/no-unscoped-user-query` rule requires every drizzle
`select`/`update`/`delete` against a user-scoped table to reference `userId`
inside the same statement. A query that is _genuinely_ system-scoped (worker
queue claim/reclaim, retention purges) must carry a justification comment and
an explicit `// eslint-disable-next-line inkforge/no-unscoped-user-query`
directly above the statement. Anything else is a bug — fix the query, don't
suppress the rule.

## Deployment

- **Web** → Cloudflare Pages: `npm run build:web` produces the
  `@cloudflare/next-on-pages` output in `.vercel/output/static`, then
  `npm run deploy:web` publishes it as project `inkforge-studio`
  (`npm run preview:web` for a local preview).
- **Forge** → any Node ≥ 24 host or container: `npm run build` then
  `npm run start`. Configure `DATABASE_URL`, `FORGE_SHARED_SECRET` (web ↔ forge
  bridge), and provider keys via environment; see `.env.example` for the full
  contract including feature flags and runtime limits.

## Project status & documentation

The platform's audit protocol is **NEGENTROPY-1** (audit → gap-rank → upgrade →
guardrail → future-proof), and the charter lives in-repo:

| Document                                                                                                 | Scope                                                                    |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`docs/audit/README.md`](docs/audit/README.md)                                                           | Audit charter, evidence basis, quarterly re-run procedure.               |
| [`docs/audit/phase-1-capability-inventory.md`](docs/audit/phase-1-capability-inventory.md)               | B1–B20 table-stakes + C1–C13 edge capabilities vs. built code.           |
| [`docs/audit/phase-2-gap-register-and-build-plan.md`](docs/audit/phase-2-gap-register-and-build-plan.md) | Ranked gap register, wiring plan, roadmap, guardrail map, risk register. |

Built and verified (as of 2026-09-16): frozen core (book model, humanize,
formatting, export + EPUBCheck), AI provider adapters, Drizzle schema +
repository layer with tenancy guard, config/feature-flag layer, forge and web
shells, full tooling chain. Open critical gaps tracked in the register
include: forge auth bridge + job API + worker routes (G-04), AI-disclosure
layer for KDP exports (G-06), generated migrations (G-07), outline generator
(G-14), and the studio UI flows (G-17) — see the gap register for the ranked
plan before picking up work.

## License

`UNLICENSED` — private, all rights reserved. Not for redistribution.
