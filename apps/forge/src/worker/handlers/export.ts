/**
 * @inkforge/forge — `book.export` handler (G-17a).
 *
 * Assembles the real artifact from the real rows: book metadata + chapters →
 * buildDisclosedEpub (G-06 disclosure layer, ON for KDP by default) →
 * EPUBCheck when a jar is present (fail-soft skipped otherwise, recorded in
 * the row) → saveExport so the studio can stream it back. This is the
 * terminal step of idea → validated EPUB.
 */
import {
  buildDisclosedEpub,
  chapterSchema,
  parseBookMeta,
  validateEpub,
  type Chapter,
} from "@inkforge/core";
import { getBook, listChapters, saveExport } from "@inkforge/db";
import { z } from "zod";
import { HandlerError, type JobContext } from "../registry";

const exportRequestSchema = z.object({
  format: z.literal("epub").default("epub"),
  validate: z.boolean().default(true),
});

export interface ExportHandlerOptions {
  /** G-06 toggle; default ON (KDP is the only publish target today). */
  readonly disclosure?: boolean | undefined;
}

function toCoreChapters(rows: readonly { [key: string]: unknown }[]): Chapter[] {
  return rows.map((row) =>
    chapterSchema.parse({
      ...row,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : "",
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : "",
    }),
  );
}

/** Build the registered `book.export` handler. */
export function createExportHandler(options: ExportHandlerOptions = {}) {
  return async function handleBookExport(ctx: JobContext): Promise<unknown> {
    const { job, db, logger } = ctx;
    if (job.bookId === null) {
      throw new HandlerError("book.export: job has no bookId", { retryable: false });
    }
    const parsed = exportRequestSchema.safeParse(job.payload ?? {});
    if (!parsed.success || parsed.data.format !== "epub") {
      throw new HandlerError("book.export: unsupported format", { retryable: false });
    }
    const bookRows = await getBook(db, job.userId, job.bookId);
    const book = bookRows[0];
    if (!book) {
      throw new HandlerError("book.export: book not found for principal", { retryable: false });
    }
    const chapterRows = await listChapters(db, job.userId, job.bookId);
    if (chapterRows.length === 0) {
      throw new HandlerError("book.export: cannot export a book with zero chapters", {
        retryable: false,
      });
    }

    const meta = parseBookMeta({
      title: book.title,
      ...(book.subtitle !== null ? { subtitle: book.subtitle } : {}),
      author: book.author,
      description: book.description,
      genre: book.genre,
      keywords: book.keywords,
      language: book.language,
      ...(book.seriesLabel !== null ? { seriesLabel: book.seriesLabel } : {}),
      publishTarget: book.publishTarget,
    });

    const { buffer, manifest } = await buildDisclosedEpub(
      { meta, chapters: toCoreChapters(chapterRows) },
      { enabled: options.disclosure ?? true },
    );

    const validation = parsed.data.validate
      ? await validateEpub(buffer)
      : {
          status: "skipped" as const,
          reason: "validation disabled by request",
          durationMs: 0,
          messages: [],
        };

    const row = await saveExport(db, job.userId, {
      bookId: job.bookId,
      filename: manifest.filename,
      data: buffer,
      validation: { epubcheck: validation.status },
      expiresAt: null,
    });
    logger.info(
      { jobId: job.id, exportId: row.id, bytes: manifest.bytes, validation: validation.status },
      "book.export: artifact stored",
    );
    return {
      exportId: row.id,
      filename: manifest.filename,
      bytes: manifest.bytes,
      words: manifest.words,
      chapters: manifest.chapters,
      disclosure: manifest.aiDisclosure,
      validation: {
        status: validation.status,
        ...(validation.reason !== undefined ? { reason: validation.reason } : {}),
      },
      documentIds: manifest.documentIds,
    };
  };
}
