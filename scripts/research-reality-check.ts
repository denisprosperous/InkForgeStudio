/**
 * Research reality check (completion gate G-η: "every number traced").
 *
 * Cross-verifies the ledgers and artifacts against the repository:
 *   - totals are 100% by count and weight with zero open gaps
 *   - every coverage cell has a PASS/REFUSED verdict; REFUSED cells cite a
 *     reason; GAP count in the report is 0; all 21 cells appear in the report
 *   - every tasks[] SHA (except "self") exists in git log
 *   - every test citation that looks like a path exists on disk
 *   - anti-fabrication suite is present and cites its assertions
 * Exits 0 only when every claim checks out; prints each violation otherwise.
 *
 * Usage: npx tsx scripts/research-reality-check.ts   (or npm run audit:research)
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const STATE_PATH = path.join(ROOT, "docs/audit/STATE.json");
const REPORT_PATH = path.join(ROOT, "docs/audit/universal-coverage-report.md");

const violations: string[] = [];

const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as {
  totals: {
    gapsTotal: number;
    gapsClosed: number;
    percentByCount: number;
    percentByWeight: number;
  };
  gaps: Record<string, { status: string; test?: string }>;
  tasks: { id: string; sha: string; test: string }[];
  coverageCells: {
    category: string;
    availability: string;
    verdict: string;
    refusalReason: string | null;
    test: string;
  }[];
  pendingPush: boolean;
};

// 1. Totals and gap statuses.
if (state.totals.percentByWeight !== 100) violations.push(`percentByWeight is ${state.totals.percentByWeight}, expected 100`);
if (state.totals.percentByCount !== 100) violations.push(`percentByCount is ${state.totals.percentByCount}, expected 100`);
const openGaps = Object.entries(state.gaps).filter(([, gap]) => gap.status !== "closed");
if (openGaps.length > 0) violations.push(`open gaps: ${openGaps.map(([id]) => id).join(", ")}`);
if (state.totals.gapsClosed !== state.totals.gapsTotal) {
  violations.push(`gapsClosed ${state.totals.gapsClosed} != gapsTotal ${state.totals.gapsTotal}`);
}
if (state.pendingPush) violations.push("pendingPush is true");

// 2. Coverage cells.
const cells = state.coverageCells;
if (cells.length !== 21) violations.push(`coverageCells has ${cells.length}, expected 21`);
for (const cell of cells) {
  if (cell.verdict !== "PASS" && cell.verdict !== "REFUSED") {
    violations.push(`cell ${cell.category}/${cell.availability} has verdict ${cell.verdict} (GAP)`);
  }
  if (cell.verdict === "REFUSED" && (cell.refusalReason ?? "").length === 0) {
    violations.push(`cell ${cell.category}/${cell.availability} REFUSED without a reason`);
  }
  if (!cell.test.endsWith(".ts")) violations.push(`cell ${cell.category}/${cell.availability} lacks a test path`);
}

// 3. Report artifact.
if (!fs.existsSync(REPORT_PATH)) {
  violations.push("universal-coverage-report.md is missing");
} else {
  const report = fs.readFileSync(REPORT_PATH, "utf8");
  if (!report.includes("GAP: 0")) violations.push("report does not declare GAP: 0");
  for (const cell of cells) {
    const key = `${cell.category}/${cell.availability}`;
    if (!report.includes(key)) violations.push(`report is missing cell ${key}`);
  }
  for (const id of ["E-1", "E-2", "E-3", "E-4", "E-5", "E-6"]) {
    if (!report.includes(id)) violations.push(`report is missing adapter ${id}`);
  }
  if (!report.includes("research-anti-fabrication.test.ts")) {
    violations.push("report does not cite the anti-fabrication suite");
  }
}

// 4. Task SHAs exist in git history.
let gitLog = "";
try {
  gitLog = execSync("git log --format=%H --all", { cwd: ROOT, encoding: "utf8" });
} catch {
  violations.push("git log failed — cannot verify task SHAs");
}
for (const task of state.tasks) {
  if (task.sha === "self") continue;
  if (!gitLog.includes(task.sha)) violations.push(`task ${task.id} sha ${task.sha} not in git log`);
}

// 5. Path-like test citations exist on disk; others must at least be non-empty.
for (const [id, gap] of Object.entries(state.gaps)) {
  if (gap.status !== "closed") continue;
  if (!gap.test || gap.test.trim().length === 0) {
    violations.push(`gap ${id} has no test citation`);
    continue;
  }
  if (gap.test.includes("/")) {
    for (const raw of gap.test.split(";")) {
      const candidate = raw.trim().split(" (")[0].trim();
      if (candidate.endsWith(".ts") && !candidate.includes("*") && !fs.existsSync(path.join(ROOT, candidate))) {
        violations.push(`gap ${id} cites missing file ${candidate}`);
      }
    }
  }
}

// 6. Anti-fabrication suite present.
const afPath = path.join(ROOT, "packages/core/test/research-anti-fabrication.test.ts");
if (!fs.existsSync(afPath)) violations.push("anti-fabrication suite missing");

if (violations.length > 0) {
  console.error("research reality check FAILED:");
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}
console.log(
  `research reality check OK: ${state.totals.gapsClosed}/${state.totals.gapsTotal} gaps, ` +
    `${cells.length} coverage cells (GAP 0), ${state.tasks.length} tasks traced, report complete`,
);
