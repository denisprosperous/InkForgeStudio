/**
 * G-17 — `chapter.humanize` handler contract (live Postgres required:
 * INKFORGE_PG_TEST=1). The queue is the contract: assertions run against real
 * rows after a real tick — chapter updated to status "humanized", an audit row
 * in humanize_runs, and a result carrying the approve/reject diff {before, after}.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  createBook,
  enqueueJob,
  getChapter,
  insertChapter,
  jobs,
  listHumanizeRuns,
} from "@inkforge/db";
import { createForgeWorker } from "../src/worker/index";
import { createFreshDb, type FreshDb } from "./helpers/fresh-db";

const ENABLED = process.env.INKFORGE_PG_TEST === "1";
const d = describe.skipIf(!ENABLED);

const DRAFT = [
  "# The Lamp",
  "",
  "It is important to note that the lamp did not answer.",
  "Furthermore the keeper did not ask again.",
].join("\n\n");

d("worker handler: chapter.humanize (G-17)", () => {
  let handle: FreshDb;
  const user = `user-${randomUUID()}`;
  let bookId = "";
  let chapterId = "";

  beforeAll(async () => {
    handle = await createFreshDb("forgehumanize");
    const book = await createBook(handle.db, user, {
      title: "Quiet Machines",
      author: "Mara Vane",
    });
    bookId = book.id;
    const chapter = await insertChapter(handle.db, user, bookId, {
      idx: 0,
      title: "The Lamp",
      markdown: DRAFT,
    });
    chapterId = chapter.id;
  }, 60_000);

  afterAll(async () => {
    await handle.destroy();
  }, 30_000);

  async function runJob(type: "chapter.humanize", payload: unknown) {
    const enqueued = await enqueueJob(handle.db, user, { bookId, type, payload });
    const tick = await createForgeWorker({
      db: handle.db,
      logger: { info() {}, warn() {}, error() {} },
      workerId: `test-${randomUUID()}`,
      pollIntervalMs: 10,
      retryBackoffMs: 0,
    }).tick();
    const rows = await handle.db.select().from(jobs).where(eq(jobs.id, enqueued.id));
    return { tick, job: rows[0]! };
  }

  it("rewrites stock phrases, stores the diff, and records the audit run", async () => {
    const { job } = await runJob("chapter.humanize", { chapterId });
    expect(job.status).toBe("succeeded");
    const result = job.result as {
      before: string;
      after: string;
      changedSentences: number;
    };
    expect(result.before).toBe(DRAFT);
    expect(result.after).not.toContain("It is important to note that");
    expect(result.after).not.toContain("Furthermore");
    expect(result.changedSentences).toBeGreaterThan(0);
    const after = await getChapter(handle.db, user, bookId, chapterId);
    expect(after[0]!.markdown).toBe(result.after);
    expect(after[0]!.status).toBe("humanized");
    const runs = await listHumanizeRuns(handle.db, user, bookId);
    expect(runs.length).toBeGreaterThanOrEqual(1);
  });

  it("fails loudly on an empty draft instead of shipping a no-op", async () => {
    const empty = await insertChapter(handle.db, user, bookId, {
      idx: 1,
      title: "Blank",
      markdown: "",
    });
    const { job } = await runJob("chapter.humanize", { chapterId: empty.id });
    expect(job.status).toBe("failed");
    expect(String(job.error)).toMatch(/nothing to humanize/i);
  });
});
