/**
 * G-04b — library (books) route contract tests. Live Postgres required
 * (INKFORGE_PG_TEST=1). Unique principals per suite keep rows isolated.
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { books, createDb, type DbHandle } from "@inkforge/db";

const ENABLED = process.env.INKFORGE_PG_TEST === "1";
const DB_URL =
  process.env.FORGE_TEST_DATABASE_URL ?? "postgres://inkforge:inkforge@localhost:5432/inkforge";
const SECRET = "neg3-test-secret";
const d = describe.skipIf(!ENABLED);

function headers(user: string) {
  return { "x-forge-secret": SECRET, "x-forge-user": user };
}

const VALID_BOOK = {
  title: "The Forge Lights",
  author: "Mara Vane",
  genre: "Fantasy",
  description: "A smith wakes the old fire.",
};

d("books API", () => {
  let handle: DbHandle;
  const user = `user-${randomUUID()}`;
  const other = `user-${randomUUID()}`;

  beforeAll(() => {
    handle = createDb(DB_URL, { max: 5 });
  });

  afterAll(async () => {
    await handle.db.delete(books).where(eq(books.userId, user));
    await handle.close();
  });

  function app() {
    return buildApp({
      logLevel: "silent",
      databaseUrl: DB_URL,
      sharedSecret: SECRET,
    });
  }

  it("creates a book from core-validated metadata (201)", async () => {
    const res = await request(app()).post("/books").set(headers(user)).send(VALID_BOOK);
    expect(res.status).toBe(201);
    expect(res.body.book.title).toBe("The Forge Lights");
    expect(res.body.book.language).toBe("en");
    expect(res.body.book.status).toBe("drafting");
  });

  it("rejects invalid metadata with 400", async () => {
    const res = await request(app())
      .post("/books")
      .set(headers(user))
      .send({ title: "", author: "x".repeat(400) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_book");
  });

  it("lists only the principal's books", async () => {
    const mine = await request(app()).get("/books").set(headers(user));
    expect(mine.status).toBe(200);
    expect(mine.body.books.length).toBeGreaterThanOrEqual(1);
    for (const book of mine.body.books) expect(book.userId).toBe(user);
  });

  it("scopes GET /books/:id by tenant", async () => {
    const created = await request(app()).post("/books").set(headers(user)).send(VALID_BOOK);
    const bookId = created.body.book.id as string;

    const mine = await request(app()).get(`/books/${bookId}`).set(headers(user));
    expect(mine.status).toBe(200);

    const theirs = await request(app()).get(`/books/${bookId}`).set(headers(other));
    expect(theirs.status).toBe(404);
  });

  it("patches owned books and rejects empty patches", async () => {
    const created = await request(app()).post("/books").set(headers(user)).send(VALID_BOOK);
    const bookId = created.body.book.id as string;

    const patched = await request(app())
      .patch(`/books/${bookId}`)
      .set(headers(user))
      .send({ title: "The Forge Lights, Revised", status: "polishing" });
    expect(patched.status).toBe(200);
    expect(patched.body.book.title).toBe("The Forge Lights, Revised");
    expect(patched.body.book.status).toBe("polishing");

    const empty = await request(app()).patch(`/books/${bookId}`).set(headers(user)).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("empty_patch");
  });

  it("deletes owned books and then 404s", async () => {
    const created = await request(app()).post("/books").set(headers(user)).send(VALID_BOOK);
    const bookId = created.body.book.id as string;

    const deleted = await request(app()).delete(`/books/${bookId}`).set(headers(user));
    expect(deleted.status).toBe(200);

    const gone = await request(app()).get(`/books/${bookId}`).set(headers(user));
    expect(gone.status).toBe(404);
  });
});
