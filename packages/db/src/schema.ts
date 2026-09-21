/**
 * @inkforge/db — schema of record for the whole platform.
 *
 * Tenancy is enforced in two layers (Master Directive §6.3):
 *  1. every user-scoped table carries `userId` and all repo queries filter on it
 *     (guarded by the inkforge/no-unscoped-user-query eslint rule), and
 *  2. foreign keys keep the graph consistent under concurrent workers.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Postgres bytea ↔ Node Buffer, used for assets, covers and exports. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Stack Auth user id (or "preview-user")
  email: text("email"),
  displayName: text("display_name"),
  createdAt: createdAt(),
});

export const books = pgTable(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    author: text("author").notNull(),
    description: text("description").notNull().default(""),
    genre: text("genre").notNull().default("General"),
    keywords: jsonb("keywords")
      .notNull()
      .default(sql`'[]'::jsonb`),
    language: text("language").notNull().default("en"),
    seriesLabel: text("series_label"),
    publishTarget: text("publish_target").notNull().default("kdp"),
    /** G-13: namespaced metadata extension (product/ONIX/AEO payloads attach here). */
    extra: jsonb("extra")
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("drafting"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("books_user_idx").on(table.userId)],
);

export const outlines = pgTable(
  "outlines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id").notNull(),
    userId: text("user_id").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("outlines_book_idx").on(table.bookId, table.userId)],
);

export const chapters = pgTable(
  "chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id").notNull(),
    userId: text("user_id").notNull(),
    idx: integer("idx").notNull(),
    title: text("title").notNull(),
    markdown: text("markdown").notNull().default(""),
    status: text("status").notNull().default("draft"),
    wordCount: integer("word_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("chapters_book_idx_unique").on(table.bookId, table.idx)],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    bookId: uuid("book_id"),
    kind: text("kind").notNull().default("manuscript"),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("assets_user_idx").on(table.userId)],
);

export const covers = pgTable(
  "covers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id").notNull(),
    userId: text("user_id").notNull(),
    activeVersion: integer("active_version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("covers_book_unique").on(table.bookId)],
);

export const coverVersions = pgTable(
  "cover_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    coverId: uuid("cover_id").notNull(),
    userId: text("user_id").notNull(),
    version: integer("version").notNull(),
    spec: jsonb("spec").notNull(),
    mimeType: text("mime_type").notNull().default("image/png"),
    image: bytea("image").notNull(),
    widthPx: integer("width_px").notNull().default(1600),
    heightPx: integer("height_px").notNull().default(2560),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("cover_versions_unique").on(table.coverId, table.version)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    bookId: uuid("book_id"),
    type: text("type").notNull(),
    status: text("status").notNull().default("queued"),
    payload: jsonb("payload").notNull(),
    result: jsonb("result"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    /** G-12 accounting: tokens the provider reported for this job. */
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    /** Estimated spend in micro-USD (1e-6 USD) — metering, not billing. */
    costMicros: integer("cost_micros").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("jobs_status_runafter_idx").on(table.status, table.runAfter),
    index("jobs_user_idx").on(table.userId),
  ],
);

export const exports = pgTable(
  "exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    bookId: uuid("book_id").notNull(),
    kind: text("kind").notNull().default("epub"),
    filename: text("filename").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    validation: jsonb("validation"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index("exports_user_idx").on(table.userId, table.bookId)],
);

export const userApiKeys = pgTable(
  "user_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    label: text("label").notNull(),
    provider: text("provider").notNull(),
    keyCipher: text("key_cipher").notNull(),
    keyIv: text("key_iv").notNull(),
    keyTag: text("key_tag").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index("user_api_keys_user_idx").on(table.userId)],
);

export const chapterRevisions = pgTable(
  "chapter_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    bookId: uuid("book_id").notNull(),
    chapterId: uuid("chapter_id").notNull(),
    revision: integer("revision").notNull(),
    title: text("title").notNull(),
    markdown: text("markdown").notNull(),
    wordCount: integer("word_count").notNull().default(0),
    /** Who produced the snapshot: author | worker | humanize | restore. */
    origin: text("origin").notNull().default("author"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("chapter_revisions_chapter_rev_unique").on(table.chapterId, table.revision),
    index("chapter_revisions_chapter_idx").on(table.chapterId, table.userId),
  ],
);

/**
 * G-15 — per-book consistency ledger (B5). Deterministic facts about
 * entities/timelines the post-generation validator checks against.
 */
export const consistencyFacts = pgTable(
  "consistency_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    bookId: uuid("book_id").notNull(),
    /** entity | fact | timeline */
    kind: text("kind").notNull().default("entity"),
    name: text("name").notNull(),
    aliases: jsonb("aliases")
      .notNull()
      .default(sql`'[]'::jsonb`),
    summary: text("summary").notNull().default(""),
    firstChapter: integer("first_chapter").notNull().default(0),
    lastChapter: integer("last_chapter").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [index("consistency_facts_book_idx").on(table.bookId, table.userId)],
);

/**
 * G-09b — rights & licensing records + corpus chunks (B9/B18).
 */
export const rightsRecords = pgTable(
  "rights_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    bookId: uuid("book_id").notNull(),
    /** license | permission | restriction */
    kind: text("kind").notNull().default("license"),
    title: text("title").notNull(),
    holder: text("holder").notNull(),
    terms: text("terms").notNull().default(""),
    territory: text("territory").notNull().default("world"),
    exclusive: boolean("exclusive").notNull().default(false),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (table) => [index("rights_records_book_idx").on(table.bookId, table.userId)],
);

export const corpusChunks = pgTable(
  "corpus_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    bookId: uuid("book_id").notNull(),
    source: text("source").notNull(),
    idx: integer("idx").notNull().default(0),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("corpus_chunks_book_source_idx_unique").on(table.bookId, table.source, table.idx),
    index("corpus_chunks_book_idx").on(table.bookId, table.userId),
  ],
);

/**
 * G-22 — sales/royalty ingestion records (M9 analytics loop).
 */
export const salesRecords = pgTable(
  "sales_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    bookId: uuid("book_id").notNull(),
    channel: text("channel").notNull(),
    units: integer("units").notNull().default(0),
    /** Gross revenue in micro-USD (1e-6 USD) — integer money, no floats. */
    revenueMicros: integer("revenue_micros").notNull().default(0),
    royaltyMicros: integer("royalty_micros").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("sales_records_book_idx").on(table.bookId, table.userId),
    uniqueIndex("sales_records_period_unique").on(
      table.bookId,
      table.channel,
      table.periodStart,
      table.periodEnd,
    ),
  ],
);

export const humanizeRuns = pgTable(
  "humanize_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    bookId: uuid("book_id").notNull(),
    chapterId: uuid("chapter_id").notNull(),
    seed: integer("seed").notNull(),
    passes: integer("passes").notNull().default(1),
    llmRewrites: integer("llm_rewrites").notNull().default(0),
    changedSentences: integer("changed_sentences").notNull().default(0),
    scoreBefore: jsonb("score_before").notNull(),
    scoreAfter: jsonb("score_after").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("humanize_runs_user_idx").on(table.userId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    meta: jsonb("meta"),
    createdAt: createdAt(),
  },
  (table) => [index("audit_log_target_idx").on(table.targetType, table.targetId)],
);

/** Relational graph used by drizzle's relational query API. */
export const booksRelations = relations(books, ({ many }) => ({
  chapters: many(chapters),
  exports: many(exports),
  covers: many(covers),
  jobs: many(jobs),
}));

export const chaptersRelations = relations(chapters, ({ one, many }) => ({
  book: one(books, { fields: [chapters.bookId], references: [books.id] }),
  humanizeRuns: many(humanizeRuns),
}));

export const coversRelations = relations(covers, ({ many }) => ({
  versions: many(coverVersions),
}));

export const coverVersionsRelations = relations(coverVersions, ({ one }) => ({
  cover: one(covers, { fields: [coverVersions.coverId], references: [covers.id] }),
}));

export const JOB_TYPES = [
  "outline.generate",
  "chapter.generate",
  "chapter.humanize",
  "cover.generate",
  "book.export",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TERMINAL_STATUSES: readonly JobStatus[] = ["succeeded", "failed", "cancelled"];

export const isTerminalJobStatus = (status: string): status is JobStatus =>
  (JOB_TERMINAL_STATUSES as readonly string[]).includes(status);

export const isRetryableJob = (job: {
  attempts: number;
  maxAttempts: number;
  status: string;
}): boolean => job.status === "failed" && job.attempts < job.maxAttempts;

/** Used by the upload route: the boolean flag arrives from config, not env. */
export const isFeatureEnabled = (flag: boolean | undefined): boolean => flag === true;
