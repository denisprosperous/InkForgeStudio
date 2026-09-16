/**
 * Root production start: forge HTTP + worker (node dist/index.js) and web (next start).
 * On Cloudflare Pages the web tier is served from the edge; this script is for
 * local production verification and self-hosted single-VM deployments.
 */
import { spawn } from "node:child_process";
import readline from "node:readline";
import process from "node:process";

const root = new URL("..", import.meta.url).pathname;

const tasks = [
  { label: "forge", cmd: "node", args: ["dist/index.js"], cwd: `${root}apps/forge` },
  { label: "web", cmd: "npm", args: ["run", "start", "-w", "@inkforge/web"], cwd: root },
];

const children = [];

for (const task of tasks) {
  const child = spawn(task.cmd, task.args, {
    cwd: task.cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const prefix = (line) => `\x1b[90m[${task.label}]\x1b[0m ${line}`;
  const pipe = (stream) => {
    if (!stream) return;
    readline.createInterface({ input: stream }).on("line", (line) => {
      process.stdout.write(prefix(line) + "\n");
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on("exit", (code) => process.stdout.write(prefix(`exited with code ${code}`) + "\n"));
  children.push(child);
}

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(0);
  }, 2000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
