import { defineConfig, devices } from "@playwright/test";

const externalBase = process.env.E2E_BASE_URL;
/** G-28: the web port is parameterized; CI pins it via WEB_PORT (3100). */
const port = Number.parseInt(process.env.WEB_PORT ?? "3000", 10);
/** Local defaults mirror docker/ compose + .env.example so the smoke hits the
 * green path even on a cold checkout; CI exports the real values. */
const bridgeDefaults = {
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://inkforge:inkforge@localhost:5432/inkforge",
  FORGE_SHARED_SECRET: process.env.FORGE_SHARED_SECRET ?? "dev-bridge-secret",
  FORGE_PRINCIPAL: process.env.FORGE_PRINCIPAL ?? "preview-user",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: externalBase ?? `http://localhost:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: externalBase
    ? undefined
    : [
        {
          command: `npm run dev -w @inkforge/web -- -p ${port}`,
          url: `http://localhost:${port}`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: bridgeDefaults,
        },
        {
          // Forge sidecar: the studio pill and the bridge calls need a live
          // forge; healthz answers without touching the database.
          command: "npx tsx apps/forge/src/index.ts",
          url: "http://localhost:4000/healthz",
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          env: bridgeDefaults,
        },
      ],
});

