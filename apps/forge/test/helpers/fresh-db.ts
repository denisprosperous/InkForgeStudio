/**
 * Test helper — a throwaway Postgres database with the committed migrations
 * applied (same technique as packages/db/test/migrations.test.ts).
 *
 * The job queue is global by design: any worker claims any due job. Suites that
 * assert exact tick counts therefore need their own database, or a concurrent
 * suite's queued rows leak into the claim batch and the assertions become a race
 * instead of a contract. Each helper call creates a uniquely-named database,
 * replays every committed migration into it, and drops it on teardown.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { createDb, type DbHandle } from "@inkforge/db";

const ADMIN_URL =
  process.env.INTEGRATION_ADMIN_URL ?? "postgres://inkforge:inkforge@localhost:5432/inkforge";
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../../packages/db/drizzle");

export interface FreshDb extends DbHandle {
  readonly url: string;
  /** Drop the throwaway database. Safe to call twice. */
  readonly destroy: () => Promise<void>;
}

function migrationFiles(): string[] {
  const journal = JSON.parse(
    readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
  ) as { entries: readonly { tag: string }[] };
  return journal.entries.map((entry) => path.join(MIGRATIONS_DIR, `${entry.tag}.sql`));
}

function urlFor(dbName: string): string {
  return ADMIN_URL.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
}

/** Create an isolated database with the migration set applied. */
export async function createFreshDb(label = "forge"): Promise<FreshDb> {
  const dbName = `${label}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const url = urlFor(dbName);
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  let handle: DbHandle | undefined;
  let dropped = false;
  try {
    const bootstrap = postgres(url, { max: 1, onnotice: () => {} });
    for (const file of migrationFiles()) {
      await bootstrap.unsafe(readFileSync(file, "utf8"));
    }
    await bootstrap.end({ timeout: 5 });
    handle = createDb(url, { max: 5 });
  } finally {
    await admin.end({ timeout: 5 });
  }
  return {
    ...handle,
    url,
    destroy: async () => {
      if (dropped) return;
      dropped = true;
      await handle?.close();
      const cleanup = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
      try {
        await cleanup.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      } finally {
        await cleanup.end({ timeout: 5 });
      }
    },
  };
}
