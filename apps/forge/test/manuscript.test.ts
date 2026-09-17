/**
 * G-04c — manuscript route contract tests: chapters, outline, export delivery.
 *
 * Live Postgres required (INKFORGE_PG_TEST=1). Every case asserts either a
 * tenancy boundary (cross-principal 404), a wire-validation boundary (400) or
 * a derived-field invariant (wordCount comes from the frozen core, never the
 * client). Binary export bytes never leak through the list shape.
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import {
  books,
  chapters,
  createDb,
  exports as exportRows,
  saveExport,
  type DbHandle,
} from "@inkforge/db";

const ENABLED = process.env.INKFORGE_PG_TEST === "1";
const DB_URL =
  process.env.FORGE_TEST_DATABASE_URL ?? "postgres://inkforge:inkforge@localhost:5432/inkforge";
const SECRET = "neg3-test-secret";

const d = describe.skipIf(!ENABLED);

function headers(user: string) {
  return { "x-forge-secret": SECRET, "x-forge-user": user };
}

const VALID_BOOK = {
  title: "Quiet Machines",
  author: "Mara Vane",
  genre: "Science Fiction",
  description: "A lighthouse keeper teaches a machine to be alone.",
};

const VALID_OUTLINE = {
  premise: "A lighthouse keeper teaches a machine to be alone.",
  genre: "Science Fiction",
  acts: ["Signal", "Silence"],
  chapters: [
    { idx: 0, title: "The Lamp", brief: "First contact with the machine.", targetWords: 1_500 },
    { idx: 1, title: "The Dark", brief: "The machine asks for a story.", targetWords: 1_200 },
  ],
};

d("manuscript API", () => {
  let handle: DbHandle;
  const user = `user-${randomUUID()}`;
  const other = `user-${randomUUID()}`;
  let bookId = "";

  beforeAll(async () => {
    handle = createDb(DB_URL, { max: 5 });
    const created = await request(app()).post("/books").set(headers(user)).send(VALID_BOOK);
    bookId = created.body.book.id as string;
  });

  afterAll(async () => {
    await handle.db.delete(exportRows).where(eq(exportRows.userId, user));
    await handle.db.delete(chapters).where(eq(chapters.userId, user));
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

  describe("chapters", () => {
    it("creates chapters with an auto-assigned idx (201)", async () => {
      const first = await request(app())
        .post(`/books/${bookId}/chapters`)
        .set(headers(user))
        .send({ title: "The Lamp", markdown: "The lamp turned. Then it turned again." });
      expect(first.status).toBe(201);
      expect(first.body.chapter.idx).toBe(0);
      expect(first.body.chapter.status).toBe("draft");

      const second = await request(app())
        .post(`/books/${bookId}/chapters`)
        .set(headers(user))
        .send({ title: "The Dark" });
      expect(second.status).toBe(201);
      expect(second.body.chapter.idx).toBe(1);
      expect(second.body.chapter.markdown).toBe("");
    });

    it("rejects a malformed chapter with 400", async () => {
      const res = await request(app())
        .post(`/books/${bookId}/chapters`)
        .set(headers(user))
        .send({ title: "" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_chapter");
    });

    it("404s chapter routes scoped to a book the principal does not own", async () => {
      const list = await request(app()).get(`/books/${bookId}/chapters`).set(headers(other));
      expect(list.status).toBe(404);
      expect(list.body.error).toBe("book_not_found");

      const create = await request(app())
        .post(`/books/${bookId}/chapters`)
        .set(headers(other))
        .send({ title: "Intruder" });
      expect(create.status).toBe(404);
    });

    it("400s a non-uuid book id", async () => {
      const res = await request(app()).get("/books/not-a-uuid/chapters").set(headers(user));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_book_id");
    });

    it("patches markdown and derives wordCount from the frozen core", async () => {
      const created = await request(app())
        .post(`/books/${bookId}/chapters`)
        .set(headers(user))
        .send({ title: "Derived" });
      const chapterId = created.body.chapter.id as string;

      const patched = await request(app())
        .patch(`/books/${bookId}/chapters/${chapterId}`)
        .set(headers(user))
        .send({ markdown: "one two three four five", status: "humanized" });
      expect(patched.status).toBe(200);
      expect(patched.body.chapter.wordCount).toBe(5);
      expect(patched.body.chapter.status).toBe("humanized");

      const empty = await request(app())
        .patch(`/books/${bookId}/chapters/${chapterId}`)
        .set(headers(user))
        .send({});
      expect(empty.status).toBe(400);
      expect(empty.body.error).toBe("empty_patch");
    });

    it("reorders chapters and returns the new order", async () => {
      const rows = await request(app()).get(`/books/${bookId}/chapters`).set(headers(user));
      const ids = (rows.body.chapters as { id: string }[]).map((c) => c.id);
      expect(ids.length).toBeGreaterThanOrEqual(2);

      const reversed = [...ids].reverse();
      const res = await request(app())
        .post(`/books/${bookId}/chapters/reorder`)
        .set(headers(user))
        .send({ orderedIds: reversed });
      expect(res.status).toBe(200);
      expect((res.body.chapters as { id: string; idx: number }[]).map((c) => c.id)).toEqual(
        reversed,
      );

      const bad = await request(app())
        .post(`/books/${bookId}/chapters/reorder`)
        .set(headers(user))
        .send({ orderedIds: ["nope"] });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe("invalid_reorder");
    });

    it("deletes a chapter and then 404s", async () => {
      const created = await request(app())
        .post(`/books/${bookId}/chapters`)
        .set(headers(user))
        .send({ title: "Doomed" });
      const chapterId = created.body.chapter.id as string;

      const deleted = await request(app())
        .delete(`/books/${bookId}/chapters/${chapterId}`)
        .set(headers(user));
      expect(deleted.status).toBe(200);

      const gone = await request(app())
        .patch(`/books/${bookId}/chapters/${chapterId}`)
        .set(headers(user))
        .send({ title: "Still here?" });
      expect(gone.status).toBe(404);
      expect(gone.body.error).toBe("chapter_not_found");
    });
  });

  describe("outline", () => {
    it("returns null before an outline exists, then round-trips a saved one", async () => {
      const empty = await request(app()).get(`/books/${bookId}/outline`).set(headers(user));
      expect(empty.status).toBe(200);
      expect(empty.body.outline).toBeNull();

      const saved = await request(app())
        .post(`/books/${bookId}/outline`)
        .set(headers(user))
        .send({ payload: VALID_OUTLINE });
      expect(saved.status).toBe(201);
      expect(saved.body.outline.payload.chapters).toHaveLength(2);

      const latest = await request(app()).get(`/books/${bookId}/outline`).set(headers(user));
      expect(latest.status).toBe(200);
      expect(latest.body.outline.id).toBe(saved.body.outline.id);
    });

    it("rejects an outline that fails the core contract (400)", async () => {
      const res = await request(app())
        .post(`/books/${bookId}/outline`)
        .set(headers(user))
        .send({ payload: { premise: "no chapters" } });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_outline");
    });

    it("scopes outline access to the owning principal", async () => {
      const res = await request(app()).get(`/books/${bookId}/outline`).set(headers(other));
      expect(res.status).toBe(404);
    });
  });

  describe("exports", () => {
    let exportId = "";
    const bytes = Buffer.from("PK\u0003\u0004fake-epub-bytes", "binary");

    beforeAll(async () => {
      const row = await saveExport(handle.db, user, {
        bookId,
        filename: "quiet-machines.epub",
        data: bytes,
        validation: { epubcheck: "passed" },
        expiresAt: null,
      });
      exportId = row.id;
    });

    it("lists export metadata without leaking bytes", async () => {
      const res = await request(app()).get(`/books/${bookId}/exports`).set(headers(user));
      expect(res.status).toBe(200);
      const first = res.body.exports[0] as Record<string, unknown>;
      expect(first.id).toBe(exportId);
      expect(first.filename).toBe("quiet-machines.epub");
      expect(first.sizeBytes).toBe(bytes.byteLength);
      expect(first.validation).toEqual({ epubcheck: "passed" });
      expect(Object.prototype.hasOwnProperty.call(first, "data")).toBe(false);
    });

    it("streams the stored artifact with EPUB headers", async () => {
      const res = await request(app())
        .get(`/exports/${exportId}`)
        .set(headers(user))
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/epub+zip");
      expect(res.headers["content-disposition"]).toContain("quiet-machines.epub");
      expect(Buffer.compare(res.body as Buffer, bytes)).toBe(0);
    });

    it("scopes export list and download to the owning principal", async () => {
      const list = await request(app()).get(`/books/${bookId}/exports`).set(headers(other));
      expect(list.status).toBe(200);
      expect(list.body.exports).toEqual([]);

      const download = await request(app()).get(`/exports/${exportId}`).set(headers(other));
      expect(download.status).toBe(404);
      expect(download.body.error).toBe("export_not_found");
    });

    it("400s a non-uuid export id", async () => {
      const res = await request(app()).get("/exports/not-a-uuid").set(headers(user));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_export_id");
    });
  });
});
