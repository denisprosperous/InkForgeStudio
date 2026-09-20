/**
 * G-18 — ONIX 3.0 export over HTTP. Live Postgres required
 * (INKFORGE_PG_TEST=1). The identifiers namespace rides in book.meta.extra
 * (G-13); the route turns stored meta + product + identifiers into the
 * trade XML and lands it in the exports list.
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { books, createDb, exports, type DbHandle } from "@inkforge/db";

const ENABLED = process.env.INKFORGE_PG_TEST === "1";
const DB_URL =
  process.env.FORGE_TEST_DATABASE_URL ?? "postgres://inkforge:inkforge@localhost:5432/inkforge";
const SECRET = "neg4-test-secret";
const d = describe.skipIf(!ENABLED);

function headers(user: string) {
  return { "x-forge-secret": SECRET, "x-forge-user": user };
}

d("ONIX export API (G-18)", () => {
  let handle: DbHandle;
  const user = `user-${randomUUID()}`;
  let bookId = "";

  beforeAll(async () => {
    handle = createDb(DB_URL, { max: 5 });
    const app = buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
    const created = await request(app)
      .post("/books")
      .set(headers(user))
      .send({ title: "Trade Winds", author: "Dana Pryce", genre: "Fantasy" });
    bookId = created.body.book.id;
    // Seed the identifiers namespace directly via the merge-patch route.
    const patched = await request(app)
      .patch(`/books/${bookId}`)
      .set(headers(user))
      .send({ extra: { identifiers: { isbn13: "9780306406157" } } });
    expect(patched.status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await handle.db.delete(books).where(inArray(books.userId, [user]));
    await handle.db.delete(exports).where(inArray(exports.userId, [user]));
    await handle.close();
  }, 30_000);

  function app() {
    return buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
  }

  it("emits an ONIX 3.0 XML artifact carrying the stored ISBN", async () => {
    const res = await request(app()).get(`/books/${bookId}/onix`).set(headers(user));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/xml");
    expect(res.text).toContain('<ONIXMessage release="3.0"');
    expect(res.text).toContain("<IDValue>9780306406157</IDValue>");
  });

  it("lands the artifact in the exports list (kind=onix)", async () => {
    const list = await request(app()).get(`/books/${bookId}/exports`).set(headers(user));
    const kinds = list.body.exports.map((row: { kind: string }) => row.kind);
    expect(kinds).toContain("onix");
  });

  it("422s with onix_unready when no identifier was ever set", async () => {
    const other = buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
    const created = await request(other)
      .post("/books")
      .set(headers(user))
      .send({ title: "No Id", author: "Dana Pryce" });
    const res = await request(other).get(`/books/${created.body.book.id}/onix`).set(headers(user));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("onix_unready");
    await handle.db.delete(books).where(eq(books.id, created.body.book.id));
  });
});
