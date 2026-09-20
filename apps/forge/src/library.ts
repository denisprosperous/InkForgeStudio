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
  getCover,
  listAssets,
  listBooks,
  listChapters,
  listCoverVersions,
  latestOutline,
  saveExport,
  updateBook,
  type Database,
  type ExportRow,
} from "@inkforge/db";
import {
  auditAccessibility,
  bookMetaSchema,
  buildOnix30,
  buildPortabilityBundle,
  buildPrintInterior,
  distributionIdentifierSchema,
  epubAccessibilityMetadata,
  largePrintOptions,
  type ProductMetadata,
} from "@inkforge/core";
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

  /** G-24: bulk portability export — everything the user owns, one zip. */
  router.get("/books/:bookId/portability", async (req: Request, res: Response) => {
    const bookId = String(req.params.bookId);
    if (!isBookId(bookId)) {
      res.status(400).json({ error: "invalid_book_id" });
      return;
    }
    const user = bridgeUser(req);
    const bookRows = await getBook(db, user, bookId);
    const book = bookRows[0];
    if (!book) {
      res.status(404).json({ error: "book_not_found" });
      return;
    }
    const [chapters, outlineRows, assetRows, coverRow] = await Promise.all([
      listChapters(db, user, bookId),
      latestOutline(db, user, bookId),
      listAssets(db, user, bookId),
      getCover(db, user, bookId),
    ]);
    const cover = coverRow[0];
    const coverVersionRows = cover ? await listCoverVersions(db, user, cover.id) : [];
    const outline = outlineRows[0];

    const bundle = buildPortabilityBundle({
      user,
      books: [
        {
          id: book.id,
          title: book.title,
          subtitle: book.subtitle,
          author: book.author,
          description: book.description,
          genre: book.genre,
          keywords: Array.isArray(book.keywords) ? book.keywords.map(String) : [],
          language: book.language,
          seriesLabel: book.seriesLabel,
          publishTarget: book.publishTarget,
          status: book.status,
          extra: book.extra,
          createdAt: book.createdAt.toISOString(),
          updatedAt: book.updatedAt.toISOString(),
        },
      ],
      chapters: chapters.map((chapter) => ({
        id: chapter.id,
        bookId: chapter.bookId,
        idx: chapter.idx,
        title: chapter.title,
        markdown: chapter.markdown,
        status: chapter.status,
        wordCount: chapter.wordCount,
      })),
      outlines: outline ? [{ bookId, payload: outline.payload }] : [],
      covers: coverVersionRows.map((version) => ({
        bookId,
        filename: `cover-v${version.version}.png`,
        data: version.image,
      })),
      assets: assetRows.map((asset) => ({
        bookId,
        filename: asset.filename,
        data: asset.data,
      })),
    });

    const filename = `portability-${book.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 50)}.zip`;
    await saveExport(db, user, {
      bookId,
      kind: "portability",
      filename,
      data: bundle.archive,
      validation: { manifest: bundle.manifest },
    });

    res.status(200);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(bundle.archive.byteLength));
    res.send(bundle.archive);
  });

  /** G-18: ONIX 3.0 export — wide-distribution trade metadata. */
  router.get("/books/:bookId/onix", async (req: Request, res: Response) => {
    const bookId = String(req.params.bookId);
    if (!isBookId(bookId)) {
      res.status(400).json({ error: "invalid_book_id" });
      return;
    }
    const user = bridgeUser(req);
    const book = (await getBook(db, user, bookId))[0];
    if (!book) {
      res.status(404).json({ error: "book_not_found" });
      return;
    }
    const parsedIds = distributionIdentifierSchema.safeParse(
      isRecord(book.extra) ? book.extra.identifiers : undefined,
    );
    let xml: string;
    try {
      xml = buildOnix30({
        meta: {
          title: book.title,
          subtitle: book.subtitle ?? undefined,
          author: book.author,
          description: book.description,
          genre: book.genre,
          keywords: Array.isArray(book.keywords) ? book.keywords.map(String) : [],
          language: book.language,
          seriesLabel: book.seriesLabel ?? undefined,
          publishTarget: "kdp",
          extra: {},
        },
        product: isRecord(book.extra) ? (book.extra.product as ProductMetadata) : undefined,
        ...(parsedIds.success ? { identifier: parsedIds.data } : {}),
      });
    } catch (error) {
      res.status(422).json({
        error: "onix_unready",
        reason: error instanceof Error ? error.message : "unknown",
      });
      return;
    }
    const filename = `onix-${book.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40)}.xml`;
    await saveExport(db, user, { bookId, kind: "onix", filename, data: Buffer.from(xml, "utf8") });
    res.status(200);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(xml);
  });

  /** G-10: print-interior PDF (trim/bleed/spine) export. */
  router.get("/books/:bookId/print", async (req: Request, res: Response) => {
    const bookId = String(req.params.bookId);
    if (!isBookId(bookId)) {
      res.status(400).json({ error: "invalid_book_id" });
      return;
    }
    const user = bridgeUser(req);
    const book = (await getBook(db, user, bookId))[0];
    if (!book) {
      res.status(404).json({ error: "book_not_found" });
      return;
    }
    const chapters = await listChapters(db, user, bookId);
    const extra = isRecord(book.extra) ? book.extra : {};
    const largePrint = String(req.query.edition ?? "") === "large-print";
    const trimId = largePrint
      ? largePrintOptions(extra.printPaper === "cream" ? "cream" : "white").trimId
      : typeof extra.printTrim === "string"
        ? extra.printTrim
        : "6x9";
    const paper = extra.printPaper === "cream" ? "cream" : "white";
    let pdf: Buffer;
    let pages: number;
    try {
      const interior = buildPrintInterior(
        book.title,
        book.author,
        trimId,
        chapters
          .sort((a, b) => a.idx - b.idx)
          .map((chapter) => ({ title: chapter.title, markdown: printBody(chapter.markdown) })),
        largePrint ? largePrintOptions(paper) : { paper },
      );
      pdf = interior.pdf;
      pages = interior.pages;
    } catch (error) {
      res.status(422).json({
        error: "print_unready",
        reason: error instanceof Error ? error.message : "unknown",
      });
      return;
    }
    const filename = `print-${book.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40)}.pdf`;
    await saveExport(db, user, {
      bookId,
      kind: "print-pdf",
      filename,
      data: pdf,
      validation: { pages, trim: trimId, paper, edition: largePrint ? "large-print" : "standard" },
    });
    res.status(200);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(pdf.byteLength));
    res.send(pdf);
  });

  /** G-19: accessibility audit + large-print edition recipe. */
  router.get("/books/:bookId/accessibility", async (req: Request, res: Response) => {
    const bookId = String(req.params.bookId);
    if (!isBookId(bookId)) {
      res.status(400).json({ error: "invalid_book_id" });
      return;
    }
    const user = bridgeUser(req);
    const book = (await getBook(db, user, bookId))[0];
    if (!book) {
      res.status(404).json({ error: "book_not_found" });
      return;
    }
    const chapters = await listChapters(db, user, bookId);
    const report = auditAccessibility(
      chapters
        .sort((a, b) => a.idx - b.idx)
        .map((chapter) => ({ title: chapter.title, markdown: chapter.markdown })),
    );
    res.status(200).json({
      report,
      epubMetadata: epubAccessibilityMetadata({ language: book.language }),
      largePrint: largePrintOptions(),
    });
  });

  return router;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strip structural markdown for print body flow (headings become plain lines). */
function printBody(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .replace(/[*_`>]/g, "");
}
