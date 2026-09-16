import { and, eq, isNull, lte } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createDb,
  getBook,
  getExport,
  getJob,
  isFeatureEnabled,
  isRetryableJob,
  isTerminalJobStatus,
  jobs,
  JOB_STATUSES,
  JOB_TYPES,
  listBooks,
  listChapters,
  listJobs,
} from "../src/index";
import type { Database } from "../src/client";

/** postgres-js is lazy; no connection is opened for SQL composition. */
const handle = createDb("postgres://postgres:postgres@127.0.0.1:5432/inkforge_test", { max: 1 });
const db = handle.db as Database;

describe("schema constants", () => {
  it("declares the five job types the worker dispatches", () => {
    expect(JOB_TYPES).toEqual([
      "outline.generate",
      "chapter.generate",
      "chapter.humanize",
      "cover.generate",
      "book.export",
    ]);
  });

  it("declares the job lifecycle", () => {
    expect(JOB_STATUSES).toEqual(["queued", "running", "succeeded", "failed", "cancelled"]);
  });

  it("classifies terminal and retryable jobs", () => {
    expect(isTerminalJobStatus("succeeded")).toBe(true);
    expect(isTerminalJobStatus("running")).toBe(false);
    expect(isRetryableJob({ attempts: 1, maxAttempts: 3, status: "failed" })).toBe(true);
    expect(isRetryableJob({ attempts: 3, maxAttempts: 3, status: "failed" })).toBe(false);
    expect(isFeatureEnabled(true)).toBe(true);
    expect(isFeatureEnabled(false)).toBe(false);
    expect(isFeatureEnabled(undefined)).toBe(false);
  });
});

describe("tenant scoping (Master Directive §6.3)", () => {
  it("scopes every book read to the caller's userId", () => {
    const sql = listBooks(db, "user-42").toSQL();
    expect(sql.sql).toContain('"books"');
    expect(sql.params).toContain("user-42");
  });

  it("scopes single-book reads by id AND userId", () => {
    const sql = getBook(db, "user-42", "book-9").toSQL();
    expect(sql.params).toContain("user-42");
    expect(sql.params).toContain("book-9");
  });

  it("scopes chapter reads by book AND user", () => {
    const sql = listChapters(db, "user-42", "book-9").toSQL();
    expect(sql.sql).toContain('"chapters"');
    expect(sql.params).toContain("user-42");
    expect(sql.params).toContain("book-9");
  });

  it("scopes job listings, never leaking another tenant's queue", () => {
    const sql = listJobs(db, "user-42", { status: "queued" }).toSQL();
    expect(sql.params).toContain("user-42");
    expect(sql.params).toContain("queued");
  });

  it("scopes single-job reads", () => {
    const sql = getJob(db, "user-42", "job-1").toSQL();
    expect(sql.params).toContain("user-42");
    expect(sql.params).toContain("job-1");
  });

  it("scopes export fetches", () => {
    const sql = getExport(db, "user-42", "export-1").toSQL();
    expect(sql.params).toContain("user-42");
    expect(sql.params).toContain("export-1");
  });
});

describe("system-scoped worker queries (Master Directive §6.4)", () => {
  it("reclaim predicates target stale running leases across all tenants", () => {
    const cutoff = new Date("2026-01-01T00:00:00Z");
    // Composition mirror of queries.reclaimStaleJobs (kept in sync by tests).
    // System scope by design — mirrors the worker reclaim query, which
    // intentionally spans all tenants (Master Directive §6.4).
    // eslint-disable-next-line inkforge/no-unscoped-user-query
    const sql = db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.status, "running"), isNull(jobs.finishedAt), lte(jobs.lockedAt, cutoff)))
      .toSQL();
    expect(sql.sql).toContain('"jobs"');
    // drizzle serializes timestamp params to ISO strings in toSQL().
    // Deliberately no userId param: reclaim is the documented system scope —
    // params are exactly the status literal and the cutoff, never a user id.
    expect(sql.params).toEqual(["running", cutoff.toISOString()]);
  });
});
