/**
 * G-10 — print-interior PDF export over HTTP. Live Postgres required
 * (INKFORGE_PG_TEST=1). Trim/paper ride the extra namespace (printTrim,
 * printPaper); the artifact lands in the exports list (kind=print-pdf).
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

d("print PDF export API (G-10)", () => {
  let handle: DbHandle;
  const user = `user-${randomUUID()}`;
  let longBookId = "";
  let shortBookId = "";

  beforeAll(async () => {
    handle = createDb(DB_URL, { max: 5 });
    const app = buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
    const long = await request(app)
      .post("/books")
      .set(headers(user))
      .send({ title: "Print Probe", author: "Dana Pryce" });
    longBookId = long.body.book.id;
    const chapter = await request(app)
      .post(`/books/${longBookId}/chapters`)
      .set(headers(user))
      .send({ title: "The Lamp", markdown: "Mara Vane entered Ashfall. ".repeat(3000) });
    expect(chapter.status).toBe(201);

    const short = await request(app)
      .post("/books")
      .set(headers(user))
      .send({ title: "Pamphlet", author: "Dana Pryce" });
    shortBookId = short.body.book.id;
    await request(app)
      .post(`/books/${shortBookId}/chapters`)
      .set(headers(user))
      .send({ title: "One", markdown: "Tiny." });
  }, 120_000);

  afterAll(async () => {
    await handle.db.delete(books).where(inArray(books.userId, [user]));
    await handle.db.delete(exports).where(inArray(exports.userId, [user]));
    await handle.close();
  }, 30_000);

  function app() {
    return buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
  }

  it("streams a real PDF whose bytes start with %PDF and land in exports", async () => {
    const res = await request(app())
      .get(`/books/${longBookId}/print`)
      .set(headers(user))
      .responseType("arraybuffer");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    const raw = Buffer.from(res.body as ArrayBuffer);
    expect(raw.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const list = await request(app()).get(`/books/${longBookId}/exports`).set(headers(user));
    const kinds = list.body.exports.map((row: { kind: string }) => row.kind);
    expect(kinds).toContain("print-pdf");
  });

  it("422s print_unready for manuscripts under the KDP page floor", async () => {
    const res = await request(app()).get(`/books/${shortBookId}/print`).set(headers(user));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("print_unready");
  });

  it("404s another principal's book", async () => {
    const res = await request(app())
      .get(`/books/${longBookId}/print`)
      .set(headers(`user-${randomUUID()}`));
    expect(res.status).toBe(404);
  });
});
