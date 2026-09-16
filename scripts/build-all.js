/**
 * Root build: every workspace in dependency order (Master Directive §4.1).
 * 1. tsc -b builds the solution graph (config → db → ai → core → covers → ui → forge).
 * 2. apps/web builds via @cloudflare/next-on-pages (Next.js standalone SSR build
 *    transformed to Cloudflare Workers output in .vercel/output/static).
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const root = new URL("..", import.meta.url).pathname;

function step(name, cmd, args) {
  process.stdout.write(`\n▶ ${name}\n`);
  const res = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: process.env, shell: false });
  if (res.status !== 0) {
    process.stderr.write(`✖ ${name} failed with code ${res.status ?? "signal"}\n`);
    process.exit(res.status ?? 1);
  }
  process.stdout.write(`✔ ${name}\n`);
}

step("typecheck (solution build: config → db → ai → core → covers → ui → forge)", "npx", [
  "tsc",
  "-b",
]);
step("typecheck web (noEmit)", "npx", ["tsc", "--noEmit", "-p", "apps/web"]);
step("build web (@cloudflare/next-on-pages)", "npm", ["run", "build", "-w", "@inkforge/web"]);

process.stdout.write("\n✔ build complete\n");
