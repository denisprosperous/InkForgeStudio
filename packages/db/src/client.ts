/**
 * @inkforge/db/client — the only place that knows how to open Postgres.
 *
 * postgres-js is lazy: connections open on first query, so constructing a
 * database handle in tests is free and never touches the network.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export interface DbHandle {
  readonly db: ReturnType<typeof createDrizzle>;
  readonly client: postgres.Sql;
  close(): Promise<void>;
}

function createDrizzle(client: postgres.Sql) {
  return drizzle(client, { schema });
}

/** Open a handle; call `close()` on shutdown. */
export function createDb(
  url: string,
  options: { max?: number; connectTimeoutSeconds?: number } = {},
): DbHandle {
  const client = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: 20,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
  });
  const db = createDrizzle(client);
  return {
    db,
    client,
    close: () => client.end({ timeout: 5 }),
  };
}

export type Database = ReturnType<typeof createDrizzle>;
export { schema };
