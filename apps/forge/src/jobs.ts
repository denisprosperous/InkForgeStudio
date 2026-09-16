/**
 * @inkforge/forge — job API (G-04).
 *
 * The only way work enters the queue. Every route is bridge-authenticated
 * (see ./auth) and every query is userId-scoped by the repository layer, so a
 * bridge caller can only ever see its own tenant's queue.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  enqueueJob,
  getBook,
  getJob,
  isTerminalJobStatus,
  JOB_STATUSES,
  JOB_TYPES,
  listJobs,
  runningJobCount,
  cancelJob,
  type Database,
} from "@inkforge/db";
import { bridgeUser } from "./auth";

export interface JobsRouterOptions {
  readonly db: Database;
  readonly maxConcurrentJobsPerUser: number;
}

const createJobSchema = z.object({
  type: z.enum(JOB_TYPES),
  bookId: z.string().uuid().optional(),
  payload: z.unknown().optional(),
});

const listJobsSchema = z.object({
  bookId: z.string().uuid().optional(),
  status: z.enum(JOB_STATUSES).optional(),
});

/** Build the authenticated job API. Mount under auth middleware. */
export function createJobsRouter(options: JobsRouterOptions): Router {
  const router = Router();
  const { db, maxConcurrentJobsPerUser } = options;

  router.post("/", async (req: Request, res: Response) => {
    const parsed = createJobSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_job_request", issues: parsed.error.issues });
      return;
    }
    const { type, bookId } = parsed.data;
    // The tenancy principal always comes from the authenticated bridge
    // header — never from the body, which an end user could craft.
    const user = bridgeUser(req);
    if (bookId !== undefined) {
      const owned = await getBook(db, user, bookId);
      if (owned.length === 0) {
        res.status(404).json({ error: "book_not_found" });
        return;
      }
    }
    const inFlight = await runningJobCount(db, user);
    if (inFlight >= maxConcurrentJobsPerUser) {
      res.status(429).json({
        error: "job_limit_reached",
        detail: `${inFlight} running jobs ≥ cap ${maxConcurrentJobsPerUser}`,
      });
      return;
    }
    const job = await enqueueJob(db, user, {
      bookId: bookId ?? null,
      type,
      payload: parsed.data.payload ?? {},
    });
    res.status(202).json({ job: serializeJob(job) });
  });

  router.get("/", async (req: Request, res: Response) => {
    const user = String(req.header("x-forge-user") ?? "");
    const parsed = listJobsSchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_query" });
      return;
    }
    const filter: { bookId?: string; status?: (typeof JOB_STATUSES)[number] } = {};
    if (parsed.data.bookId !== undefined) filter.bookId = parsed.data.bookId;
    if (parsed.data.status !== undefined) filter.status = parsed.data.status;
    const rows = await listJobs(db, user, filter);
    res.status(200).json({ jobs: rows.map(serializeJob) });
  });

  router.get("/:jobId", async (req: Request, res: Response) => {
    const user = String(req.header("x-forge-user") ?? "");
    const jobId = String(req.params.jobId);
    if (!isUuid(jobId)) {
      res.status(400).json({ error: "invalid_job_id" });
      return;
    }
    const rows = await getJob(db, user, jobId);
    const job = rows[0];
    if (!job) {
      res.status(404).json({ error: "job_not_found" });
      return;
    }
    res.status(200).json({ job: serializeJob(job) });
  });

  router.post("/:jobId/cancel", async (req: Request, res: Response) => {
    const user = String(req.header("x-forge-user") ?? "");
    const jobId = String(req.params.jobId);
    if (!isUuid(jobId)) {
      res.status(400).json({ error: "invalid_job_id" });
      return;
    }
    const rows = await getJob(db, user, jobId);
    const job = rows[0];
    if (!job) {
      res.status(404).json({ error: "job_not_found" });
      return;
    }
    if (isTerminalJobStatus(job.status)) {
      res.status(409).json({ error: "job_already_terminal", status: job.status });
      return;
    }
    const cancelled = await cancelJob(db, user, jobId);
    if (!cancelled) {
      res.status(409).json({ error: "job_not_cancellable", status: job.status });
      return;
    }
    const after = await getJob(db, user, jobId);
    res.status(200).json({ job: after[0] ? serializeJob(after[0]) : null });
  });

  return router;
}

function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

/** Stable JSON shape for a job row across the API. */
export function serializeJob(job: {
  id: string;
  userId: string;
  bookId: string | null;
  type: string;
  status: string;
  payload: unknown;
  result: unknown;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}): Record<string, unknown> {
  return {
    id: job.id,
    userId: job.userId,
    bookId: job.bookId,
    type: job.type,
    status: job.status,
    payload: job.payload,
    result: job.result,
    error: job.error,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
  };
}
