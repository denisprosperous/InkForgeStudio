/**
 * @inkforge/forge — process bootstrap.
 *
 * Loads dotenv + validated config, serves the app, optionally starts the job
 * worker loop, and shuts down gracefully: on SIGTERM the HTTP listener stops
 * accepting, in-flight jobs drain, the pool closes, then the process exits 0.
 * The worker loop is a separate module on purpose (see the Phase 2 plan): it
 * must be independently startable, disable-able and rollback-able.
 */
import { loadConfig, loadDotenv } from "@inkforge/config";
import { createDb } from "@inkforge/db";
import { buildApp } from "./app";
import { createForgeWorker, type Worker } from "./worker/index";

const SHUTDOWN_DEADLINE_MS = 30_000;

/** Minimal pino-compatible logger; the app supplies one via buildApp. */
function bootstrapLogger(level: string) {
  return {
    info: (payload: Record<string, unknown>, message?: string) =>
      console.info(JSON.stringify({ level, ...payload }), message ?? ""),
    warn: (payload: Record<string, unknown>, message?: string) =>
      console.warn(JSON.stringify({ level, ...payload }), message ?? ""),
    error: (payload: Record<string, unknown>, message?: string) =>
      console.error(JSON.stringify({ level, ...payload }), message ?? ""),
  };
}

async function main(): Promise<void> {
  await loadDotenv();
  const config = loadConfig();
  // E2: the bridge secret is mandatory in production — fail fast, loudly,
  // rather than booting an unauthenticated worker tier.
  if (config.isProduction && config.forge.sharedSecret === undefined) {
    throw new Error("forge: FORGE_SHARED_SECRET is required when NODE_ENV=production");
  }
  const app = buildApp({
    logLevel: config.logLevel,
    databaseUrl: config.databaseUrl,
    rateLimitPerMinute: config.limits.rateLimitPerMinute,
    sharedSecret: config.forge.sharedSecret,
    maxConcurrentJobsPerUser: config.limits.maxConcurrentJobsPerUser,
  });

  const server = app.listen(config.port, () => {
    console.info(
      `forge: listening on http://localhost:${config.port} (env: ${config.env.NODE_ENV})`,
    );
  });

  // Worker loop: same process by default (worker.enabled), disable-able with
  // WORKER_ENABLED=false to run the API tier and the worker tier separately.
  let worker: Worker | undefined;
  let pool: { close: () => Promise<void> } | undefined;
  if (config.worker.enabled) {
    const handle = createDb(config.databaseUrl, { max: 5 });
    pool = handle;
    worker = createForgeWorker({
      db: handle.db,
      logger: bootstrapLogger("info"),
      pollIntervalMs: config.worker.pollIntervalMs,
      batchSize: config.worker.batchSize,
      leaseMs: config.worker.leaseMs,
      retentionIntervalMs: config.worker.retentionIntervalMs,
      retryBackoffMs: config.worker.retryBackoffMs,
    });
    worker.start();
  }

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`forge: ${signal} received, draining`);
    // Hard deadline: never hang forever on a stuck handler.
    const deadline = setTimeout(() => {
      console.error("forge: shutdown deadline exceeded, exiting non-zero");
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS);
    deadline.unref();

    server.close(() => {
      void (async () => {
        try {
          await worker?.stop();
          await pool?.close();
          clearTimeout(deadline);
          console.info("forge: drained, exiting 0");
          process.exit(0);
        } catch (error) {
          console.error("forge: shutdown failed", error);
          process.exit(1);
        }
      })();
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("forge: failed to start", error);
  process.exit(1);
});
