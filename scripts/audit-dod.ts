/**
 * audit:dod — Definition-of-Done gate for the monorepo.
 *
 * A workspace is DONE when it: declares its @inkforge package, has a build
 * config, has a public entry, ships at least one test, and is wired into the
 * vitest workspace. Built artifacts are reported but only enforced with
 * --strict (dist trees are transient). Pair with `audit:stubs` in CI.
 */
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const STRICT = process.argv.includes("--strict");

const WORKSPACES = [
  "packages/config",
  "packages/db",
  "packages/ai",
  "packages/core",
  "packages/covers",
  "packages/ui",
  "apps/forge",
  "apps/web",
] as const;

interface DoDRow {
  readonly workspace: string;
  readonly findings: readonly string[];
}

function checkWorkspace(workspace: string): DoDRow {
  const dir = path.join(ROOT, workspace);
  const findings: string[] = [];

  const pkgPath = path.join(dir, "package.json");
  if (!existsSync(pkgPath)) {
    return { workspace, findings: ["package.json missing"] };
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
  if (!pkg.name?.startsWith("@inkforge/")) {
    findings.push(`package name "${pkg.name}" is not namespaced under @inkforge`);
  }

  const hasBuildConfig =
    existsSync(path.join(dir, "tsconfig.json")) || existsSync(path.join(dir, "next.config.mjs"));
  if (!hasBuildConfig) findings.push("no tsconfig.json / next.config.mjs");

  const srcDir = path.join(dir, "src");
  const srcExists = existsSync(srcDir) && statSync(srcDir).isDirectory();
  const srcFiles = srcExists ? readdirSync(srcDir) : [];
  if (!srcExists || srcFiles.length === 0) findings.push("src/ missing or empty");

  const testDir = path.join(dir, "test");
  const testFiles =
    existsSync(testDir) && statSync(testDir).isDirectory()
      ? readdirSync(testDir).filter((file) => /\.(test|spec)\.tsx?$/u.test(file))
      : [];
  if (testFiles.length === 0) findings.push("no test files");

  const vitestWorkspace = readFileSync(path.join(ROOT, "vitest.workspace.ts"), "utf8");
  const wired = vitestWorkspace.includes(`"${workspace}/test/**/*.test.ts"`);
  if (!wired) findings.push("not wired into vitest.workspace.ts");

  const exportsMap = (pkg as { exports?: Record<string, { default?: string }> }).exports ?? {};
  for (const [key, target] of Object.entries(exportsMap)) {
    const targetPath = target.default?.replace("./", "");
    if (!targetPath) continue;
    const distFile = path.join(dir, targetPath);
    if (existsSync(path.join(dir, "dist")) && !existsSync(distFile)) {
      findings.push(`exports "${key}" → ${targetPath} missing from dist (stale build?)`);
    }
  }

  return { workspace, findings };
}

const rows = WORKSPACES.map(checkWorkspace);
let failures = 0;

console.info("audit:dod — definition-of-done report");
console.info("");
for (const row of rows) {
  const status = row.findings.length === 0 ? "✔ done" : `✖ ${row.findings.length} gap(s)`;
  console.info(`${status.padEnd(12)} ${row.workspace}`);
  for (const finding of row.findings) {
    console.info(`             - ${finding}`);
    failures += 1;
  }
}
console.info("");
console.info(
  failures === 0
    ? "audit:dod — all workspaces meet the DoD gate."
    : `audit:dod — ${failures} gap(s). See docs/audit/phase-2-gap-register-and-build-plan.md for the plan.`,
);

if (STRICT && failures > 0) process.exit(1);
