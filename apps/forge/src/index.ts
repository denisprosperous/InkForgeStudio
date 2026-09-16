/**
 * @inkforge/forge — process bootstrap.
 *
 * Loads dotenv + validated config, serves the app, and shuts down gracefully.
 * The job worker loop is a separate module on purpose (see the Phase 2 plan):
 * it must be independently startable, disable-able and rollback-able.
 */
import { loadConfig, loadDotenv } from "@inkforge/config";
import { buildApp } from "./app";

async function main(): Promise<void> {
  await loadDotenv();
  const config = loadConfig();
  const app = buildApp({
    logLevel: config.logLevel,
    databaseUrl: config.databaseUrl,
    rateLimitPerMinute: config.limits.rateLimitPerMinute,
  });

  const server = app.listen(config.port, () => {
    console.info(
      `forge: listening on http://localhost:${config.port} (env: ${config.env.NODE_ENV})`,
    );
  });

  const shutdown = (signal: string): void => {
    console.info(`forge: ${signal} received, closing server`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("forge: failed to start", error);
  process.exit(1);
});
