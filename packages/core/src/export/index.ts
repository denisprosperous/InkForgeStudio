/**
 * @inkforge/core/export — assemble a KDP-compliant EPUB from a manuscript.
 *
 * Wraps epub-gen-memory behind a narrow, testable interface and layers on the
 * Inkforge conventions: deterministic filenames, word-count stats and a
 * manifest that the forge worker stores alongside the binary. Front matter
 * (title page, copyright) is excluded from the generated TOC; chapters carry
 * their own numbered headings so the TOC never double-numbers.
 */
import { EPub, type Chapter as EpubChapter, type Options as EpubOptions } from "epub-gen-memory";
import type { BookMeta, Chapter } from "../book/index";
import { countWords, slugify } from "../book/index";
import { assembleContentDocuments, EPUB_CSS, type ContentDocument } from "../formatting/index";

export class ExportError extends Error {
  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ExportError";
    if (cause !== undefined) this.cause = cause;
  }
}

export interface ExportRequest {
  readonly meta: BookMeta;
  readonly chapters: readonly Chapter[];
  /** KDP cover art as PNG/JPEG bytes; 1600×2560 recommended. */
  readonly cover?: Buffer;
  readonly lavish?: boolean;
}

export interface ExportManifest {
  readonly filename: string;
  readonly title: string;
  readonly author: string;
  readonly language: string;
  readonly chapters: number;
  readonly words: number;
  readonly bytes: number;
  readonly documentIds: readonly string[];
  readonly hasCover: boolean;
  readonly generatedAt: string;
}

export interface ExportResult {
  readonly buffer: Buffer;
  readonly manifest: ExportManifest;
}

/** Deterministic, filesystem-safe export filename: Title-Author.epub */
export function exportFilename(meta: BookMeta): string {
  return `${slugify(meta.title, 10) || "untitled"}-${slugify(meta.author, 4) || "author"}.epub`;
}

/** G-06 (additive): AI-disclosure layer for KDP exports. */
export * from "./disclosure";

/** G-11 (additive): export adapters — narration script, DOCX and KPF. */
export * from "./adapters";
export * from "./docx";
export * from "./kpf";
export { createZip, crc32, type ZipEntry } from "./zip";

/** Build the ordered content documents for a manuscript (exposed for tests). */
export function buildContentDocuments(
  meta: BookMeta,
  chapters: readonly Chapter[],
  lavish: boolean,
): ContentDocument[] {
  if (chapters.length === 0) {
    throw new ExportError("Cannot export an EPUB with zero chapters");
  }
  return assembleContentDocuments(meta, chapters, { lavish, includeCopyright: true });
}

/** Map Inkforge content documents onto epub-gen-memory chapters. */
function toEpubChapters(docs: readonly ContentDocument[]): EpubChapter[] {
  return docs.map((doc) => {
    const frontMatter = doc.id === "title-page" || doc.id === "copyright-page";
    return {
      title: doc.title,
      content: doc.data,
      filename: doc.id,
      excludeFromToc: frontMatter,
      beforeToc: doc.id === "title-page",
    };
  });
}

/**
 * Generate the EPUB binary. Throws ExportError wrapping any generator failure
 * so callers only ever handle one error type.
 */
export async function buildEpub(request: ExportRequest): Promise<ExportResult> {
  const { meta, chapters, cover } = request;
  const lavish = request.lavish ?? true;
  const docs = buildContentDocuments(meta, chapters, lavish);
  const epubChapters = toEpubChapters(docs);

  const words = chapters.reduce(
    (total, chapter) => total + (chapter.wordCount || countWords(chapter.markdown)),
    0,
  );

  const options: EpubOptions = {
    title: meta.title,
    author: meta.author,
    publisher: meta.author,
    lang: meta.language,
    css: EPUB_CSS,
    version: 3,
    prependChapterTitles: false,
    numberChaptersInTOC: false,
    verbose: false,
    ...(meta.description.length > 0 ? { description: meta.description } : {}),
    ...(cover !== undefined && cover.byteLength > 0
      ? { cover: new File([cover], "cover.png", { type: "image/png" }) }
      : {}),
  };

  try {
    const epub = new EPub(options, epubChapters);
    const buffer = await epub.genEpub();
    const manifest: ExportManifest = {
      filename: exportFilename(meta),
      title: meta.title,
      author: meta.author,
      language: meta.language,
      chapters: chapters.length,
      words,
      bytes: buffer.byteLength,
      documentIds: docs.map((doc) => doc.id),
      hasCover: cover !== undefined && cover.byteLength > 0,
      generatedAt: new Date().toISOString(),
    };
    return { buffer, manifest };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ExportError(`EPUB generation failed: ${message}`, error);
  }
}
