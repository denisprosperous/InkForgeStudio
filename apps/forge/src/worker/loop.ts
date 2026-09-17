/**
 * @inkforge/forge — job worker loop (G-04d).
 *
 * One poll cycle (`tick`) does four things: reclaim leases abandoned by dead
 * workers, claim due jobs, run their handlers, and periodically purge expired
 * export artifacts. Claiming is a single atomic UPDATE in the repository layer,
 * so several workers can share one Postgres queue without double-processing.
 *
 * Handlers run inside a tick and never outside it, which is what makes `stop()`
 * a real drain: the loop is "in flight" only while a tick awaits its handlers,
 * so `stop()` waits for that tick, then confirms no lease is left `running`
 * under this worker id before resolving.
 */
import {
  claimDueJobs,
  countRunningLeases,
  failJob,
  finishJob,
  purgeExpiredExports,
  reclaimStaleJobs,
  type Database,
  type JobRow,
} from "@inkforge/db";
import { HandlerError, type JobHandlerRegistry, type WorkerLogger } from "./registry";

export interface WorkerOptions {
  readonly db: Database;
  readonly workerId: string;
  readonly handlers: JobHandlerRegistry;
  readonly logger: WorkerLogger;
  /** Delay between polls. */
  readonly pollIntervalMs?: number;
  /** Jobs claimed per tick (per-user caps are enforced before enqueue). */
  readonly batchSize?: number;
  /** A `running` lease older than this is considered abandoned. */
  readonly leaseMs?: number;
  /** How often a tick also runs retention. */
  readonly retentionIntervalMs?: number;
  /** Backoff applied to a retryable handler failure. */
  readonly retryBackoffMs?: number;
  /** Test seam: clock. */
  readonly now?: () => Date;
}

export interface TickResult {
  readonly reclaimed: number;
  readonly claimed: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly purged: number;
}

export interface Worker {
  /** Begin polling; returns immediately (the loop runs detached). */
  start(): void;
  /** Run exactly one cycle. Exposed for tests and for cron-style deployments. */
  tick(): Promise<TickResult>;
  /** Stop polling, wait for the in-flight tick to drain, then resolve. */
  stop(): Promise<void>;
  /** True while a tick is executing. */
  readonly busy: boolean;
}

const EMPTY_TICK: TickResult = { reclaimed: 0, claimed: 0, succeeded: 0, failed: 0, purged: 0 };

export function createWorker(options: WorkerOptions): Worker {
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const batchSize = options.batchSize ?? 4;
  const leaseMs = options.leaseMs ?? 300_000;
  const retentionIntervalMs = options.retentionIntervalMs ?? 3_600_000;
  const retryBackoffMs = options.retryBackoffMs ?? 60_000;
  const now = options.now ?? (() => new Date());
  const { db, handlers, logger, workerId } = options;

  let running = false;
  let ticking = false;
  let timer: NodeJS.Timeout | undefined;
  let lastRetentionAt = 0;
  let idle: Promise<void> | undefined;

  /** Resolves once no tick is executing (drain primitive for `stop()`). */
  function idleSignal(): Promise<void> {
    idle ??= new Promise<void>((resolve) => {
      const check = (): void => {
        if (ticking) setTimeout(check, 25);
        else resolve();
      };
      check();
    });
    return idle;
  }

  async function dispatch(job: JobRow): Promise<"succeeded" | "failed"> {
    const handler = handlers.get(job.type);
    if (!handler) {
      // No handler: the queued work is unrunnable, so fail it now with a stable
      // reason rather than letting it burn the retry budget.
      await failJob(db, job.userId, job.id, `no handler registered for type "${job.type}"`, {
        terminal: true,
      });
      logger.error({ jobId: job.id, type: job.type }, "worker: no handler registered");
      return "failed";
    }
    try {
      const result = await handler({ job, db, logger, now });
      const finished = await finishJob(db, job.userId, job.id, result ?? {});
      if (finished) return "succeeded";
      // The row left `running` underneath us (cancelled): do not resurrect it.
      logger.warn({ jobId: job.id }, "worker: job was not running at completion");
      return "failed";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = !(error instanceof HandlerError) || error.retryable;
      const stored = await failJob(db, job.userId, job.id, message, {
        retryInMs: retryBackoffMs,
        terminal: !retryable,
      });
      logger.warn(
        { jobId: job.id, type: job.type, error: message, status: stored?.status, retryable },
        "worker: job handler failed",
      );
      return "failed";
    }
  }

  async function tick(): Promise<TickResult> {
    if (ticking) return EMPTY_TICK;
    ticking = true;
    idle = undefined;
    // One clock read for the whole cycle: every timestamp written below comes
    // from here, so a claim never mixes a JS Date with a SQL now().
    const startedAt = now();
    try {
      const reclaimed = await reclaimStaleJobs(db, new Date(startedAt.getTime() - leaseMs));
      if (reclaimed > 0) logger.info({ reclaimed }, "worker: reclaimed abandoned leases");

      const claimed = await claimDueJobs(db, { workerId, limit: batchSize, now: startedAt });
      let succeeded = 0;
      let failed = 0;
      if (claimed.length > 0) {
        const outcomes = await Promise.all(claimed.map((job) => dispatch(job)));
        succeeded = outcomes.filter((outcome) => outcome === "succeeded").length;
        failed = outcomes.length - succeeded;
        logger.info({ claimed: claimed.length, succeeded, failed }, "worker: tick complete");
      }

      let purged = 0;
      if (startedAt.getTime() - lastRetentionAt >= retentionIntervalMs) {
        lastRetentionAt = startedAt.getTime();
        purged = await purgeExpiredExports(db);
        if (purged > 0) logger.info({ purged }, "worker: purged expired exports");
      }

      return { reclaimed, claimed: claimed.length, succeeded, failed, purged };
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "worker: tick failed",
      );
      return EMPTY_TICK;
    } finally {
      ticking = false;
      idle = undefined;
    }
  }

  function schedule(): void {
    if (!running) return;
    timer = setTimeout(() => {
      void tick().finally(schedule);
    }, pollIntervalMs);
    timer.unref();
  }

  return {
    get busy() {
      return ticking;
    },
    start() {
      if (running) return;
      running = true;
      logger.info(
        { workerId, pollIntervalMs, batchSize, handlers: handlers.types() },
        "worker: starting",
      );
      schedule();
    },
    tick,
    async stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
      // Drain: wait for the in-flight tick, then confirm this worker holds no
      // running leases, so a SIGTERM never abandons claimed work.
      await idleSignal();
      try {
        const held = await countRunningLeases(db, workerId);
        if (held > 0) logger.warn({ held }, "worker: stopped with running leases held");
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          "worker: drain check failed",
        );
      }
      logger.info({ workerId }, "worker: stopped");
    },
  };
}
