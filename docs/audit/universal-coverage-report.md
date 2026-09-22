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
| academic-technical/full | PASS | E-3-academic-citation | packages/core/test/research-coverage.test.ts | — |
| academic-technical/none | REFUSED | E-3-academic-citation | packages/core/test/research-coverage.test.ts | no verifiable data — refusing rather than generating unsourced claims for this category |
| academic-technical/partial | PASS | E-3-academic-citation | packages/core/test/research-coverage.test.ts | — |
| childrens/full | PASS | E-5-childrens-reading-level | packages/core/test/research-coverage.test.ts | — |
| childrens/none | PASS | E-5-childrens-reading-level | packages/core/test/research-coverage.test.ts | — |
| childrens/partial | PASS | E-5-childrens-reading-level | packages/core/test/research-coverage.test.ts | — |
| fiction/full | PASS | E-1-fiction-structure | packages/core/test/research-coverage.test.ts | — |
| fiction/none | PASS | E-1-fiction-structure | packages/core/test/research-coverage.test.ts | — |
| fiction/partial | PASS | E-1-fiction-structure | packages/core/test/research-coverage.test.ts | — |
| international/full | PASS | E-6-international-market | packages/core/test/research-coverage.test.ts | — |
| international/partial | PASS | E-6-international-market | packages/core/test/research-coverage.test.ts | — |
| nonfiction/full | PASS | E-2-nonfiction-evidence | packages/core/test/research-coverage.test.ts | — |
| nonfiction/none | REFUSED | E-2-nonfiction-evidence | packages/core/test/research-coverage.test.ts | no verifiable data — refusing rather than generating unsourced claims for this category |
| nonfiction/partial | PASS | E-2-nonfiction-evidence | packages/core/test/research-coverage.test.ts | — |
| professional-b2b/full | PASS | E-4-professional-case-study | packages/core/test/research-coverage.test.ts | — |
| professional-b2b/none | REFUSED | E-4-professional-case-study | packages/core/test/research-coverage.test.ts | no verifiable data — refusing rather than generating unsourced claims for this category |
| professional-b2b/partial | PASS | E-4-professional-case-study | packages/core/test/research-coverage.test.ts | — |

## Summary

- Cells evaluated: 17 / 21
- PASS: 14   REFUSED (legit, reason cited): 3   GAP: 0

## Anti-fabrication

The eleven-case refusal suite (licensed domains, no-data categories,
unverifiable citations, unsourced claims, metric-less case studies,
age-inappropriate children's content, thin-sample cover winners,
thin-market arbitrage, small-sample market gates, weak-seller signals,
honest-PASS evidence requirements) is green — see the suite path above.
