/**
 * G-21 — market gate over HTTP + the pre-gen enforcement. Live Postgres
 * required (INKFORGE_PG_TEST=1). A no-go verdict must block generation jobs
 * (409 market_gate_blocked); go/hold let them through.
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { books, createDb, exports, jobs, type DbHandle } from "@inkforge/db";

const ENABLED = process.env.INKFORGE_PG_TEST === "1";
const DB_URL =
  process.env.FORGE_TEST_DATABASE_URL ?? "postgres://inkforge:inkforge@localhost:5432/inkforge";
const SECRET = "neg4-test-secret";
const d = describe.skipIf(!ENABLED);

function headers(user: string) {
  return { "x-forge-secret": SECRET, "x-forge-user": user };
}

const STRONG = {
  niche: "cozy fantasy baking",
  demandScore: 80,
  competitionScore: 30,
  pricePower: 70,
  trendScore: 60,
  sampleSize: 40,
};

const WEAK = {
  niche: "saturated vampire romance",
  demandScore: 20,
  competitionScore: 85,
  pricePower: 20,
  trendScore: 20,
  sampleSize: 60,
};

d("market gate API (G-21)", () => {
  let handle: DbHandle;
  const user = `user-${randomUUID()}`;
  let strongBookId = "";
  let weakBookId = "";

  beforeAll(async () => {
    handle = createDb(DB_URL, { max: 5 });
    const forgeApp = buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
    const strong = await request(forgeApp)
      .post("/books")
      .set(headers(user))
      .send({ title: "Bread and Ember", author: "Dana Pryce" });
    strongBookId = strong.body.book.id;
    const weak = await request(forgeApp)
      .post("/books")
      .set(headers(user))
      .send({ title: "Cold Blood", author: "Dana Pryce" });
    weakBookId = weak.body.book.id;
    expect(strong.status).toBe(201);
    expect(weak.status).toBe(201);
  }, 60_000);

  afterAll(async () => {
    await handle.db.delete(jobs).where(inArray(jobs.userId, [user]));
    await handle.db.delete(exports).where(inArray(exports.userId, [user]));
    await handle.db.delete(books).where(inArray(books.userId, [user]));
    await handle.close();
  }, 30_000);

  function app() {
    return buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
  }

  it("evaluates and stores a go verdict, readable back", async () => {
    const post = await request(app())
      .post(`/books/${strongBookId}/market/gate`)
      .set(headers(user))
      .send(STRONG);
    expect(post.status).toBe(200);
    expect(post.body.gate.verdict).toBe("go");
    expect(post.body.gate.composite).toBe(72);
    const get = await request(app()).get(`/books/${strongBookId}/market/gate`).set(headers(user));
    expect(get.status).toBe(200);
    expect(get.body.gate.verdict).toBe("go");
  });

  it("allows generation jobs when the gate says go", async () => {
    const res = await request(app())
      .post("/jobs")
      .set(headers(user))
      .send({ type: "chapter.generate", bookId: strongBookId });
    expect(res.status).toBe(202);
  });

  it("blocks generation jobs with 409 when the gate says no-go", async () => {
    const post = await request(app())
      .post(`/books/${weakBookId}/market/gate`)
      .set(headers(user))
      .send(WEAK);
    expect(post.status).toBe(200);
    expect(post.body.gate.verdict).toBe("no-go");
    const blocked = await request(app())
      .post("/jobs")
      .set(headers(user))
      .send({ type: "chapter.generate", bookId: weakBookId });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("market_gate_blocked");
    expect(Array.isArray(blocked.body.reasons)).toBe(true);
    // Non-generation work is never gated (exports must remain possible).
    const exportJob = await request(app())
      .post("/jobs")
      .set(headers(user))
      .send({ type: "book.export", bookId: weakBookId });
    expect(exportJob.status).toBe(202);
  });

  it("rejects malformed snapshots and unknown books", async () => {
    const bad = await request(app())
      .post(`/books/${strongBookId}/market/gate`)
      .set(headers(user))
      .send({ niche: "" });
    expect(bad.status).toBe(400);
    const missing = await request(app())
      .get(`/books/${randomUUID()}/market/gate`)
      .set(headers(user));
    expect(missing.status).toBe(404);
  });
});
