/**
 * @inkforge/forge — worker wiring (G-04d).
 *
 * `createForgeWorker` is the single place the job-type → handler table is
 * assembled, so tests can inject fakes and deployment can swap the LLM resolver
 * without touching the loop. Every job type is registered: types whose provider
 * is not configured get an `unavailableHandler`, which fails loudly instead of
 * silently stranding queued work.
 */
import type { LlmClient } from "@inkforge/ai";
import { JOB_TYPES, type Database, type JobType } from "@inkforge/db";
import { createChapterHandler } from "./handlers/chapter";
import { createExportHandler } from "./handlers/export";
import { createOutlineHandler } from "./handlers/outline";
import { createWorker, type Worker } from "./loop";
import {
  createHandlerRegistry,
  unavailableHandler,
  type JobHandler,
  type WorkerLogger,
} from "./registry";

export { createWorker, type Worker } from "./loop";
export type { WorkerOptions } from "./loop";
export {
  createHandlerRegistry,
  HandlerError,
  silentLogger,
  unavailableHandler,
  type JobContext,
  type JobHandler,
  type JobHandlerRegistry,
  type WorkerLogger,
} from "./registry";
export { createOutlineHandler, planOutline, outlineRequestFromJob } from "./handlers/outline";
export { createChapterHandler } from "./handlers/chapter";
export { createExportHandler } from "./handlers/export";

export interface ForgeWorkerOptions {
  readonly db: Database;
  readonly logger: WorkerLogger;
  /** Resolved LLM client, or undefined to run fully deterministic. */
  readonly llm?: LlmClient | undefined;
  /** G-06 disclosure toggle for exports; ON by default (KDP target). */
  readonly disclosure?: boolean | undefined;
  readonly workerId?: string;
  readonly pollIntervalMs?: number;
  readonly batchSize?: number;
  readonly leaseMs?: number;
  readonly retentionIntervalMs?: number;
  readonly retryBackoffMs?: number;
  readonly now?: () => Date;
  /** Extra handlers for tests or future job types. */
  readonly overrides?: Partial<Record<JobType, JobHandler>>;
}

/**
 * Job types with no executor yet. Registering an explicit `unavailableHandler`
 * is deliberate: the job fails immediately with a readable reason instead of
 * sitting `queued` forever. It is also greppable — `audit:stubs` and the gap
 * register both track this table, so "not yet registered" cannot quietly
 * become "shipped".
 */
const PENDING_HANDLERS: Partial<Record<JobType, string>> = {
  "chapter.humanize": "chapter.humanize handler not yet registered",
  "cover.generate": "cover.generate handler not yet registered",
};

/** Build the registry for a worker, honouring `overrides` last. */
export function createForgeHandlers(options: ForgeWorkerOptions) {
  const registry = createHandlerRegistry();
  const outline = createOutlineHandler({ llm: options.llm });
  const chapter = createChapterHandler({ llm: options.llm });
  const bookExport = createExportHandler({ disclosure: options.disclosure });
  registry.register("outline.generate", outline);
  registry.register("chapter.generate", chapter);
  registry.register("book.export", bookExport);
  for (const type of JOB_TYPES) {
    const pending = PENDING_HANDLERS[type];
    if (pending !== undefined) registry.register(type, unavailableHandler(pending));
  }
  for (const [type, handler] of Object.entries(options.overrides ?? {})) {
    if (handler) registry.register(type as JobType, handler);
  }
  return registry;
}

/** Assemble a fully wired worker over the shared Postgres queue. */
export function createForgeWorker(options: ForgeWorkerOptions): Worker {
  return createWorker({
    db: options.db,
    logger: options.logger,
    handlers: createForgeHandlers(options),
    workerId: options.workerId ?? `forge-${process.pid}`,
    ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
    ...(options.batchSize !== undefined ? { batchSize: options.batchSize } : {}),
    ...(options.leaseMs !== undefined ? { leaseMs: options.leaseMs } : {}),
    ...(options.retentionIntervalMs !== undefined
      ? { retentionIntervalMs: options.retentionIntervalMs }
      : {}),
    ...(options.retryBackoffMs !== undefined ? { retryBackoffMs: options.retryBackoffMs } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}
