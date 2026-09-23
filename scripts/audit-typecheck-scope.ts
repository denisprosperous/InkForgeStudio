/**
 * audit:typecheck-scope — prove `npm run typecheck` still type-checks TEST files.
 *
 * NEG-Ω.REPAIR regression guard (G-TYPECHECK-SCOPE): the incident behind this
 * script was a green `npm run typecheck` that never saw a broken test file,
 * because the solution graph only references src projects. For every
 * workspace test directory this script asserts two things:
 *
 *   1. the `typecheck` script in package.json invokes the tsc project whose
 *      include covers that workspace's tests;
 *   2. `tsc --listFilesOnly` for that project literally lists a sentinel file
 *      under the workspace's test dir.
 *
 * Run bare in CI right after `npm run typecheck`; exits non-zero on any drift
 * (script narrowed, config include changed, sentinel moved or deleted).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

interface Sentinel {
  readonly workspace: string;
  readonly sentinel: string;
  readonly project: string;
}

const SENTINELS: readonly Sentinel[] = [
  { workspace: "apps/web", sentinel: "apps/web/test/smoke.test.ts", project: "apps/web" },
  {
    workspace: "apps/forge",
    sentinel: "apps/forge/test/worker.test.ts",
    project: "apps/forge/tsconfig.tests.json",
  },
  {
    workspace: "packages/config",
    sentinel: "packages/config/test/config.test.ts",
    project: "tsconfig.tests-root.json",
  },
  {
    workspace: "packages/db",
    sentinel: "packages/db/test/migrations.test.ts",
    project: "tsconfig.tests-root.json",
  },
  {
    workspace: "packages/ai",
    sentinel: "packages/ai/test/selection.test.ts",
    project: "tsconfig.tests-root.json",
  },
  {
    workspace: "packages/core",
    sentinel: "packages/core/test/book.test.ts",
    project: "tsconfig.tests-root.json",
  },
  {
    workspace: "packages/covers",
    sentinel: "packages/covers/test/spec.test.ts",
    project: "tsconfig.tests-root.json",
  },
  {
    workspace: "packages/ui",
    sentinel: "packages/ui/test/studio.test.ts",
    project: "tsconfig.tests-root.json",
  },
];

const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const typecheck = pkg.scripts.typecheck ?? "";

/** project → absolute file paths from `tsc --listFilesOnly` (cached per run). */
const listed = new Map<string, Set<string>>();

function listFiles(project: string): Set<string> {
  const cached = listed.get(project);
  if (cached) return cached;
  const out = execFileSync(
    "npx",
    ["tsc", "--noEmit", "--listFilesOnly", "-p", path.join(ROOT, project)],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const files = new Set(
    out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  listed.set(project, files);
  return files;
}

let failures = 0;
for (const s of SENTINELS) {
  const abs = path.join(ROOT, s.sentinel);
  const problems: string[] = [];
  if (!existsSync(abs)) problems.push(`sentinel missing: ${s.sentinel}`);
  if (!typecheck.includes(`-p ${s.project}`)) {
    problems.push(`typecheck script does not invoke \`-p ${s.project}\``);
  }
  if (problems.length === 0) {
    if (!listFiles(s.project).has(abs)) {
      problems.push(`tsc -p ${s.project} does not list ${s.sentinel}`);
    }
  }
  if (problems.length > 0) {
    failures += 1;
    console.error(`typecheck-scope FAIL  ${s.workspace}: ${problems.join("; ")}`);
  } else {
    console.log(`typecheck-scope OK    ${s.workspace} -> ${s.sentinel} (-p ${s.project})`);
  }
}

if (failures === 0) {
  console.log(
    `audit:typecheck-scope — clean: ${SENTINELS.length} workspace test sentinels covered by npm run typecheck.`,
  );
} else {
  console.error(`audit:typecheck-scope — ${failures}/${SENTINELS.length} sentinels NOT covered.`);
}
process.exit(failures === 0 ? 0 : 1);
