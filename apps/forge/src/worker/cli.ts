/**
 * @inkforge/forge — worker daemon entry (G-04d, D15).
 *
 * Boots the same config as the HTTP tier, creates the pool, then runs the poll
 * loop until SIGTERM/SIGINT. Shutdown order matters: stop claiming new work,
 * let the in-flight tick drain, then close the pool — so a rolling deploy never
 * loses a job or leaves a connection behind. `EXIT_DEADLINE_MS` bounds the whole
 * drain, because a hung database is worse than a lost lease (`stop()` logs any
 * lease it could not hand back, and the lease expiry reclaims it).
 */
import { loadConfig, loadDotenv } from "@inkforge/config";
import { createDb } from "@inkforge/db";
import { createForgeWorker } from "./index";
import { resolveLlm } from "./llm";

const EXIT_DEADLINE_MS = 30_000;

async function main(): Promise<void> {
  await loadDotenv();
  const config = loadConfig();
  if (config.isProduction && config.forge.sharedSecret === undefined) {
    throw new Error("forge worker: FORGE_SHARED_SECRET is required when NODE_ENV=production");
  }
  const llm = resolveLlm(config, process.env.DEFAULT_AI_PROVIDER);
  const db = createDb(config.databaseUrl, { max: 5 });
  const logger = {
    info: (fields: Record<string, unknown>, message: string) =>
      console.info(JSON.stringify({ level: "info", message, ...fields })),
    warn: (fields: Record<string, unknown>, message: string) =>
      console.warn(JSON.stringify({ level: "warn", message, ...fields })),
    error: (fields: Record<string, unknown>, message: string) =>
      console.error(JSON.stringify({ level: "error", message, ...fields })),
  };

  const worker = createForgeWorker({
    db: db.db,
    logger,
    llm: llm?.client,
    workerId: process.env.WORKER_ID ?? `forge-${process.pid}`,
    pollIntervalMs: config.worker.pollIntervalMs,
  });
  worker.start();
  logger.info(
    { provider: llm?.provider ?? "local-planner", model: llm?.model ?? "deterministic" },
    "forge worker: started",
  );

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "forge worker: draining");
    const deadline = setTimeout(() => {
      logger.error({ signal }, "forge worker: drain deadline exceeded, forcing exit");
      void db.close().finally(() => process.exit(1));
    }, EXIT_DEADLINE_MS);
    deadline.unref();
    void worker
      .stop()
      .then(() => db.close())
      .then(() => {
        clearTimeout(deadline);
        logger.info({ signal }, "forge worker: stopped cleanly");
        process.exit(0);
      })
      .catch((error: unknown) => {
        clearTimeout(deadline);
        logger.error({ error: String(error) }, "forge worker: shutdown failed");
        process.exit(1);
      });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("forge worker: failed to start", error);
  process.exit(1);
});
