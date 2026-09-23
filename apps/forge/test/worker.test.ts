/**
 * G-04d — worker loop contract tests. Live Postgres required.
 *
 * The queue is the contract, so every assertion is made against real rows after
 * a real tick: a registered handler finishes a claim, an unregistered type fails
 * loudly instead of stranding, a retryable failure requeues with attempts++, a
 * non-retryable one stops, an abandoned lease is reclaimed, retention deletes
 * only expired exports, and `stop()` really drains.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  books,
  enqueueJob,
  exports as exportRows,
  getJob,
  jobs,
  saveExport,
  type Database,
  type JobRow,
} from "@inkforge/db";
import { createForgeWorker } from "../src/worker/index";
import { HandlerError, silentLogger, type WorkerLogger } from "../src/worker/registry";
import { createFreshDb, type FreshDb } from "./helpers/fresh-db";

const ENABLED = process.env.INKFORGE_PG_TEST === "1";

const d = describe.skipIf(!ENABLED);

/** A logger that records so tests can assert on emitted events. */
function recordingLogger(): WorkerLogger & { events: string[] } {
  const events: string[] = [];
  const push =
    (level: string) =>
    (payload: Record<string, unknown>, message?: string): void => {
      events.push(`${level}:${message ?? ""}:${JSON.stringify(payload)}`);
    };
  return {
    events,
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
  };
}

d("worker loop", () => {
  let handle: FreshDb;
  let db: Database;
  const user = `user-${randomUUID()}`;
  let bookId = "";

  beforeAll(async () => {
    handle = await createFreshDb("forgework");
    db = handle.db;
    const rows = await db
      .insert(books)
      .values({ userId: user, title: "Worker Fixture", author: "Mara Vane" })
      .returning();
    bookId = rows[0]!.id;
  }, 60_000);

  afterAll(async () => {
    await db.delete(exportRows).where(eq(exportRows.userId, user));
    await db.delete(books).where(eq(books.userId, user));
    await handle.destroy();
  }, 30_000);

  function workerFor(overrides: Parameters<typeof createForgeWorker>[0]["overrides"] = {}) {
    return createForgeWorker({
      db,
      logger: silentLogger,
      workerId: `test-worker-${randomUUID()}`,
      pollIntervalMs: 10,
      retryBackoffMs: 0,
      overrides,
    });
  }

  async function statusOf(id: string): Promise<JobRow> {
    const rows = await getJob(db, user, id);
    const job = rows[0];
    if (!job) throw new Error(`job ${id} vanished`);
    return job;
  }
  it("runs a registered handler to success and stores the result", async () => {
    const worker = workerFor({
      "outline.generate": async ({ job }) => ({ ok: true, jobId: job.id }),
    });
    const job = await enqueueJob(db, user, {
      bookId,
      type: "outline.generate",
      payload: { premise: "x" },
    });

    const tick = await worker.tick();
    expect(tick.claimed).toBeGreaterThanOrEqual(1);
    expect(tick.succeeded).toBe(1);
    expect(tick.failed).toBe(0);

    const after = await statusOf(job.id);
    expect(after.status).toBe("succeeded");
    expect(after.result).toEqual({ ok: true, jobId: job.id });
    expect(after.finishedAt).not.toBeNull();
    expect(after.attempts).toBe(1);
  });

  it("fails an unregistered job type immediately, without burning retries", async () => {
    // `cover.generate` is the last handler registered as *unavailable* — the
    // queue must say so rather than look like an unhandled type.
    // (chapter.humanize grew a real handler in G-17; chapter.generate and
    // book.export grew theirs in G-17a.)
    const worker = workerFor();
    const job = await enqueueJob(db, user, { bookId, type: "cover.generate", payload: {} });

    const tick = await worker.tick();
    expect(tick.failed).toBeGreaterThanOrEqual(1);

    const after = await statusOf(job.id);
    expect(after.status).toBe("failed");
    expect(after.error).toContain("not yet registered");
    expect(after.attempts).toBe(1);
  });

  it("retries a retryable handler failure with attempts++ and a due time", async () => {
    let calls = 0;
    const worker = workerFor({
      "outline.generate": async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient upstream 503");
        return { recovered: true };
      },
    });
    const job = await enqueueJob(db, user, { bookId, type: "outline.generate", payload: {} });

    const first = await worker.tick();
    expect(first.failed).toBe(1);
    const retried = await statusOf(job.id);
    expect(retried.status).toBe("queued");
    expect(retried.attempts).toBe(1);
    expect(retried.error).toContain("transient upstream 503");

    const second = await worker.tick();
    expect(second.succeeded).toBe(1);
    const done = await statusOf(job.id);
    expect(done.status).toBe("succeeded");
    expect(done.result).toEqual({ recovered: true });
    expect(done.error).toBeNull();
  });

  it("does not retry a HandlerError marked retryable:false", async () => {
    const worker = workerFor({
      "outline.generate": () => {
        throw new HandlerError("bad payload", { retryable: false });
      },
    });
    const job = await enqueueJob(db, user, { bookId, type: "outline.generate", payload: {} });

    await worker.tick();
    const after = await statusOf(job.id);
    expect(after.status).toBe("failed");
    expect(after.error).toBe("bad payload");
  });
  it("reclaims a lease abandoned past its TTL and re-runs it", async () => {
    const stale = await enqueueJob(db, user, { bookId, type: "outline.generate", payload: {} });
    await db
      .update(jobs)
      .set({
        status: "running",
        lockedBy: "dead-worker",
        lockedAt: new Date(Date.now() - 3_600_000),
        attempts: 1,
        maxAttempts: 3,
      })
      .where(and(eq(jobs.id, stale.id), eq(jobs.userId, user)));

    const worker = workerFor({ "outline.generate": async () => ({ reclaimedRun: true }) });
    const tick = await worker.tick();
    expect(tick.reclaimed).toBeGreaterThanOrEqual(1);
    expect(tick.succeeded).toBe(1);

    const after = await statusOf(stale.id);
    expect(after.status).toBe("succeeded");
    expect(after.result).toEqual({ reclaimedRun: true });
  });

  it("purges only expired export artifacts", async () => {
    const expired = await saveExport(db, user, {
      bookId,
      filename: "expired.epub",
      data: Buffer.from("old"),
      expiresAt: new Date(Date.now() - 60_000),
    });
    const live = await saveExport(db, user, {
      bookId,
      filename: "live.epub",
      data: Buffer.from("new"),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const forever = await saveExport(db, user, {
      bookId,
      filename: "forever.epub",
      data: Buffer.from("keep"),
      expiresAt: null,
    });

    const worker = workerFor();
    const tick = await worker.tick();
    expect(tick.purged).toBeGreaterThanOrEqual(1);

    const remaining = await db
      .select({ id: exportRows.id })
      .from(exportRows)
      .where(eq(exportRows.userId, user));
    const ids = remaining.map((row) => row.id);
    expect(ids).not.toContain(expired.id);
    expect(ids).toContain(live.id);
    expect(ids).toContain(forever.id);
  });

  it("drains in-flight work on stop() and holds no running lease", async () => {
    let released: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      released = resolve;
    });
    let started = false;
    const worker = workerFor({
      "outline.generate": async () => {
        started = true;
        await gate;
        return { drained: true };
      },
    });
    const job = await enqueueJob(db, user, { bookId, type: "outline.generate", payload: {} });

    worker.start();
    // Poll for the handler to actually start rather than sleeping a fixed
    // window: under parallel suite load the first scheduled tick can land late,
    // and a fixed 150ms wait was the flake (not a drain-semantics failure).
    const deadline = Date.now() + 5_000;
    while (!started && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(started).toBe(true);
    expect(worker.busy).toBe(true);

    const stopping = worker.stop();
    expect(worker.busy).toBe(true); // still draining
    released?.();
    await stopping;

    expect(worker.busy).toBe(false);
    const after = await statusOf(job.id);
    expect(after.status).toBe("succeeded");
    expect(after.result).toEqual({ drained: true });
  });

  it("start() is idempotent and tick() is serialized", async () => {
    const logger = recordingLogger();
    let concurrent = 0;
    let peak = 0;
    const worker = createForgeWorker({
      db,
      logger,
      workerId: `test-worker-${randomUUID()}`,
      pollIntervalMs: 5,
      overrides: {
        "outline.generate": async () => {
          concurrent += 1;
          peak = Math.max(peak, concurrent);
          await new Promise((resolve) => setTimeout(resolve, 20));
          concurrent -= 1;
          return {};
        },
      },
    });
    await enqueueJob(db, user, { bookId, type: "outline.generate", payload: {} });
    worker.start();
    worker.start(); // second call must not double-schedule
    await new Promise((resolve) => setTimeout(resolve, 150));
    await worker.stop();

    expect(peak).toBeLessThanOrEqual(1);
    expect(logger.events.some((event) => event.includes("starting"))).toBe(true);
    expect(logger.events.some((event) => event.includes("stopped"))).toBe(true);
  });

  it("outline.generate persists a schema-valid outline for the job's book", async () => {
    const worker = workerFor();
    const job = await enqueueJob(db, user, {
      bookId,
      type: "outline.generate",
      payload: {
        premise: "A cartographer maps a coastline that moves.",
        targetWords: 5_000,
        chapterCount: 5,
      },
    });

    const tick = await worker.tick();
    expect(tick.succeeded).toBe(1);

    const after = await statusOf(job.id);
    expect(after.status).toBe("succeeded");
    const result = after.result as Record<string, unknown>;
    expect(result.source).toBe("planner"); // no provider configured in tests
    expect(result.chapters).toBe(5);
    expect(result.bookId).toBe(bookId);
    expect(typeof result.outlineId).toBe("string");
  });
});
