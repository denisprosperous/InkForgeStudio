/**
 * G-19 — accessibility editions over HTTP. Live Postgres required
 * (INKFORGE_PG_TEST=1): the audit route reports alt-text/heading coverage
 * plus the EPUB a11y metadata and large-print recipe; the print route's
 * ?edition=large-print path emits a 16pt 7x10 interior.
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

d("accessibility editions API (G-19)", () => {
  let handle: DbHandle;
  const user = `user-${randomUUID()}`;
  let bookId = "";

  beforeAll(async () => {
    handle = createDb(DB_URL, { max: 5 });
    const forgeApp = buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
    const created = await request(forgeApp)
      .post("/books")
      .set(headers(user))
      .send({ title: "Accessible Ember", author: "Dana Pryce" });
    expect(created.status).toBe(201);
    bookId = created.body.book.id;
    const chapter = await request(forgeApp)
      .post(`/books/${bookId}/chapters`)
      .set(headers(user))
      .send({
        title: "The Lamp",
        markdown: `# The Lamp\n\n![A lamp](lamp.png)\n\n${"Mara Vane entered Ashfall. ".repeat(3000)}`,
      });
    expect(chapter.status).toBe(201);
  }, 120_000);

  afterAll(async () => {
    await handle.db.delete(books).where(inArray(books.userId, [user]));
    await handle.db.delete(exports).where(inArray(exports.userId, [user]));
    await handle.close();
  }, 30_000);

  function app() {
    return buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
  }

  it("reports the a11y audit, EPUB metadata and the large-print recipe", async () => {
    const res = await request(app()).get(`/books/${bookId}/accessibility`).set(headers(user));
    expect(res.status).toBe(200);
    expect(res.body.report.imagesTotal).toBe(1);
    expect(res.body.report.imagesMissingAlt).toBe(0);
    expect(res.body.report.score).toBe(1);
    expect(res.body.epubMetadata.map((pair: { property: string }) => pair.property)).toContain(
      "schema:conformsTo",
    );
    expect(res.body.largePrint.bodyFontPt).toBe(16);
    expect(res.body.largePrint.trimId).toBe("7x10");
  });

  it("emits a deterministic 16pt large-print PDF", async () => {
    const first = await request(app())
      .get(`/books/${bookId}/print?edition=large-print`)
      .set(headers(user))
      .responseType("arraybuffer");
    expect(first.status).toBe(200);
    const buffer = Buffer.from(first.body as ArrayBuffer);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buffer.toString("latin1")).toContain("16 Tf");
    const second = await request(app())
      .get(`/books/${bookId}/print?edition=large-print`)
      .set(headers(user))
      .responseType("arraybuffer");
    expect(Buffer.compare(buffer, Buffer.from(second.body as ArrayBuffer))).toBe(0);
    const list = await request(app()).get(`/books/${bookId}/exports`).set(headers(user));
    const printRows = list.body.exports.filter((row: { kind: string }) => row.kind === "print-pdf");
    expect(
      printRows.some(
        (row: { validation: { edition?: string } }) => row.validation?.edition === "large-print",
      ),
    ).toBe(true);
  });

  it("404s another principal's book", async () => {
    const res = await request(app())
      .get(`/books/${bookId}/accessibility`)
      .set(headers(`user-${randomUUID()}`));
    expect(res.status).toBe(404);
  });
});
