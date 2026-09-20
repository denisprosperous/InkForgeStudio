import { defineWorkspace } from "vitest/config";
import path from "node:path";

const WEB_ROOT = path.resolve(__dirname, "apps/web");

/**
 * G-31 — coverage contract lives in the ROOT vitest.config.ts (coverage
 * options are resolved from the root when a workspace file is present; the
 * per-project blocks below are ignored by the coverage runner). The floor is
 * 80% statements/lines; surfaces excluded there are covered by other gates
 * (CI ops steps for scripts/seed/cli, route-graph + Playwright e2e for the
 * web page/layout shells) — server logic stays inside coverage on purpose.
 */
export default defineWorkspace([
  {
    resolve: {
      alias: [
        { find: /^@$/, replacement: WEB_ROOT + "/src" },
        { find: /^@\/(.*)$/, replacement: WEB_ROOT + "/src/$1" },
      ],
    },
    test: {
      name: "web",
      environment: "node",
      include: ["apps/web/test/**/*.test.ts"],
      // The route-module graph test transforms the whole studio page tree; 5s
      // is not enough when the full workspace suite runs in parallel.
      testTimeout: 30_000,
    },
  },
  {
    test: {
      name: "config",
      environment: "node",
      include: ["packages/config/test/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "db",
      environment: "node",
      include: ["packages/db/test/**/*.test.ts"],
      // Migration integration suites create + migrate a throwaway Postgres
      // database; 5s is not enough under parallel load.
      testTimeout: 30_000,
    },
  },
  {
    test: {
      name: "ai",
      environment: "node",
      include: ["packages/ai/test/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "core",
      environment: "node",
      include: ["packages/core/test/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "covers",
      environment: "node",
      include: ["packages/covers/test/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "ui",
      environment: "node",
      include: ["packages/ui/test/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "forge",
      environment: "node",
      include: ["apps/forge/test/**/*.test.ts"],
      testTimeout: 20_000,
    },
  },
]);
