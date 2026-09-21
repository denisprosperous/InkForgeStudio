/**
 * G-22 — sales ingestion + the M9->M1 loop over HTTP. Live Postgres required
 * (INKFORGE_PG_TEST=1): ingest upserts per channel+period, the summary is the
 * deterministic aggregate, and refresh-gate rewrites the G-21 verdict using
 * demand derived from sales.
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { books, createDb, salesRecords, type DbHandle } from "@inkforge/db";

const ENABLED = process.env.INKFORGE_PG_TEST === "1";
const DB_URL =
  process.env.FORGE_TEST_DATABASE_URL ?? "postgres://inkforge:inkforge@localhost:5432/inkforge";
const SECRET = "neg4-test-secret";
const d = describe.skipIf(!ENABLED);

function headers(user: string) {
  return { "x-forge-secret": SECRET, "x-forge-user": user };
}

function record(channel: string, units: number, month: string) {
  return {
    channel,
    units,
    revenueMicros: units * 4_990_000,
    royaltyMicros: units * 3_493_000,
    currency: "USD",
    periodStart: `2026-${month}-01T00:00:00.000Z`,
    periodEnd: `2026-${month}-28T00:00:00.000Z`,
  };
}

d("sales API (G-22)", () => {
  let handle: DbHandle;
  const user = `user-${randomUUID()}`;
  const other = `user-${randomUUID()}`;
  let bookId = "";
  let emptyBookId = "";

  beforeAll(async () => {
    handle = createDb(DB_URL, { max: 5 });
    const forgeApp = buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
    const created = await request(forgeApp)
      .post("/books")
      .set(headers(user))
      .send({ title: "Royalty Probe", author: "Dana Pryce" });
    bookId = created.body.book.id;
    const empty = await request(forgeApp)
      .post("/books")
      .set(headers(user))
      .send({ title: "No Sales Yet", author: "Dana Pryce" });
    emptyBookId = empty.body.book.id;
    expect(created.status).toBe(201);
  }, 60_000);

  afterAll(async () => {
    await handle.db.delete(salesRecords).where(inArray(salesRecords.userId, [user, other]));
    await handle.db.delete(books).where(inArray(books.userId, [user, other]));
    await handle.close();
  }, 30_000);

  function app() {
    return buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
  }

  it("ingests sales and upserts the same channel+period instead of duplicating", async () => {
    const first = await request(app())
      .post(`/books/${bookId}/sales`)
      .set(headers(user))
      .send({ records: [record("kdp", 100, "08"), record("kdp", 50, "09")] });
    expect(first.status).toBe(201);
    expect(first.body.ingested).toBe(2);
    const corrected = await request(app())
      .post(`/books/${bookId}/sales`)
      .set(headers(user))
      .send({ records: [record("kdp", 120, "08")] });
    expect(corrected.status).toBe(201);
    const summary = await request(app()).get(`/books/${bookId}/sales/summary`).set(headers(user));
    expect(summary.status).toBe(200);
    expect(summary.body.summary.records).toBe(2);
    expect(summary.body.summary.totalUnits).toBe(170);
  });

  it("derives a demand signal from the summary", async () => {
    const summary = await request(app()).get(`/books/${bookId}/sales/summary`).set(headers(user));
    expect(summary.body.signal.sampleSize).toBe(2);
    expect(summary.body.signal.demandScore).toBeGreaterThan(0);
    const windowed = await request(app())
      .get(`/books/${bookId}/sales/summary`)
      .query({ from: "2026-09-01T00:00:00.000Z" })
      .set(headers(user));
    expect(windowed.body.summary.totalUnits).toBe(50);
  });

  it("refreshes the market gate with the sales-derived demand (M9 -> M1)", async () => {
    const refresh = await request(app())
      .post(`/books/${bookId}/sales/refresh-gate`)
      .set(headers(user));
    expect(refresh.status).toBe(200);
    expect(refresh.body.gate.snapshot.source).toBe("sales-ingest");
    expect(["go", "hold", "no-go"]).toContain(refresh.body.gate.verdict);
    const gate = await request(app()).get(`/books/${bookId}/market/gate`).set(headers(user));
    expect(gate.body.gate.snapshot.source).toBe("sales-ingest");
  });

  it("refuses to refresh a gate with no ingested sales, and hides other tenants", async () => {
    const none = await request(app())
      .post(`/books/${emptyBookId}/sales/refresh-gate`)
      .set(headers(user));
    expect(none.status).toBe(409);
    expect(none.body.error).toBe("no_sales_ingested");
    const foreign = await request(app()).get(`/books/${bookId}/sales/summary`).set(headers(other));
    expect(foreign.status).toBe(404);
    const bad = await request(app())
      .post(`/books/${bookId}/sales`)
      .set(headers(user))
      .send({ records: [{ channel: "kdp", units: -5 }] });
    expect(bad.status).toBe(400);
  });
});
