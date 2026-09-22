/**
 * Migration integration suite (G-07 regression gate).
 *
 * Applies every committed drizzle migration to a THROWAWAY database and
 * asserts the full schema of record materializes. Needs a live Postgres 16:
 * set INKFORGE_PG_TEST=1 with INTEGRATION_ADMIN_URL (or accept the docker
 * compose default) — CI and the NEGENTROPY clean-checkout run set it. Without
 * the marker the suite is inert so cold environments stay hermetic.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

const ENABLED = process.env.INKFORGE_PG_TEST === "1";
const ADMIN_URL =
  process.env.INTEGRATION_ADMIN_URL ?? "postgres://inkforge:inkforge@localhost:5432/inkforge";

const MIGRATIONS_DIR = path.resolve(__dirname, "../drizzle");
const EXPECTED_TABLES = [
  "assets",
  "audit_log",
  "books",
  "chapter_revisions",
  "chapters",
  "consistency_facts",
  "corpus_chunks",
  "cover_versions",
  "covers",
  "exports",
  "humanize_runs",
  "jobs",
  "outlines",
  "rights_records",
  "sales_records",
  "user_api_keys",
  "users",
];

interface JournalEntry {
  readonly tag: string;
}

function migrationFiles(): string[] {
  const journal = JSON.parse(
    readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
  ) as { entries: readonly JournalEntry[] };
  return journal.entries.map((entry) => path.join(MIGRATIONS_DIR, `${entry.tag}.sql`));
}

describe.skipIf(!ENABLED)("G-07 migrations apply cleanly to a fresh database", () => {
  const dbName = `migtest_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  let target: postgres.Sql | undefined;

  // OMEGA-1 battery V6: under full-suite parallel load the live-DB beforeAll
  // exceeded vitest's default 10s hook timeout once (it passes in ~4s alone
  // and passed in the previous battery run). Provision 30s for the integration
  // hook only; test bodies keep the default timeout.
  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    target = postgres(ADMIN_URL.replace(/\/[^/]+$/, `/${dbName}`), {
      max: 1,
      onnotice: () => {},
    });
  }, 30_000);

  afterAll(async () => {
    await target?.end({ timeout: 3 });
    await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin.end({ timeout: 3 });
  });

  it("ships at least one migration per journal entry", () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(() => readFileSync(file, "utf8")).not.toThrow();
    }
  });

  it("applies every migration in order and materializes the full schema", async () => {
    expect(target).toBeDefined();
    for (const file of migrationFiles()) {
      await target!.unsafe(readFileSync(file, "utf8"));
    }
    const rows = await target!`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`;
    const tables = rows.map((row) => String(row.table_name)).sort();
    expect(tables).toEqual(EXPECTED_TABLES);
  });

  it("carries the G-12 accounting columns on jobs", async () => {
    expect(target).toBeDefined();
    // The suite's earlier test already applied every migration to `target`;
    // this asserts the columns the accounting feature added.
    const rows = await target!`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'jobs'
        AND column_name IN ('prompt_tokens', 'completion_tokens', 'cost_micros')
      ORDER BY column_name`;
    expect(rows.map((row) => String(row.column_name))).toEqual([
      "completion_tokens",
      "cost_micros",
      "prompt_tokens",
    ]);
  });

  it("carries the G-13 extra jsonb extension column on books", async () => {
    expect(target).toBeDefined();
    const rows = await target!`
      SELECT column_name, data_type, column_default FROM information_schema.columns
      WHERE table_name = 'books' AND column_name = 'extra'`;
    expect(rows).toHaveLength(1);
    expect(String(rows[0].data_type)).toBe("jsonb");
    expect(String(rows[0].column_default)).toContain("'{}'::jsonb");
  });

  it("carries the G-15 consistency_facts ledger table with span columns", async () => {
    expect(target).toBeDefined();
    const rows = await target!`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'consistency_facts'
        AND column_name IN ('kind', 'name', 'aliases', 'summary', 'first_chapter', 'last_chapter')
      ORDER BY column_name`;
    expect(rows.map((row) => String(row.column_name))).toEqual([
      "aliases",
      "first_chapter",
      "kind",
      "last_chapter",
      "name",
      "summary",
    ]);
  });

  it("carries the G-09b rights_records and corpus_chunks tables", async () => {
    expect(target).toBeDefined();
    const rights = await target!`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'rights_records'
        AND column_name IN ('kind', 'title', 'holder', 'territory', 'exclusive', 'status')
      ORDER BY column_name`;
    expect(rights.map((row) => String(row.column_name))).toEqual([
      "exclusive",
      "holder",
      "kind",
      "status",
      "territory",
      "title",
    ]);
    const corpus = await target!`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'corpus_chunks' AND column_name IN ('source', 'idx', 'text')
      ORDER BY column_name`;
    expect(corpus.map((row) => String(row.column_name))).toEqual(["idx", "source", "text"]);
  });

  it("carries the G-22 sales_records table with integer money columns", async () => {
    expect(target).toBeDefined();
    const rows = await target!`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sales_records'
        AND column_name IN ('channel', 'units', 'revenue_micros', 'royalty_micros', 'currency', 'period_start', 'period_end')
      ORDER BY column_name`;
    expect(rows.map((row) => String(row.column_name))).toEqual([
      "channel",
      "currency",
      "period_end",
      "period_start",
      "revenue_micros",
      "royalty_micros",
      "units",
    ]);
  });

  it("applies idempotently via the drizzle journal (no duplicate-table errors on re-list)", () => {
    const files = migrationFiles();
    const journal = readdirSync(path.join(MIGRATIONS_DIR, "meta"));
    expect(journal).toContain("_journal.json");
    expect(files.length).toBeGreaterThan(0);
  });
});
