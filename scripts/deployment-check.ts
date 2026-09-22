/**
 * Deployment readiness check (completion gate G-iota).
 *
 * Six checklist items, each mechanically verified against the repository or
 * the working tree. Exits 0 only when all six pass — this is the deployment
 * gate the completion criteria reference.
 *
 * Usage: npx tsx scripts/deployment-check.ts   (or npm run audit:deploy)
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const results: { id: string; label: string; ok: boolean; detail: string }[] = [];

function check(id: string, label: string, fn: () => string) {
  try {
    results.push({ id, label, ok: true, detail: fn() });
  } catch (error) {
    results.push({ id, label, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

// 1. Clean install produces the toolchain.
check("D1", "clean install / toolchain", () => {
  const tsc = path.join(ROOT, "node_modules/.bin/tsc");
  if (!fs.existsSync(tsc)) throw new Error("node_modules/.bin/tsc missing — run npm ci");
  if (!fs.existsSync(path.join(ROOT, "package-lock.json"))) throw new Error("package-lock.json missing");
  return "tsc present, lockfile present";
});

// 2. Database migrations deployable.
check("D2", "database migrations deployable", () => {
  const journal = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/db/drizzle/meta/_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  if (journal.entries.length < 1) throw new Error("migration journal empty");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  if (!pkg.scripts["db:migrate"]) throw new Error("db:migrate script missing");
  if (!pkg.scripts["db:generate"]) throw new Error("db:generate script missing");
  return `${journal.entries.length} migrations, migrate+generate scripts present`;
});

// 3. Build artifacts.
check("D3", "build artifacts present", () => {
  const forge = path.join(ROOT, "apps/forge/dist/index.js");
  const web = path.join(ROOT, "apps/web/.next/BUILD_ID");
  if (!fs.existsSync(forge)) throw new Error("apps/forge/dist/index.js missing — run npm run build");
  if (!fs.existsSync(web)) throw new Error("apps/web/.next/BUILD_ID missing — run npm run build");
  return "forge dist + web .next present";
});

// 4. Health probes.
check("D4", "health probes defined", () => {
  const app = fs.readFileSync(path.join(ROOT, "apps/forge/src/app.ts"), "utf8");
  if (!app.includes('"/healthz"')) throw new Error("/healthz missing");
  if (!app.includes('"/readyz"')) throw new Error("/readyz missing");
  return "/healthz and /readyz declared";
});

// 5. Compose stack valid.
check("D5", "compose stack valid", () => {
  const out = execSync(
    "docker compose -f docker/docker-compose.yml config -q",
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return out.length === 0 ? "docker compose config -q exit 0" : "compose config ok";
});

// 6. CI gates + environment template.
check("D6", "CI gates + env template", () => {
  const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  for (const gate of ["npm run lint", "npm run typecheck", "npm test", "npm run build", "playwright"]) {
    if (!ci.includes(gate)) throw new Error(`ci.yml missing gate: ${gate}`);
  }
  const env = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  for (const key of ["DATABASE_URL", "FORGE_SHARED_SECRET", "FORGE_PRINCIPAL"]) {
    if (!env.includes(key)) throw new Error(`.env.example missing ${key}`);
  }
  return "5 CI gates + 3 env keys present";
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "✔" : "✘"} ${r.id} ${r.label}: ${r.detail}`);
}
if (failed.length > 0) {
  console.error(`deployment check FAILED: ${failed.length}/6`);
  process.exit(1);
}
console.log("deployment check OK: 6/6 items ready (gate G-iota)");
