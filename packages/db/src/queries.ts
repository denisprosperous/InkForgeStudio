/**
 * @inkforge/db/queries — the repository layer.
 *
 * Hard rule (Master Directive §6.3): every select/update/delete against a
 * user-scoped table filters on `userId` inside the same statement. The
 * `inkforge/no-unscoped-user-query` eslint rule enforces it at review time;
 * the genuinely system-scoped worker queries below carry explicit,
 * justified eslint-disable lines.
 */
import { and, asc, count, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  assets,
  auditLog,
  books,
  chapters,
  coverVersions,
  covers,
  exports,
  humanizeRuns,
  jobs,
  outlines,
  userApiKeys,
  type JobStatus,
  type JobType,
} from "./schema";

// ── Books ────────────────────────────────────────────────────────────

export interface BookRow {
  id: string;
  userId: string;
  title: string;
  subtitle: string | null;
  author: string;
  description: string;
  genre: string;
  keywords: unknown;
  language: string;
  seriesLabel: string | null;
  publishTarget: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A drizzle query builder: awaitable like a Promise, inspectable via toSQL(). */
export interface Queryable<T> extends PromiseLike<T> {
  toSQL(): { sql: string; params: unknown[] };
}

export function listBooks(db: Database, userId: string): Queryable<BookRow[]> {
  return db.select().from(books).where(eq(books.userId, userId)).orderBy(desc(books.updatedAt));
}

export function getBook(db: Database, userId: string, bookId: string): Queryable<BookRow[]> {
  return db
    .select()
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);
}

export interface CreateBookValues {
  readonly title: string;
  readonly author: string;
  readonly subtitle?: string;
  readonly description?: string;
  readonly genre?: string;
  readonly keywords?: string[];
  readonly language?: string;
  readonly seriesLabel?: string;
}

export async function createBook(
  db: Database,
  userId: string,
  values: CreateBookValues,
): Promise<BookRow> {
  const inserted = await db
    .insert(books)
    .values({
      userId,
      title: values.title,
      author: values.author,
      subtitle: values.subtitle,
      description: values.description ?? "",
      genre: values.genre ?? "General",
      keywords: values.keywords ?? [],
      language: values.language ?? "en",
      seriesLabel: values.seriesLabel,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("Book insert returned no rows");
  return row;
}

export interface UpdateBookValues {
  readonly title?: string;
  readonly subtitle?: string | null;
  readonly author?: string;
  readonly description?: string;
  readonly genre?: string;
  readonly keywords?: string[];
  readonly language?: string;
  readonly seriesLabel?: string | null;
  readonly status?: string;
}

export async function updateBook(
  db: Database,
  userId: string,
  bookId: string,
  values: UpdateBookValues,
): Promise<BookRow | undefined> {
  const updated = await db
    .update(books)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .returning();
  return updated[0];
}

export async function deleteBook(db: Database, userId: string, bookId: string): Promise<boolean> {
  const deleted = await db
    .delete(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .returning({ id: books.id });
  return deleted.length > 0;
}

// ── Chapters ─────────────────────────────────────────────────────────

export type ChapterRow = typeof chapters.$inferSelect;

export function listChapters(
  db: Database,
  userId: string,
  bookId: string,
): Queryable<ChapterRow[]> {
  return db
    .select()
    .from(chapters)
    .where(and(eq(chapters.bookId, bookId), eq(chapters.userId, userId)))
    .orderBy(asc(chapters.idx));
}

export function getChapter(
  db: Database,
  userId: string,
  bookId: string,
  chapterId: string,
): Queryable<ChapterRow[]> {
  return db
    .select()
    .from(chapters)
    .where(
      and(eq(chapters.id, chapterId), eq(chapters.bookId, bookId), eq(chapters.userId, userId)),
    )
    .limit(1);
}

export interface UpsertChapterValues {
  readonly idx: number;
  readonly title: string;
  readonly markdown?: string;
  readonly status?: string;
  readonly wordCount?: number;
}

export async function insertChapter(
  db: Database,
  userId: string,
  bookId: string,
  values: UpsertChapterValues,
): Promise<ChapterRow> {
  const inserted = await db
    .insert(chapters)
    .values({
      bookId,
      userId,
      idx: values.idx,
      title: values.title,
      markdown: values.markdown ?? "",
      status: values.status ?? "draft",
      wordCount: values.wordCount ?? 0,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("Chapter insert returned no rows");
  return row;
}

export async function updateChapter(
  db: Database,
  userId: string,
  bookId: string,
  chapterId: string,
  values: { title?: string; markdown?: string; status?: string; wordCount?: number; idx?: number },
): Promise<ChapterRow | undefined> {
  const updated = await db
    .update(chapters)
    .set({ ...values, updatedAt: new Date() })
    .where(
      and(eq(chapters.id, chapterId), eq(chapters.bookId, bookId), eq(chapters.userId, userId)),
    )
    .returning();
  return updated[0];
}

export async function deleteChapter(
  db: Database,
  userId: string,
  bookId: string,
  chapterId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(chapters)
    .where(
      and(eq(chapters.id, chapterId), eq(chapters.bookId, bookId), eq(chapters.userId, userId)),
    )
    .returning({ id: chapters.id });
  return deleted.length > 0;
}

/**
 * Persist a full drag-and-drop ordering in one transaction.
 *
 * `chapters_book_idx_unique` (book_id, idx) makes a naive sequential UPDATE
 * fail the moment a swap is required, so the reorder is two-phase: park every
 * chapter of the book in a negative band, then assign the requested order.
 * Ids absent from `orderedIds` keep their relative order and are appended, so
 * a partial payload can never strand a chapter at a negative index.
 */
export async function reorderChapters(
  db: Database,
  userId: string,
  bookId: string,
  orderedIds: readonly string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: chapters.id })
      .from(chapters)
      .where(and(eq(chapters.bookId, bookId), eq(chapters.userId, userId)));
    const known = new Set(existing.map((row) => row.id));
    const requested = [...new Set(orderedIds)].filter((id) => known.has(id));
    const requestedSet = new Set(requested);
    const untouched = existing.map((row) => row.id).filter((id) => !requestedSet.has(id));

    // Phase 1 — vacate the positive index band (distinct negatives, no clash).
    await tx
      .update(chapters)
      .set({ idx: sql`-1 - ${chapters.idx}`, updatedAt: new Date() })
      .where(and(eq(chapters.bookId, bookId), eq(chapters.userId, userId)));

    // Phase 2 — write the final, collision-free ordering.
    for (const [idx, id] of [...requested, ...untouched].entries()) {
      await tx
        .update(chapters)
        .set({ idx, updatedAt: new Date() })
        .where(and(eq(chapters.id, id), eq(chapters.bookId, bookId), eq(chapters.userId, userId)));
    }
  });
}

// ── Jobs ─────────────────────────────────────────────────────────────

export type JobRow = typeof jobs.$inferSelect;

export async function enqueueJob(
  db: Database,
  userId: string,
  input: { bookId?: string | null; type: JobType; payload: unknown },
): Promise<JobRow> {
  const inserted = await db
    .insert(jobs)
    .values({
      userId,
      bookId: input.bookId ?? null,
      type: input.type,
      payload: input.payload as never,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("Job insert returned no rows");
  return row;
}

export function listJobs(
  db: Database,
  userId: string,
  filter: { bookId?: string; status?: JobStatus } = {},
): Queryable<JobRow[]> {
  const optional = [
    ...(filter.bookId ? [eq(jobs.bookId, filter.bookId)] : []),
    ...(filter.status ? [eq(jobs.status, filter.status)] : []),
  ];
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.userId, userId), ...optional))
    .orderBy(desc(jobs.createdAt))
    .limit(100);
}

export function getJob(db: Database, userId: string, jobId: string): Queryable<JobRow[]> {
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1);
}

export async function cancelJob(db: Database, userId: string, jobId: string): Promise<boolean> {
  const cancelled = await db
    .update(jobs)
    .set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.userId, userId),
        or(eq(jobs.status, "queued"), eq(jobs.status, "failed")),
      ),
    )
    .returning({ id: jobs.id });
  return cancelled.length > 0;
}

/** How many of this user's jobs are in flight (per-user concurrency cap). */
export function runningJobCount(db: Database, userId: string): Promise<number> {
  return db
    .select({ value: count() })
    .from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.status, "running")))
    .then((rows) => rows[0]?.value ?? 0);
}

/**
 * Claim up to `limit` due jobs, atomically flipping them to `running`.
 *
 * System-scope query (worker internals): the fleet worker intentionally
 * competes for work across ALL users — per-user concurrency caps are applied
 * by the scheduler before enqueue, not by this claim — so no userId filter
 * applies here. (Master Directive §6.4)
 */
export async function claimDueJobs(
  db: Database,
  input: { workerId: string; limit: number; now?: Date },
): Promise<JobRow[]> {
  const now = input.now ?? new Date();
  // System scope by design — the fleet worker competes for due jobs across
  // ALL users; per-user caps are applied before enqueue (JSDoc above, §6.4).
  // eslint-disable-next-line inkforge/no-unscoped-user-query
  const claimed = await db
    .update(jobs)
    .set({
      status: "running",
      lockedAt: now,
      lockedBy: input.workerId,
      attempts: sql`${jobs.attempts} + 1`,
      updatedAt: now,
    })
    .where(
      sql`${jobs.id} in (
        select ${jobs.id} from ${jobs}
        where ${jobs.status} = 'queued' and ${jobs.runAfter} <= ${now}
        order by ${jobs.runAfter} asc
        limit ${input.limit}
      )`,
    )
    .returning();
  return claimed;
}

/**
 * Requeue jobs whose worker died mid-flight (lease expiry).
 *
 * System-scope query (worker internals): a crashed worker's leases span all
 * users, so reclaiming necessarily ignores tenancy. (Master Directive §6.4)
 */
export async function reclaimStaleJobs(db: Database, staleBefore: Date): Promise<number> {
  // System scope by design — a crashed worker's leases span all users; the
  // reclaim predicate targets stale running leases (JSDoc above, §6.4).
  // eslint-disable-next-line inkforge/no-unscoped-user-query
  const reclaimed = await db
    .update(jobs)
    .set({ status: "queued", lockedAt: null, lockedBy: null, updatedAt: new Date() })
    .where(
      and(eq(jobs.status, "running"), isNull(jobs.finishedAt), lte(jobs.lockedAt, staleBefore)),
    )
    .returning({ id: jobs.id });
  return reclaimed.length;
}

/** Mark a claimed job succeeded, scoped to its owner. */
export async function finishJob(
  db: Database,
  userId: string,
  jobId: string,
  result: unknown,
): Promise<JobRow | undefined> {
  const finished = await db
    .update(jobs)
    .set({
      status: "succeeded",
      result: result as never,
      error: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId), eq(jobs.status, "running")))
    .returning();
  return finished[0];
}

/** Fail a job; requeue with backoff while attempts remain. */
export async function failJob(
  db: Database,
  userId: string,
  jobId: string,
  error: string,
  options: { retryInMs: number } = { retryInMs: 60_000 },
): Promise<JobRow | undefined> {
  const current = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId), eq(jobs.status, "running")))
    .limit(1)
    .then((rows) => rows[0]);
  if (!current) return undefined;
  const canRetry = current.attempts < current.maxAttempts;
  const retryAt = new Date(Date.now() + options.retryInMs);
  const updated = await db
    .update(jobs)
    .set(
      canRetry
        ? {
            status: "queued",
            error,
            lockedAt: null,
            lockedBy: null,
            runAfter: retryAt,
            updatedAt: new Date(),
          }
        : { status: "failed", error, finishedAt: new Date(), updatedAt: new Date() },
    )
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .returning();
  return updated[0];
}

// ── Outlines ─────────────────────────────────────────────────────────

export type OutlineRow = typeof outlines.$inferSelect;

export function latestOutline(
  db: Database,
  userId: string,
  bookId: string,
): Queryable<OutlineRow[]> {
  return db
    .select()
    .from(outlines)
    .where(and(eq(outlines.bookId, bookId), eq(outlines.userId, userId)))
    .orderBy(desc(outlines.createdAt))
    .limit(1);
}

export async function saveOutline(
  db: Database,
  userId: string,
  bookId: string,
  payload: unknown,
): Promise<OutlineRow> {
  const inserted = await db
    .insert(outlines)
    .values({ bookId, userId, payload: payload as never })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("Outline insert returned no rows");
  return row;
}

// ── Covers ───────────────────────────────────────────────────────────

export type CoverRow = typeof covers.$inferSelect;
export type CoverVersionRow = typeof coverVersions.$inferSelect;

export function getCover(db: Database, userId: string, bookId: string): Queryable<CoverRow[]> {
  return db
    .select()
    .from(covers)
    .where(and(eq(covers.bookId, bookId), eq(covers.userId, userId)))
    .limit(1);
}

export function listCoverVersions(
  db: Database,
  userId: string,
  coverId: string,
): Queryable<CoverVersionRow[]> {
  return db
    .select()
    .from(coverVersions)
    .where(and(eq(coverVersions.coverId, coverId), eq(coverVersions.userId, userId)))
    .orderBy(desc(coverVersions.version));
}

export function getCoverVersion(
  db: Database,
  userId: string,
  coverId: string,
  version: number,
): Queryable<CoverVersionRow[]> {
  return db
    .select()
    .from(coverVersions)
    .where(
      and(
        eq(coverVersions.coverId, coverId),
        eq(coverVersions.userId, userId),
        eq(coverVersions.version, version),
      ),
    )
    .limit(1);
}

/** Insert (or get) the cover row for a book, then attach a new version. */
export async function addCoverVersion(
  db: Database,
  userId: string,
  bookId: string,
  version: {
    spec: unknown;
    image: Buffer;
    mimeType?: string;
    widthPx?: number;
    heightPx?: number;
  },
): Promise<{ cover: CoverRow; coverVersion: CoverVersionRow }> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(covers)
      .where(and(eq(covers.bookId, bookId), eq(covers.userId, userId)))
      .limit(1)
      .then((rows) => rows[0]);
    const cover =
      existing ??
      (await tx.insert(covers).values({ bookId, userId, activeVersion: 1 }).returning())[0];
    if (!cover) throw new Error("Cover upsert returned no rows");

    const nextVersion =
      (await tx
        .select({ value: count() })
        .from(coverVersions)
        .where(and(eq(coverVersions.coverId, cover.id), eq(coverVersions.userId, userId)))
        .then((rows) => rows[0]?.value ?? 0)) + 1;

    const insertedVersion = await tx
      .insert(coverVersions)
      .values({
        coverId: cover.id,
        userId,
        version: nextVersion,
        spec: version.spec as never,
        image: version.image,
        mimeType: version.mimeType ?? "image/png",
        widthPx: version.widthPx ?? 1600,
        heightPx: version.heightPx ?? 2560,
      })
      .returning();
    const coverVersion = insertedVersion[0];
    if (!coverVersion) throw new Error("Cover version insert returned no rows");

    await tx
      .update(covers)
      .set({ activeVersion: nextVersion, updatedAt: new Date() })
      .where(and(eq(covers.id, cover.id), eq(covers.userId, userId)));

    return { cover, coverVersion };
  });
}

export function getActiveCoverVersion(
  db: Database,
  userId: string,
  bookId: string,
): Promise<CoverVersionRow | undefined> {
  return db.transaction(async (tx) => {
    const cover = await tx
      .select()
      .from(covers)
      .where(and(eq(covers.bookId, bookId), eq(covers.userId, userId)))
      .limit(1)
      .then((rows) => rows[0]);
    if (!cover) return undefined;
    return tx
      .select()
      .from(coverVersions)
      .where(
        and(
          eq(coverVersions.coverId, cover.id),
          eq(coverVersions.userId, userId),
          eq(coverVersions.version, cover.activeVersion),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);
  });
}

// ── Exports ──────────────────────────────────────────────────────────

export type ExportRow = typeof exports.$inferSelect;

export async function saveExport(
  db: Database,
  userId: string,
  input: {
    bookId: string;
    filename: string;
    data: Buffer;
    validation?: unknown;
    expiresAt?: Date | null;
  },
): Promise<ExportRow> {
  const inserted = await db
    .insert(exports)
    .values({
      userId,
      bookId: input.bookId,
      filename: input.filename,
      sizeBytes: input.data.byteLength,
      data: input.data,
      validation: (input.validation ?? null) as never,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("Export insert returned no rows");
  return row;
}

export function listExports(db: Database, userId: string, bookId: string): Queryable<ExportRow[]> {
  return db
    .select()
    .from(exports)
    .where(and(eq(exports.bookId, bookId), eq(exports.userId, userId)))
    .orderBy(desc(exports.createdAt));
}

export function getExport(db: Database, userId: string, exportId: string): Queryable<ExportRow[]> {
  return db
    .select()
    .from(exports)
    .where(and(eq(exports.id, exportId), eq(exports.userId, userId)))
    .limit(1);
}

/** Purge expired export binaries (called opportunistically by the worker). */
export async function purgeExpiredExports(db: Database): Promise<number> {
  // System scope by design — retention expiry is tenant-agnostic; the worker
  // purges expired binaries for every user (Master Directive §6.4).
  // eslint-disable-next-line inkforge/no-unscoped-user-query
  const purged = await db
    .delete(exports)
    .where(and(sql`${exports.expiresAt} is not null`, lte(exports.expiresAt, new Date())))
    .returning({ id: exports.id });
  return purged.length;
}

// ── User API keys ────────────────────────────────────────────────────

export type UserApiKeyRow = typeof userApiKeys.$inferSelect;

export interface StoredUserKey {
  readonly label: string;
  readonly provider: string;
  readonly keyCipher: string;
  readonly keyIv: string;
  readonly keyTag: string;
}

export async function storeUserKey(
  db: Database,
  userId: string,
  input: StoredUserKey,
): Promise<UserApiKeyRow> {
  const inserted = await db
    .insert(userApiKeys)
    .values({
      userId,
      label: input.label,
      provider: input.provider,
      keyCipher: input.keyCipher,
      keyIv: input.keyIv,
      keyTag: input.keyTag,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("User key insert returned no rows");
  return row;
}

/** Never returns key material — only metadata. */
export function listUserKeys(db: Database, userId: string): Queryable<UserApiKeyRow[]> {
  return db
    .select({
      id: userApiKeys.id,
      userId: userApiKeys.userId,
      label: userApiKeys.label,
      provider: userApiKeys.provider,
      keyCipher: sql<string>`''`.as("key_cipher"),
      keyIv: sql<string>`''`.as("key_iv"),
      keyTag: sql<string>`''`.as("key_tag"),
      lastUsedAt: userApiKeys.lastUsedAt,
      revokedAt: userApiKeys.revokedAt,
      createdAt: userApiKeys.createdAt,
    })
    .from(userApiKeys)
    .where(and(eq(userApiKeys.userId, userId), isNull(userApiKeys.revokedAt)))
    .orderBy(desc(userApiKeys.createdAt));
}

export function getActiveUserKeys(
  db: Database,
  userId: string,
  provider?: string,
): Queryable<UserApiKeyRow[]> {
  const optional = provider ? [eq(userApiKeys.provider, provider)] : [];
  return db
    .select()
    .from(userApiKeys)
    .where(and(eq(userApiKeys.userId, userId), isNull(userApiKeys.revokedAt), ...optional))
    .orderBy(desc(userApiKeys.createdAt));
}

export async function revokeUserKey(db: Database, userId: string, keyId: string): Promise<boolean> {
  const revoked = await db
    .update(userApiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(userApiKeys.id, keyId), eq(userApiKeys.userId, userId)))
    .returning({ id: userApiKeys.id });
  return revoked.length > 0;
}

export async function markUserKeyUsed(db: Database, userId: string, keyId: string): Promise<void> {
  await db
    .update(userApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(userApiKeys.id, keyId), eq(userApiKeys.userId, userId)));
}

// ── Humanize runs / audit / assets ───────────────────────────────────

export type HumanizeRunRow = typeof humanizeRuns.$inferSelect;

export async function recordHumanizeRun(
  db: Database,
  userId: string,
  input: {
    bookId: string;
    chapterId: string;
    seed: number;
    passes: number;
    llmRewrites: number;
    changedSentences: number;
    scoreBefore: unknown;
    scoreAfter: unknown;
  },
): Promise<HumanizeRunRow> {
  const inserted = await db
    .insert(humanizeRuns)
    .values({
      userId,
      bookId: input.bookId,
      chapterId: input.chapterId,
      seed: input.seed,
      passes: input.passes,
      llmRewrites: input.llmRewrites,
      changedSentences: input.changedSentences,
      scoreBefore: input.scoreBefore as never,
      scoreAfter: input.scoreAfter as never,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("Humanize run insert returned no rows");
  return row;
}

export function listHumanizeRuns(
  db: Database,
  userId: string,
  bookId: string,
): Queryable<HumanizeRunRow[]> {
  return db
    .select()
    .from(humanizeRuns)
    .where(and(eq(humanizeRuns.bookId, bookId), eq(humanizeRuns.userId, userId)))
    .orderBy(desc(humanizeRuns.createdAt))
    .limit(50);
}

export type AuditLogRow = typeof auditLog.$inferSelect;

export async function recordAudit(
  db: Database,
  input: {
    userId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    meta?: unknown;
  },
): Promise<AuditLogRow> {
  const inserted = await db
    .insert(auditLog)
    .values({
      userId: input.userId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      meta: (input.meta ?? null) as never,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("Audit insert returned no rows");
  return row;
}

export function listAuditForUser(db: Database, userId: string): Queryable<AuditLogRow[]> {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.userId, userId))
    .orderBy(desc(auditLog.createdAt))
    .limit(100);
}

export type AssetRow = typeof assets.$inferSelect;

export async function saveAsset(
  db: Database,
  userId: string,
  input: {
    bookId?: string | null;
    kind: string;
    filename: string;
    mimeType: string;
    data: Buffer;
  },
): Promise<AssetRow> {
  const inserted = await db
    .insert(assets)
    .values({
      userId,
      bookId: input.bookId ?? null,
      kind: input.kind,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.data.byteLength,
      data: input.data,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("Asset insert returned no rows");
  return row;
}

export function getAsset(db: Database, userId: string, assetId: string): Queryable<AssetRow[]> {
  return db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
    .limit(1);
}

export function listAssets(db: Database, userId: string, bookId: string): Queryable<AssetRow[]> {
  return db
    .select()
    .from(assets)
    .where(and(eq(assets.bookId, bookId), eq(assets.userId, userId)))
    .orderBy(desc(assets.createdAt));
}
