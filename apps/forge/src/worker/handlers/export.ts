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
  buildAudioScript,
  buildDisclosedEpub,
  buildDocx,
  buildKpf,
  chapterSchema,
  parseBookMeta,
  validateEpub,
  type Chapter,
} from "@inkforge/core";
import { getBook, listChapters, saveExport } from "@inkforge/db";
import { z } from "zod";
import { HandlerError, type JobContext } from "../registry";

const exportRequestSchema = z.object({
  format: z.enum(["epub", "docx", "audio-script", "kpf"]).default("epub"),
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
    if (!parsed.success) {
      throw new HandlerError(
        `book.export: invalid payload (${parsed.error.issues[0]?.message ?? "invalid"})`,
        { retryable: false },
      );
    }
    const format = parsed.data.format;
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

    const chapters = toCoreChapters(chapterRows);
    const disclosureOptions = { enabled: options.disclosure ?? true };

    // The EPUB is the only validated path (EPUBCheck); the other formats are
    // deterministic builds from the same rows — no network, no side effects.
    let buffer: Buffer;
    let manifest: {
      filename: string;
      bytes: number;
      words: number;
      chapters: number;
      aiDisclosure: boolean;
      documentIds: readonly string[];
    };
    if (format === "epub") {
      const epub = await buildDisclosedEpub({ meta, chapters }, disclosureOptions);
      buffer = epub.buffer;
      manifest = {
        filename: epub.manifest.filename,
        bytes: epub.manifest.bytes,
        words: epub.manifest.words,
        chapters: epub.manifest.chapters,
        aiDisclosure: epub.manifest.aiDisclosure,
        documentIds: epub.manifest.documentIds,
      };
    } else if (format === "docx") {
      const docx = buildDocx({ meta, chapters }, disclosureOptions);
      buffer = docx.buffer;
      manifest = {
        filename: docx.manifest.filename,
        bytes: docx.manifest.bytes,
        words: docx.manifest.words,
        chapters: docx.manifest.chapters,
        aiDisclosure: docx.manifest.aiDisclosure,
        documentIds: (docx.manifest.detail.parts as string[]) ?? [],
      };
    } else if (format === "audio-script") {
      const script = buildAudioScript({ meta, chapters });
      buffer = Buffer.from(script.text, "utf8");
      manifest = {
        filename: script.manifest.filename,
        bytes: Buffer.byteLength(script.text),
        words: script.manifest.words,
        chapters: script.manifest.chapters,
        aiDisclosure: false,
        documentIds: [],
      };
    } else {
      const kpf = buildKpf({ meta, chapters }, disclosureOptions);
      buffer = kpf.buffer;
      manifest = {
        filename: kpf.manifest.filename,
        bytes: kpf.manifest.bytes,
        words: kpf.manifest.words,
        chapters: kpf.manifest.chapters,
        aiDisclosure: kpf.manifest.aiDisclosure,
        documentIds: (kpf.manifest.detail.entries as string[]) ?? [],
      };
    }

    // Only the EPUB carries the EPUBCheck gate; the other formats record
    // why validation was skipped so the row never looks silently unvalidated.
    const validation =
      format === "epub"
        ? parsed.data.validate
          ? await validateEpub(buffer)
          : {
              status: "skipped" as const,
              reason: "validation disabled by request",
              durationMs: 0,
              messages: [],
            }
        : {
            status: "skipped" as const,
            reason: `${format} has no epubcheck gate`,
            durationMs: 0,
            messages: [],
          };

    const row = await saveExport(db, job.userId, {
      bookId: job.bookId,
      filename: manifest.filename,
      data: buffer,
      kind: format,
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
