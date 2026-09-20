/**
 * G-15 — consistency ledger + validator over HTTP. Live Postgres required
 * (INKFORGE_PG_TEST=1). Uses the shared dev database like the other route
 * suites; principals are unique per run so rows stay isolated.
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

const BOOK = { title: "The Ashfall Ledger", author: "Mara Vane", genre: "Fantasy" };

d("consistency API (G-15)", () => {
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
      .post(`/books/${bookId}/chapters`)
      .set(headers(user))
      .send({ title: "The Gate", markdown: "Mara Vane returned. Kessler watched from the wall." });
  }, 60_000);

  afterAll(async () => {
    await handle.db.delete(books).where(inArray(books.userId, [user, other]));
    await handle.close();
  });

  function app() {
    return buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
  }

  it("starts with an empty ledger and a clean report", async () => {
    const get = await request(app()).get(`/books/${bookId}/consistency`).set(headers(user));
    expect(get.status).toBe(200);
    expect(get.body.report.checkedChapters).toBe(2);
    expect(get.body.report.violations).toEqual([]);
    expect(get.body.report.unknownEntities.length).toBeGreaterThan(0);
  });

  it("swaps the ledger atomically and reports the stored facts", async () => {
    const put = await request(app())
      .put(`/books/${bookId}/consistency/facts`)
      .set(headers(user))
      .send({
        facts: [
          {
            kind: "entity",
            name: "Mara Vane",
            aliases: ["Mara"],
            summary: "The smith who wakes the old fire.",
            firstChapter: 0,
            lastChapter: 1,
          },
        ],
      });
    expect(put.status).toBe(200);
    expect(put.body.facts).toHaveLength(1);

    const get = await request(app()).get(`/books/${bookId}/consistency`).set(headers(user));
    expect(get.status).toBe(200);
    expect(get.body.report.violations).toEqual([]);
    expect(get.body.report.unknownEntities).not.toContain("Mara Vane");
    expect(get.body.report.unknownEntities).toContain("Kessler");
  });

  it("rejects malformed ledgers with 400", async () => {
    const put = await request(app())
      .put(`/books/${bookId}/consistency/facts`)
      .set(headers(user))
      .send({ facts: [{ name: "", firstChapter: -1 }] });
    expect(put.status).toBe(400);
    expect(put.body.error).toBe("invalid_ledger");
  });

  it("never leaks another tenant's ledger or report", async () => {
    const get = await request(app()).get(`/books/${bookId}/consistency`).set(headers(other));
    expect(get.status).toBe(200);
    expect(get.body.report.checkedChapters).toBe(0);
    // Cross-tenant PUT swaps the other principal's (empty) scope only —
    // the owner's ledger must survive untouched.
    const put = await request(app())
      .put(`/books/${bookId}/consistency/facts`)
      .set(headers(other))
      .send({ facts: [] });
    expect(put.status).toBe(200);
    const mine = await request(app()).get(`/books/${bookId}/consistency`).set(headers(user));
    expect(mine.body.report.violations).toEqual([]);
    expect(mine.body.report.unknownEntities).not.toContain("Mara Vane");
  });

  it("rejects bad book ids with 400", async () => {
    const get = await request(app()).get("/books/not-a-uuid/consistency").set(headers(user));
    expect(get.status).toBe(400);
  });
});
