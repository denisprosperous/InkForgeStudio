/**
 * @inkforge/forge — job handler registry (G-04d).
 *
 * The loop knows nothing about what a job *does*; it only claims leases and
 * dispatches. Handlers are registered per `JobType`, which keeps the execution
 * path testable (a fake handler drains a real queue) and keeps every feature's
 * work in its own module.
 */
import type { Database, JobRow, JobType } from "@inkforge/db";

export interface WorkerLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/** Everything a handler may touch. `job.userId` is the tenancy principal. */
export interface JobContext {
  readonly job: JobRow;
  readonly db: Database;
  readonly logger: WorkerLogger;
  readonly now: () => Date;
}

/**
 * A handler resolves a job. Returning a value stores it as `jobs.result`;
 * throwing marks the job failed (requeued with backoff while attempts remain).
 */
export type JobHandler = (ctx: JobContext) => Promise<unknown>;

export interface JobHandlerRegistry {
  register(type: JobType, handler: JobHandler): void;
  get(type: string): JobHandler | undefined;
  types(): JobType[];
}

/** Mutable-by-construction registry; one instance is shared per worker. */
export function createHandlerRegistry(
  initial?: Partial<Record<JobType, JobHandler>>,
): JobHandlerRegistry {
  const handlers = new Map<JobType, JobHandler>();
  const registry: JobHandlerRegistry = {
    register(type, handler) {
      handlers.set(type, handler);
    },
    get(type) {
      return handlers.get(type as JobType);
    },
    types() {
      return [...handlers.keys()];
    },
  };
  for (const [type, handler] of Object.entries(initial ?? {})) {
    if (handler) registry.register(type as JobType, handler);
  }
  return registry;
}

/**
 * A handler that is registered but cannot run yet must still be *present*, so a
 * queued job fails loudly with a stable reason instead of looking like an
 * unhandled type. Used by features whose provider is flag-disabled.
 */
export function unavailableHandler(reason: string): JobHandler {
  return async () => {
    throw new HandlerError(reason, { retryable: false });
  };
}

export interface HandlerErrorOptions {
  /** false → the loop fails the job immediately instead of backing off. */
  readonly retryable?: boolean;
}

/** Thrown by handlers to control retry semantics (bad input is not retryable). */
export class HandlerError extends Error {
  public readonly retryable: boolean;
  public constructor(message: string, options: HandlerErrorOptions = {}) {
    super(message);
    this.name = "HandlerError";
    this.retryable = options.retryable ?? true;
  }
}

/**
 * Logger that discards everything. Used by scripted one-shot ticks (`tick()`
 * from cron), by tests that assert on queue state rather than logs, and by the
 * CLI drain path where stdout is not the transport.
 */
export const silentLogger: WorkerLogger = {
  info() {},
  warn() {},
  error() {},
};
