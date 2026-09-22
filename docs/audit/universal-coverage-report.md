# Universal Coverage Report

Built incrementally by `scripts/coverage-cell.ts` — one commit per cell
(persistence rules 3.8–3.11). Every row below was produced by
`planForCell` from `packages/core/src/research/coverage.ts` and is
covered by `packages/core/test/research-coverage.test.ts` plus the
anti-fabrication suite (`packages/core/test/research-anti-fabrication.test.ts`, 11/11 green).

## Adapters

| ID | Scope | Test |
|----|-------|------|
| E-1 | fiction structure (genre-aware beats) | packages/core/test/research-e1-fiction.test.ts |
| E-2 | nonfiction evidence + claim checker | packages/core/test/research-e2-nonfiction.test.ts |
| E-3 | academic citation slots | packages/core/test/research-e3-academic.test.ts |
| E-4 | professional case studies | packages/core/test/research-e4-b2b.test.ts |
| E-5 | children's reading levels | packages/core/test/research-e5-childrens.test.ts |
| E-6 | international market adaptation | packages/core/test/research-e6-international.test.ts |

## Genre profiles (E-1)

fantasy, science-fiction, mystery, thriller, romance, historical, horror, literary.

## Coverage matrix

Probe topics are the canonical per-category topics in `scripts/coverage-cell.ts`.

| Cell (category/availability) | Verdict | Adapter | Test | Refusal reason |
|---|---|---|---|---|
| fiction/full | PASS | E-1-fiction-structure | packages/core/test/research-coverage.test.ts | — |

## Summary

- Cells evaluated: 1 / 21
- PASS: 1   REFUSED (legit, reason cited): 0   GAP: 0

## Anti-fabrication

The eleven-case refusal suite (licensed domains, no-data categories,
unverifiable citations, unsourced claims, metric-less case studies,
age-inappropriate children's content, thin-sample cover winners,
thin-market arbitrage, small-sample market gates, weak-seller signals,
honest-PASS evidence requirements) is green — see the suite path above.
