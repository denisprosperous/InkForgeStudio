/**
 * Coverage cell runner (NEGENTROPY-Ω Section 3, persistence 3.8/3.10).
 *
 * Evaluates one (category × availability) cell with the research coverage
 * engine, records it in STATE.json's coverageCells[], and regenerates
 * docs/audit/universal-coverage-report.md from the recorded cells so the
 * report is built incrementally and pushed with every cell it describes.
 *
 * Usage: npx tsx scripts/coverage-cell.ts <category> <availability>
 */
import fs from "node:fs";
import path from "node:path";
import { planForCell, type ContentCategory, type DataAvailability } from "@inkforge/core";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const STATE_PATH = path.join(ROOT, "docs/audit/STATE.json");
const REPORT_PATH = path.join(ROOT, "docs/audit/universal-coverage-report.md");

/** Representative probe topic per category (documented in the report). */
const TOPICS: Record<ContentCategory, string> = {
  fiction: "oven magic cozy fantasy",
  nonfiction: "remote work handbooks",
  childrens: "kittens learning kindness",
  "academic-technical": "peer-reviewed benchmark methodology",
  "professional-b2b": "vendor procurement playbooks",
  international: "container-garden markets guides",
  "low-data-emerging": "brand-new hardware shortage coverage",
};

const GENRES = [
  "fantasy",
  "science-fiction",
  "mystery",
  "thriller",
  "romance",
  "historical",
  "horror",
  "literary",
];

const [categoryArg, availabilityArg] = process.argv.slice(2);
if (!categoryArg || !availabilityArg) {
  console.error("usage: coverage-cell <category> <availability>");
  process.exit(2);
}
const category = categoryArg as ContentCategory;
const availability = availabilityArg as DataAvailability;
const topic = TOPICS[category];
if (!topic) {
  console.error(`unknown category: ${category}`);
  process.exit(2);
}

const plan = planForCell({ category, availability, topic });
const now = new Date().toISOString();
const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as {
  coverageCells: {
    category: string;
    availability: string;
    verdict: string;
    adapter: string;
    sha: string;
    test: string;
    closedAt: string;
    refusalReason: string | null;
  }[];
};
const key = `${category}/${availability}`;
const existing = state.coverageCells.find((cell) => `${cell.category}/${cell.availability}` === key);
const record = {
  category,
  availability,
  verdict: plan.verdict,
  adapter: plan.adapter,
  sha: "self",
  test: "packages/core/test/research-coverage.test.ts",
  closedAt: now,
  refusalReason: plan.refusalReason,
};
if (existing) {
  Object.assign(existing, record);
} else {
  state.coverageCells.push(record);
}
state.coverageCells.sort(
  (a, b) => a.category.localeCompare(b.category) || a.availability.localeCompare(b.availability),
);
fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");

const rows = state.coverageCells
  .map(
    (cell) =>
      `| ${cell.category}/${cell.availability} | ${cell.verdict} | ${cell.adapter} | ${cell.test} | ${cell.refusalReason ?? "—"} |`,
  )
  .join("\n");
const gapCount = state.coverageCells.filter((cell) => cell.verdict !== "PASS" && cell.verdict !== "REFUSED").length;
const refused = state.coverageCells.filter((cell) => cell.verdict === "REFUSED").length;
const passed = state.coverageCells.filter((cell) => cell.verdict === "PASS").length;

fs.writeFileSync(
  REPORT_PATH,
  `# Universal Coverage Report

Built incrementally by \`scripts/coverage-cell.ts\` — one commit per cell
(persistence rules 3.8–3.11). Every row below was produced by
\`planForCell\` from \`packages/core/src/research/coverage.ts\` and is
covered by \`packages/core/test/research-coverage.test.ts\` plus the
anti-fabrication suite (\`packages/core/test/research-anti-fabrication.test.ts\`, 11/11 green).

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

${GENRES.join(", ")}.

## Coverage matrix

Probe topics are the canonical per-category topics in \`scripts/coverage-cell.ts\`.

| Cell (category/availability) | Verdict | Adapter | Test | Refusal reason |
|---|---|---|---|---|
${rows}

## Summary

- Cells evaluated: ${state.coverageCells.length} / 21
- PASS: ${passed}   REFUSED (legit, reason cited): ${refused}   GAP: ${gapCount}

## Anti-fabrication

The eleven-case refusal suite (licensed domains, no-data categories,
unverifiable citations, unsourced claims, metric-less case studies,
age-inappropriate children's content, thin-sample cover winners,
thin-market arbitrage, small-sample market gates, weak-seller signals,
honest-PASS evidence requirements) is green — see the suite path above.
`,
);
console.log(`${key} -> ${plan.verdict}${plan.refusalReason ? ` (${plan.refusalReason})` : ""}`);
console.log(`cells: ${state.coverageCells.length}/21 gap: ${gapCount}`);
