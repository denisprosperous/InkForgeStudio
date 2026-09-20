/**
 * @inkforge/forge — library routes (G-04b): books, chapters, outlines, exports.
 *
 * The CRUD surface the studio UI talks through the web bridge. Every route is
 * bridge-authenticated and principal-scoped; every payload is zod-validated
 * against the frozen core contracts where one exists.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  createBook,
  deleteBook,
  getBook,
  listBooks,
  updateBook,
  type Database,
  type ExportRow,
} from "@inkforge/db";
import { bookMetaSchema } from "@inkforge/core";
import { bridgeUser } from "./auth";

export interface LibraryRouterOptions {
  readonly db: Database;
}

const updateBookSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  subtitle: z.string().max(300).nullable().optional(),
  author: z.string().min(1).max(200).optional(),
  description: z.string().max(4_000).optional(),
  genre: z.string().min(1).max(120).optional(),
  keywords: z.array(z.string().min(1).max(80)).max(12).optional(),
  language: z.string().min(2).max(12).optional(),
  seriesLabel: z.string().max(160).nullable().optional(),
  status: z.string().min(1).max(40).optional(),
  /** G-13: namespaced metadata extension; repo merges instead of clobbering. */
  extra: z.record(z.string().min(1).max(64), z.unknown()).optional(),
});

export const isBookId = (value: string) => z.string().uuid().safeParse(value).success;

/** Export rows carry binary data — the list shape must stay metadata-only. */
export function serializeExport(row: ExportRow): Record<string, unknown> {
  return {
    id: row.id,
    userId: row.userId,
    bookId: row.bookId,
    kind: row.kind,
    filename: row.filename,
    sizeBytes: row.sizeBytes,
    validation: row.validation,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
/** Build the authenticated library router. Mount under bridge auth. */
export function createLibraryRouter(options: LibraryRouterOptions): Router {
  const router = Router();
  const { db } = options;

  router.get("/books", async (req: Request, res: Response) => {
    const rows = await listBooks(db, bridgeUser(req));
    res.status(200).json({ books: rows });
  });

  router.post("/books", async (req: Request, res: Response) => {
    const parsed = bookMetaSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_book", issues: parsed.error.issues });
      return;
    }
    const meta = parsed.data;
    const book = await createBook(db, bridgeUser(req), {
      title: meta.title,
      author: meta.author,
      description: meta.description,
      genre: meta.genre,
      keywords: meta.keywords,
      language: meta.language,
      ...(meta.subtitle !== undefined ? { subtitle: meta.subtitle } : {}),
      ...(meta.seriesLabel !== undefined ? { seriesLabel: meta.seriesLabel } : {}),
      ...(Object.keys(meta.extra).length > 0 ? { extra: meta.extra } : {}),
    });
    res.status(201).json({ book });
  });

  router.get("/books/:bookId", async (req: Request, res: Response) => {
    const bookId = String(req.params.bookId);
    if (!isBookId(bookId)) {
      res.status(400).json({ error: "invalid_book_id" });
      return;
    }
    const rows = await getBook(db, bridgeUser(req), bookId);
    const book = rows[0];
    if (!book) {
      res.status(404).json({ error: "book_not_found" });
      return;
    }
    res.status(200).json({ book });
  });

  router.patch("/books/:bookId", async (req: Request, res: Response) => {
    const bookId = String(req.params.bookId);
    if (!isBookId(bookId)) {
      res.status(400).json({ error: "invalid_book_id" });
      return;
    }
    const parsed = updateBookSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_book_patch", issues: parsed.error.issues });
      return;
    }
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) values[key] = value;
    }
    if (Object.keys(values).length === 0) {
      res.status(400).json({ error: "empty_patch" });
      return;
    }
    const book = await updateBook(db, bridgeUser(req), bookId, values);
    if (!book) {
      res.status(404).json({ error: "book_not_found" });
      return;
    }
    res.status(200).json({ book });
  });

  router.delete("/books/:bookId", async (req: Request, res: Response) => {
    const bookId = String(req.params.bookId);
    if (!isBookId(bookId)) {
      res.status(400).json({ error: "invalid_book_id" });
      return;
    }
    const deleted = await deleteBook(db, bridgeUser(req), bookId);
    if (!deleted) {
      res.status(404).json({ error: "book_not_found" });
      return;
    }
    res.status(200).json({ deleted: true });
  });

  return router;
}
