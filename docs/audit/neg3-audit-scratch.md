# NEGENTROPY-3 — Audit Scratch (DELETED BEFORE FINAL PUSH)

## Phase A — verified state (2026-09-16, SHA 3ee05f6)

| Check              | Result                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| git                | clean, main == origin/main @ 3ee05f6                                    |
| node/npm           | v22.22.1 / 9.2.0 (below engines ≥24.9/11.6 → E10/G-29 decision needed)  |
| docker             | 29.8.1 OK (a VPN container occupies port 3000!)                         |
| java               | ABSENT (no sudo) → D14 needs L3 (portable JRE download)                 |
| audit:stubs        | clean                                                                   |
| audit:dod --strict | 1 gap: packages/ui exports ./studio → dist missing (source missing too) |

| GAP         | Register status                     | VERIFIED status                                                                  | Closeable now?                              |
| ----------- | ----------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------- |
| G-01..03,05 | Fixed 09-16                         | verified (install/typecheck/tests green)                                         | —                                           |
| G-04        | routes/worker open                  | app.ts = healthz/readyz only; queries.ts has full queue primitives               | YES (3 sub-commits)                         |
| G-06        | Open                                | formatting has copyright page; no disclosure anywhere                            | YES (additive core wrapper)                 |
| G-07        | Open                                | packages/db/drizzle/ absent                                                      | YES (db:generate + docker pg verify)        |
| G-08        | adapters exist; selection/cost open | config has provider list; no selection helper; ChatCompletionResult has no usage | YES                                         |
| G-11        | Open                                | no docx/audio adapters                                                           | YES (audio+docx; KPF = documented external) |
| G-14        | Open                                | outlineSchema + save/latestOutline exist; NO generator                           | YES (deterministic seeded)                  |
| G-17        | Shell only                          | page.tsx = marketing + health pill only                                          | YES (web api proxy + flows)                 |
| G-28        | Open                                | e2e/ dir missing; no CI                                                          | YES                                         |

## Decisions taken (autonomic)

- G-29/Q2: engines floor lowered to node >=22.12.0, npm >=9.0.0; .nvmrc 22.22.1; CI matrix 22+24.
- Q3 (disclosure copy): authored defensible KDP wording, flagged SPECULATIVE in commit.
- Port 3000 occupied on host → playwright config gains WEB_PORT env (default 3000); local e2e on 3100.
- Java via portable Temurin JRE under ~/tools (no sudo available).
