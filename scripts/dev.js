/**
 * Root dev orchestrator: runs forge (tsx watch) and web (next dev) concurrently
 * with prefixed output. One process per workspace, no extra dependencies.
 */
import { spawn } from "node:child_process";
import readline from "node:readline";

const tasks = [
  { label: "forge", cmd: "npm", args: ["run", "dev", "-w", "@inkforge/forge"] },
  { label: "web", cmd: "npm", args: ["run", "dev", "-w", "@inkforge/web"] },
];

const children = [];

function run(task) {
  const child = spawn(task.cmd, task.args, {
    cwd: new URL("..", import.meta.url).pathname,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const prefix = (line) => `\x1b[90m[${task.label}]\x1b[0m ${line}`;
  const pipe = (stream, isError) => {
    if (!stream) return;
    readline.createInterface({ input: stream }).on("line", (line) => {
      const prefixed = prefix(line);
      if (isError) {
        process.stderr.write(prefixed + "\n");
      } else {
        process.stdout.write(prefixed + "\n");
      }
    });
  };
  pipe(child.stdout, false);
  pipe(child.stderr, true);
  child.on("exit", (code) => {
    process.stdout.write(prefix(`exited with code ${code}`) + "\n");
  });
  children.push(child);
  return child;
}

for (const task of tasks) {
  run(task);
}

function shutdown() {
  for (const child of children) {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    for (const child of children) {
      child.kill("SIGKILL");
    }
    process.exit(0);
  }, 2000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
