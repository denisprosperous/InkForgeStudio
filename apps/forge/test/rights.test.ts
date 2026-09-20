/**
 * G-09b — rights & licensing + corpus retrieval over HTTP. Live Postgres
 * required (INKFORGE_PG_TEST=1). Rights are revocable (status flip, never a
 * hard delete); corpus ingest is deterministic chunking and search is the
 * core token-overlap scorer.
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { books, corpusChunks, createDb, rightsRecords, type DbHandle } from "@inkforge/db";

const ENABLED = process.env.INKFORGE_PG_TEST === "1";
const DB_URL =
  process.env.FORGE_TEST_DATABASE_URL ?? "postgres://inkforge:inkforge@localhost:5432/inkforge";
const SECRET = "neg4-test-secret";
const d = describe.skipIf(!ENABLED);

function headers(user: string) {
  return { "x-forge-secret": SECRET, "x-forge-user": user };
}

d("rights & corpus API (G-09b)", () => {
  let handle: DbHandle;
  const user = `user-${randomUUID()}`;
  const other = `user-${randomUUID()}`;
  let bookId = "";
  let recordId = "";

  beforeAll(async () => {
    handle = createDb(DB_URL, { max: 5 });
    const forgeApp = buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
    const created = await request(forgeApp)
      .post("/books")
      .set(headers(user))
      .send({ title: "Rights Probe", author: "Dana Pryce" });
    bookId = created.body.book.id;
    expect(created.status).toBe(201);
  }, 60_000);

  afterAll(async () => {
    await handle.db.delete(rightsRecords).where(inArray(rightsRecords.userId, [user, other]));
    await handle.db.delete(corpusChunks).where(inArray(corpusChunks.userId, [user, other]));
    await handle.db.delete(books).where(inArray(books.userId, [user, other]));
    await handle.close();
  }, 30_000);

  function app() {
    return buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
  }

  it("creates a rights record with defaults and lists it", async () => {
    const post = await request(app())
      .post(`/books/${bookId}/rights`)
      .set(headers(user))
      .send({ kind: "license", title: "Audiobook rights", holder: "Northlight Audio" });
    expect(post.status).toBe(201);
    expect(post.body.record.territory).toBe("world");
    expect(post.body.record.status).toBe("active");
    recordId = post.body.record.id;
    const list = await request(app()).get(`/books/${bookId}/rights`).set(headers(user));
    expect(list.body.records).toHaveLength(1);
  });

  it("revokes by status flip and keeps the row (evidence, not deletion)", async () => {
    const flip = await request(app())
      .post(`/books/${bookId}/rights/${recordId}/status`)
      .set(headers(user))
      .send({ status: "revoked" });
    expect(flip.status).toBe(200);
    expect(flip.body.record.status).toBe("revoked");
    const list = await request(app()).get(`/books/${bookId}/rights`).set(headers(user));
    expect(list.body.records).toHaveLength(1);
  });

  it("ingests a corpus source with deterministic chunks and searches it", async () => {
    const ingest = await request(app())
      .post(`/books/${bookId}/rights/corpus`)
      .set(headers(user))
      .send({
        source: "chapter-1",
        text: `Mara Vane forged the lamp in Ashfall.\n\n${"The gate of Ashfall opened at dawn. ".repeat(30)}`,
      });
    expect(ingest.status).toBe(201);
    expect(ingest.body.chunks).toBeGreaterThan(0);
    const search = await request(app())
      .get(`/books/${bookId}/rights/corpus/search`)
      .query({ q: "dawn", limit: 2 })
      .set(headers(user));
    expect(search.status).toBe(200);
    expect(search.body.hits.length).toBeGreaterThan(0);
    expect(search.body.hits[0].source).toBe("chapter-1");
    // Re-ingesting the same source replaces it (idempotent, no duplicates).
    const again = await request(app())
      .post(`/books/${bookId}/rights/corpus`)
      .set(headers(user))
      .send({ source: "chapter-1", text: "Only one line now." });
    expect(again.status).toBe(201);
    expect(again.body.chunks).toBe(1);
  });

  it("rejects malformed records/statuses and hides other tenants", async () => {
    const bad = await request(app())
      .post(`/books/${bookId}/rights`)
      .set(headers(user))
      .send({ kind: "nope", title: "t", holder: "h" });
    expect(bad.status).toBe(400);
    const badStatus = await request(app())
      .post(`/books/${bookId}/rights/${recordId}/status`)
      .set(headers(user))
      .send({ status: "maybe" });
    expect(badStatus.status).toBe(400);
    const foreign = await request(app()).get(`/books/${bookId}/rights`).set(headers(other));
    expect(foreign.status).toBe(404);
  });
});
