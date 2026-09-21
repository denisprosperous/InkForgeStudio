/**
 * G-26 — series bible over HTTP. Live Postgres required (INKFORGE_PG_TEST=1).
 * Two books sharing a seriesLabel merge their consistency ledgers into one
 * franchise bible; cross-tenant series are invisible.
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { books, consistencyFacts, createDb, type DbHandle } from "@inkforge/db";

const ENABLED = process.env.INKFORGE_PG_TEST === "1";
const DB_URL =
  process.env.FORGE_TEST_DATABASE_URL ?? "postgres://inkforge:inkforge@localhost:5432/inkforge";
const SECRET = "neg4-test-secret";
const d = describe.skipIf(!ENABLED);

function headers(user: string) {
  return { "x-forge-secret": SECRET, "x-forge-user": user };
}

d("series bible API (G-26)", () => {
  let handle: DbHandle;
  const user = `user-${randomUUID()}`;
  const other = `user-${randomUUID()}`;
  let bookOneId = "";
  let bookTwoId = "";
  let standaloneId = "";

  beforeAll(async () => {
    handle = createDb(DB_URL, { max: 5 });
    const forgeApp = buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
    const one = await request(forgeApp)
      .post("/books")
      .set(headers(user))
      .send({ title: "A Study in Ember", author: "Dana Pryce", seriesLabel: "The Ember Cycle" });
    bookOneId = one.body.book.id;
    const two = await request(forgeApp)
      .post("/books")
      .set(headers(user))
      .send({ title: "The Gate Below", author: "Dana Pryce", seriesLabel: "The Ember Cycle" });
    bookTwoId = two.body.book.id;
    const standalone = await request(forgeApp)
      .post("/books")
      .set(headers(user))
      .send({ title: "Standalone", author: "Dana Pryce" });
    standaloneId = standalone.body.book.id;
    expect(one.status).toBe(201);
    expect(standalone.status).toBe(201);

    const facts = [
      {
        kind: "entity",
        name: "Mara Vane",
        aliases: ["Mara"],
        summary: "The smith.",
        firstChapter: 0,
        lastChapter: 1,
      },
      {
        kind: "entity",
        name: "Orella Vex",
        aliases: [],
        summary: "A cartographer.",
        firstChapter: 1,
        lastChapter: 1,
      },
    ];
    const saved = await request(forgeApp)
      .put(`/books/${bookOneId}/consistency/facts`)
      .set(headers(user))
      .send({ facts });
    expect(saved.status).toBe(200);
    const rival = await request(forgeApp)
      .put(`/books/${bookTwoId}/consistency/facts`)
      .set(headers(user))
      .send({
        facts: [
          {
            kind: "entity",
            name: "Mara Vane",
            aliases: [],
            summary: "The smith.",
            firstChapter: 0,
            lastChapter: 0,
          },
        ],
      });
    expect(rival.status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await handle.db.delete(consistencyFacts).where(inArray(consistencyFacts.userId, [user, other]));
    await handle.db.delete(books).where(inArray(books.userId, [user, other]));
    await handle.close();
  }, 30_000);

  function app() {
    return buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
  }

  it("merges sibling books into one franchise bible", async () => {
    const res = await request(app()).get(`/books/${bookOneId}/series-bible`).set(headers(user));
    expect(res.status).toBe(200);
    expect(res.body.bible.seriesLabel).toBe("The Ember Cycle");
    expect(res.body.bible.stats.books).toBe(2);
    const mara = res.body.bible.sharedEntities.find(
      (entity: { name: string }) => entity.name.toLowerCase() === "mara vane",
    );
    expect(mara.appearances).toHaveLength(2);
    expect(res.body.bible.openThreads.map((thread: { name: string }) => thread.name)).toContain(
      "Orella Vex",
    );
  });

  it("answers 400 for books without a series label", async () => {
    const res = await request(app()).get(`/books/${standaloneId}/series-bible`).set(headers(user));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("no_series_label");
  });

  it("never merges another tenant's series", async () => {
    await request(app())
      .post("/books")
      .set(headers(other))
      .send({ title: "Rival Ember", author: "Someone Else", seriesLabel: "The Ember Cycle" });
    const mine = await request(app()).get(`/books/${bookOneId}/series-bible`).set(headers(user));
    expect(mine.body.bible.stats.books).toBe(2);
    const theirs = await request(app()).get(`/books/${bookTwoId}/series-bible`).set(headers(other));
    expect(theirs.status).toBe(404);
    void eq;
  });
});
