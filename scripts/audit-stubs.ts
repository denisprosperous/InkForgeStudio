/**
 * audit:stubs — find unfinished work before it ships.
 *
 * Scans every workspace for (a) missing build/entry/test structure and (b)
 * in-source stub markers (TODO/FIXME/XXX/HACK/"not implemented"). Run bare
 * (report only, always exit 0 — safe as the pre-commit gate) or with --strict
 * to fail when anything is missing or marked.
 *
 * Part of the NEGENTROPY-1 audit loop: re-run quarterly, promote to --strict
 * per-workspace as the gap register closes.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const STRICT = process.argv.includes("--strict");

interface WorkspaceChecks {
  readonly name: string;
  readonly pkgJson: boolean;
  readonly buildConfig: boolean;
  readonly entry: boolean;
  readonly testFiles: number;
  readonly markers: number;
}

const WORKSPACES: readonly { name: string; entry: string[]; build: string[] }[] = [
  { name: "apps/forge", entry: ["src/index.ts"], build: ["tsconfig.json"] },
  { name: "apps/web", entry: ["src/app/layout.tsx"], build: ["tsconfig.json", "next.config.mjs"] },
  {
    name: "packages/config",
    entry: ["src/index.ts"],
    build: ["tsconfig.json"],
  },
  { name: "packages/db", entry: ["src/index.ts"], build: ["tsconfig.json"] },
  { name: "packages/ai", entry: ["src/index.ts"], build: ["tsconfig.json"] },
  { name: "packages/core", entry: ["src/index.ts"], build: ["tsconfig.json"] },
  { name: "packages/covers", entry: ["src/index.ts"], build: ["tsconfig.json"] },
  { name: "packages/ui", entry: ["src/index.ts"], build: ["tsconfig.json"] },
];

const MARKERS = /\b(TODO|FIXME|XXX|HACK)\b|not implemented|unimplemented/i;

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === ".next") continue;
      listSourceFiles(full, acc);
    } else if (/\.(ts|tsx|mjs)$/u.test(name) && !name.endsWith(".d.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

function countMarkers(files: readonly string[]): number {
  let count = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      if (MARKERS.test(line)) count += 1;
    }
  }
  return count;
}

function auditWorkspace(workspace: {
  name: string;
  entry: string[];
  build: string[];
}): WorkspaceChecks {
  const dir = path.join(ROOT, workspace.name);
  const files = listSourceFiles(dir);
  const tests = files.filter((file) => /\/test\/.*(test|spec)\.(ts|tsx)$/u.test(file));
  return {
    name: workspace.name,
    pkgJson: existsSync(path.join(dir, "package.json")),
    buildConfig: workspace.build.some((file) => existsSync(path.join(dir, file))),
    entry: workspace.entry.some((file) => existsSync(path.join(dir, file))),
    testFiles: tests.length,
    markers: countMarkers(files),
  };
}

const results = WORKSPACES.map(auditWorkspace);
const problems: string[] = [];

console.info("audit:stubs — workspace completeness scan");
console.info("");
console.info("workspace            pkg  build  entry  tests  markers");
for (const row of results) {
  const flags = [
    row.pkgJson ? "ok" : "MISSING",
    row.buildConfig ? "ok" : "MISSING",
    row.entry ? "ok" : "MISSING",
    String(row.testFiles),
    String(row.markers),
  ];
  console.info(
    `${row.name.padEnd(20)} ${flags.join("  ").padEnd(34)} ${row.markers > 0 ? `⚠ ${row.markers} stub marker(s)` : ""}`,
  );
  if (!row.pkgJson) problems.push(`${row.name}: package.json missing`);
  if (!row.buildConfig) problems.push(`${row.name}: build config missing`);
  if (!row.entry) problems.push(`${row.name}: source entry missing`);
  if (row.testFiles === 0) problems.push(`${row.name}: no test files`);
  if (row.markers > 0) problems.push(`${row.name}: ${row.markers} stub marker(s) in source`);
}

console.info("");
if (problems.length === 0) {
  console.info("audit:stubs — clean: all workspaces have structure and no stub markers.");
} else {
  console.warn(`audit:stubs — ${problems.length} finding(s):`);
  for (const problem of problems) console.warn(`  - ${problem}`);
  console.info("tip: rerun with --strict to fail on findings.");
}

if (STRICT && problems.length > 0) {
  console.error("audit:stubs --strict: failing due to findings above.");
  process.exit(1);
}
process.exit(0);
