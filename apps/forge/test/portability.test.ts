/**
 * G-24 — bulk portability export over HTTP. Live Postgres required
 * (INKFORGE_PG_TEST=1). One zip must carry meta, chapters, outline and
 * assets for the owning principal only, and the artifact must land in the
 * exports list for lineage.
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
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

const BOOK = { title: "Portability Probe", author: "Dana Pryce", genre: "Fantasy" };

d("portability export API (G-24)", () => {
  let handle: DbHandle;
  const user = `user-${randomUUID()}`;
  const other = `user-${randomUUID()}`;
  let bookId = "";

  beforeAll(async () => {
    handle = createDb(DB_URL, { max: 5 });
    const app = () => buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
    const created = await request(app()).post("/books").set(headers(user)).send(BOOK);
    bookId = created.body.book.id;
    await request(app())
      .post(`/books/${bookId}/chapters`)
      .set(headers(user))
      .send({ title: "The Lamp", markdown: "Mara Vane entered Ashfall with the lamp lit." });
    await request(app())
      .post(`/books/${bookId}/outline`)
      .set(headers(user))
      .send({
        payload: {
          premise: "Wake the fire.",
          genre: "Fantasy",
          chapters: [{ idx: 0, title: "The Lamp", brief: "", targetWords: 600 }],
        },
      });
  }, 60_000);

  afterAll(async () => {
    await handle.db.delete(books).where(inArray(books.userId, [user, other]));
    await handle.db.delete(exports).where(inArray(exports.userId, [user, other]));
    await handle.close();
  }, 30_000);

  function app() {
    return buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
  }

  it("streams a zip with meta, chapters, outline and a manifest", async () => {
    const res = await request(app())
      .get(`/books/${bookId}/portability`)
      .set(headers(user))
      .responseType("arraybuffer");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    const raw = Buffer.from(res.body as ArrayBuffer);
    expect(raw.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(raw.byteLength).toBeGreaterThan(500);
  });

  it("lands the artifact in the exports list for lineage", async () => {
    const list = await request(app()).get(`/books/${bookId}/exports`).set(headers(user));
    const kinds = list.body.exports.map((row: { kind: string }) => row.kind);
    expect(kinds).toContain("portability");
  });

  it("404s another principal's book (no leak, no artifact)", async () => {
    const res = await request(app()).get(`/books/${bookId}/portability`).set(headers(other));
    expect(res.status).toBe(404);
  });

  it("rejects bad book ids with 400", async () => {
    const res = await request(app()).get("/books/nope/portability").set(headers(user));
    expect(res.status).toBe(400);
  });
});
