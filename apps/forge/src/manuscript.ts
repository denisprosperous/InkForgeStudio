/**
 * @inkforge/forge — manuscript routes (G-04b): chapters, outlines, exports.
 *
 * Scoped under an owned book; payloads validated; exports lists are
 * metadata-only while downloads stream the stored bytes.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  deleteChapter,
  getBook,
  getExport,
  insertChapter,
  latestOutline,
  listChapters,
  listExports,
  listRevisions,
  reorderChapters,
  restoreRevision,
  saveOutline,
  updateChapter,
} from "@inkforge/db";
import { countWords, parseOutline } from "@inkforge/core";
import { bridgeUser } from "./auth";
import { isBookId, serializeExport, type LibraryRouterOptions } from "./library";

const createChapterSchema = z.object({
  idx: z.number().int().min(0).max(500).optional(),
  title: z.string().min(1).max(300),
  markdown: z.string().max(2_000_000).optional(),
});

const updateChapterSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  markdown: z.string().max(2_000_000).optional(),
  status: z.enum(["draft", "humanized", "final"]).optional(),
  idx: z.number().int().min(0).max(500).optional(),
});

const reorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1).max(500),
});

/** Chapter routes: scoped under a book the principal owns. */
export function createChapterRouter(options: LibraryRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const { db } = options;

  const requireBook = async (req: Request, res: Response): Promise<string | undefined> => {
    const bookId = String(req.params.bookId);
    if (!isBookId(bookId)) {
      res.status(400).json({ error: "invalid_book_id" });
      return undefined;
    }
    const rows = await getBook(db, bridgeUser(req), bookId);
    if (rows.length === 0) {
      res.status(404).json({ error: "book_not_found" });
      return undefined;
    }
    return bookId;
  };

  router.get("/", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const rows = await listChapters(db, bridgeUser(req), bookId);
    res.status(200).json({ chapters: rows });
  });

  router.post("/", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const parsed = createChapterSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_chapter", issues: parsed.error.issues });
      return;
    }
    const existing = await listChapters(db, bridgeUser(req), bookId);
    const chapter = await insertChapter(db, bridgeUser(req), bookId, {
      idx: parsed.data.idx ?? existing.length,
      title: parsed.data.title,
      markdown: parsed.data.markdown ?? "",
    });
    res.status(201).json({ chapter });
  });

  router.patch("/:chapterId", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const chapterId = String(req.params.chapterId);
    if (!isBookId(chapterId)) {
      res.status(400).json({ error: "invalid_chapter_id" });
      return;
    }
    const parsed = updateChapterSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_chapter_patch", issues: parsed.error.issues });
      return;
    }
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) values[key] = value;
    }
    if (values.markdown !== undefined && values.wordCount === undefined) {
      // wordCount is derived by the frozen core, never trusted from the wire.
      values.wordCount = countWords(String(values.markdown));
    }
    if (Object.keys(values).length === 0) {
      res.status(400).json({ error: "empty_patch" });
      return;
    }
    const chapter = await updateChapter(db, bridgeUser(req), bookId, chapterId, values);
    if (!chapter) {
      res.status(404).json({ error: "chapter_not_found" });
      return;
    }
    res.status(200).json({ chapter });
  });

  router.delete("/:chapterId", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const chapterId = String(req.params.chapterId);
    if (!isBookId(chapterId)) {
      res.status(400).json({ error: "invalid_chapter_id" });
      return;
    }
    const deleted = await deleteChapter(db, bridgeUser(req), bookId, chapterId);
    if (!deleted) {
      res.status(404).json({ error: "chapter_not_found" });
      return;
    }
    res.status(200).json({ deleted: true });
  });

  router.get("/:chapterId/revisions", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const chapterId = String(req.params.chapterId);
    if (!isBookId(chapterId)) {
      res.status(400).json({ error: "invalid_chapter_id" });
      return;
    }
    const rows = await listRevisions(db, bridgeUser(req), bookId, chapterId);
    res.status(200).json({ revisions: rows });
  });

  router.post("/:chapterId/revisions/:revisionId/restore", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const chapterId = String(req.params.chapterId);
    const revisionId = String(req.params.revisionId);
    if (!isBookId(chapterId) || !isBookId(revisionId)) {
      res.status(400).json({ error: "invalid_revision_id" });
      return;
    }
    const restored = await restoreRevision(db, bridgeUser(req), bookId, chapterId, revisionId);
    if (!restored) {
      res.status(404).json({ error: "revision_not_found" });
      return;
    }
    res.status(200).json({ chapter: restored });
  });

  router.post("/reorder", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const parsed = reorderSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_reorder", issues: parsed.error.issues });
      return;
    }
    await reorderChapters(db, bridgeUser(req), bookId, parsed.data.orderedIds);
    const rows = await listChapters(db, bridgeUser(req), bookId);
    res.status(200).json({ chapters: rows });
  });

  return router;
}
/** Outline + export routes (G-04b). */
export function createOutlineRouter(options: LibraryRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const { db } = options;

  const requireBook = async (req: Request, res: Response): Promise<string | undefined> => {
    const bookId = String(req.params.bookId);
    if (!isBookId(bookId)) {
      res.status(400).json({ error: "invalid_book_id" });
      return undefined;
    }
    const rows = await getBook(db, bridgeUser(req), bookId);
    if (rows.length === 0) {
      res.status(404).json({ error: "book_not_found" });
      return undefined;
    }
    return bookId;
  };

  router.get("/", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const rows = await latestOutline(db, bridgeUser(req), bookId);
    const outline = rows[0];
    res.status(outline ? 200 : 200).json({ outline: outline ?? null });
  });

  router.post("/", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    let outline: unknown;
    try {
      outline = parseOutline(req.body?.payload ?? req.body);
    } catch {
      res.status(400).json({ error: "invalid_outline" });
      return;
    }
    const saved = await saveOutline(db, bridgeUser(req), bookId, outline);
    res.status(201).json({ outline: saved });
  });

  return router;
}

/** Export list + binary download (metadata list never carries bytes). */
export function createExportsRouter(options: LibraryRouterOptions): Router {
  const router = Router();
  const { db } = options;

  router.get("/books/:bookId/exports", async (req: Request, res: Response) => {
    const bookId = String(req.params.bookId);
    if (!isBookId(bookId)) {
      res.status(400).json({ error: "invalid_book_id" });
      return;
    }
    const rows = await listExports(db, bridgeUser(req), bookId);
    res.status(200).json({ exports: rows.map(serializeExport) });
  });

  router.get("/exports/:exportId", async (req: Request, res: Response) => {
    const exportId = String(req.params.exportId);
    if (!isBookId(exportId)) {
      res.status(400).json({ error: "invalid_export_id" });
      return;
    }
    const rows = await getExport(db, bridgeUser(req), exportId);
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "export_not_found" });
      return;
    }
    const mime =
      row.kind === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : row.kind === "audio-script"
          ? "text/plain; charset=utf-8"
          : row.kind === "kpf"
            ? "application/x-kpf"
            : "application/epub+zip";
    res.status(200);
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${row.filename}"`);
    res.setHeader("Content-Length", String(row.sizeBytes));
    res.send(Buffer.from(row.data));
  });

  return router;
}
