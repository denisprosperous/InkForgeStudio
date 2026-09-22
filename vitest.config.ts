/**
 * Root vitest config — carries the G-31 coverage contract for the whole
 * workspace (coverage options are resolved from the root when a workspace
 * file is present; per-project coverage blocks are ignored).
 *
 * Enforced floor: 80% statements/lines (NEGENTROPY V6). Surfaces excluded
 * below are covered by OTHER gates, not silently dropped:
 *  - scripts/**, db/seed.ts, forge worker cli.ts: ops tooling whose execution
 *    IS the test (audit:stubs / audit:dod / bench:forge / db:seed CI steps).
 *  - *.config.ts: configuration, not executable product code.
 *  - apps/web page/layout components: rendered behavior is covered by the
 *    route-graph unit test (apps/web/test) and Playwright e2e (V7); server
 *    logic (actions.ts, route.ts, lib/) stays INSIDE coverage on purpose.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      // Workspace projects share one reports dir; per-project clean races the
      // v8 tmp writer (ENOENT on coverage/.tmp/*.json seen in V6) — clean at
      // the OS level between full runs instead.
      clean: false,
      exclude: [
        "scripts/**",
        "packages/db/seed.ts",
        "packages/db/drizzle.config.ts",
        "apps/forge/src/worker/cli.ts",
        "playwright.config.ts",
        "apps/web/src/app/**/page.tsx",
        "apps/web/src/app/layout.tsx",
        "**/*.d.ts",
      ],
      thresholds: {
        statements: 80,
        lines: 80,
      },
    },
  },
});
