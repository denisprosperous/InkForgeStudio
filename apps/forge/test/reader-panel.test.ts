/**
 * G-25 — reader simulation panel over HTTP. Live Postgres required
 * (INKFORGE_PG_TEST=1). The panel is deterministic: same manuscript, same
 * personas, same report — so the studio can diff revisions against it.
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { books, createDb, type DbHandle } from "@inkforge/db";

const ENABLED = process.env.INKFORGE_PG_TEST === "1";
const DB_URL =
  process.env.FORGE_TEST_DATABASE_URL ?? "postgres://inkforge:inkforge@localhost:5432/inkforge";
const SECRET = "neg4-test-secret";
const d = describe.skipIf(!ENABLED);

function headers(user: string) {
  return { "x-forge-secret": SECRET, "x-forge-user": user };
}

d("reader panel API (G-25)", () => {
  let handle: DbHandle;
  const user = `user-${randomUUID()}`;
  const other = `user-${randomUUID()}`;
  let bookId = "";

  beforeAll(async () => {
    handle = createDb(DB_URL, { max: 5 });
    const forgeApp = buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
    const created = await request(forgeApp)
      .post("/books")
      .set(headers(user))
      .send({ title: "Panel Probe", author: "Dana Pryce" });
    bookId = created.body.book.id;
    await request(forgeApp)
      .post(`/books/${bookId}/chapters`)
      .set(headers(user))
      .send({ title: "The Lamp", markdown: 'The lamp exploded. "Run!" Mara shouted.' });
    await request(forgeApp).post(`/books/${bookId}/chapters`).set(headers(user)).send({
      title: "The Ledger",
      markdown:
        "It is important to note that the historical context of the region, which had been shaped by centuries of administrative reform and its attendant fiscal consequences, was in many respects a precursor to the events that followed, and moreover the institutional memory persisted long after the principals had departed entirely.",
    });
    expect(created.status).toBe(201);
  }, 60_000);

  afterAll(async () => {
    await handle.db.delete(books).where(inArray(books.userId, [user, other]));
    await handle.close();
  }, 30_000);

  function app() {
    return buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
  }

  it("runs the default panel and reports weak chapters", async () => {
    const res = await request(app())
      .post(`/books/${bookId}/simulation/reader-panel`)
      .set(headers(user));
    expect(res.status).toBe(200);
    expect(res.body.report.readers.length).toBeGreaterThanOrEqual(3);
    expect(res.body.report.weakChapters).toContain(1);
    expect(res.body.report.meanEngagementByChapter).toHaveLength(2);
  });

  it("is deterministic across identical calls", async () => {
    const first = await request(app())
      .post(`/books/${bookId}/simulation/reader-panel`)
      .set(headers(user));
    const second = await request(app())
      .post(`/books/${bookId}/simulation/reader-panel`)
      .set(headers(user));
    expect(second.body.report).toEqual(first.body.report);
  });

  it("accepts custom personas and rejects malformed ones", async () => {
    const custom = await request(app())
      .post(`/books/${bookId}/simulation/reader-panel`)
      .set(headers(user))
      .send({ personas: [{ name: "Speed reader", attentionSpanChapters: 1 }] });
    expect(custom.status).toBe(200);
    expect(custom.body.report.readers).toHaveLength(1);
    const bad = await request(app())
      .post(`/books/${bookId}/simulation/reader-panel`)
      .set(headers(user))
      .send({ personas: [{ name: "" }] });
    expect(bad.status).toBe(400);
  });

  it("scopes to the owner", async () => {
    const foreign = await request(app())
      .post(`/books/${bookId}/simulation/reader-panel`)
      .set(headers(other));
    expect(foreign.status).toBe(200);
    expect(foreign.body.report.readers[0].completion).toBe(1); // no chapters visible
  });
});
