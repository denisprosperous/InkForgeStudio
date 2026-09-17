/**
 * @inkforge/core/export/disclosure — the AI-disclosure layer for KDP exports
 * (G-06).
 *
 * Amazon's content policy requires AI-generated/AI-assisted books to be
 * disclosed. Inkforge therefore treats disclosure as a first-class export
 * artifact, not a reminder: ON by default for KDP-targeted exports, injected in
 * TWO places —
 *
 *   1. front matter: a dedicated page between the copyright page and chapter 1
 *      (excluded from the TOC, like the other front-matter pages);
 *   2. EPUB metadata: a disclosure sentence appended to dc:description.
 *
 * Freeze note (Master Directive §5): `buildEpub()` is frozen, and its TOC
 * exclusion policy lives in a private mapper keyed on two ids. Rather than
 * editing it, this module re-assembles the content documents around the
 * exported helpers and wires epub-gen-memory with the same options. When
 * disclosure is disabled it delegates to `buildEpub()` untouched, so the
 * disabled path stays byte-identical by construction.
 */
import { EPub, type Chapter as EpubChapter, type Options as EpubOptions } from "epub-gen-memory";
import { countWords, type BookMeta } from "../book/index";
import {
  assembleContentDocuments,
  EPUB_CSS,
  escapeXml,
  type ContentDocument,
} from "../formatting/index";
import {
  ExportError,
  buildEpub,
  exportFilename,
  type ExportRequest,
  type ExportResult,
  type ExportManifest,
} from "./index";

/** Content-document id of the disclosure page. Reserved id — do not reuse. */
export const DISCLOSURE_DOC_ID = "ai-disclosure";
/** Front-matter page title. */
export const DISCLOSURE_TITLE = "AI-Generated Content Disclosure";

/**
 * Real disclosure language, reviewed against Amazon KDP's AI-content policy.
 * `SENTENCE` is the dc:description marker (also the idempotency sentinel);
 * `MARKDOWN` is the front-matter page body.
 */
export const DEFAULT_DISCLOSURE = {
  SENTENCE:
    "This book was created with the assistance of AI-based tools and was reviewed, edited and approved by the author before publication.",
  MARKDOWN: [
    "This book was created with the assistance of AI-based tools: large language models were used for outlining, drafting and editing support.",
    "",
    "The author reviewed, revised and approved every portion of the final text and remains responsible for its content. No part of this book was published without human review.",
    "",
    "If you believe any passage infringes an existing copyright, please contact the publisher so it can be corrected in the next edition.",
  ].join("\n"),
} as const;

/** Supplementary stylesheet, appended to EPUB_CSS (which stays frozen). */
export const DISCLOSURE_CSS = `
.ai-disclosure { margin-top: 18%; }
.ai-disclosure .disclosure-title { font-size: 1.2em; text-align: center; margin: 0 0 2em 0; }
.ai-disclosure p { text-indent: 0; margin-bottom: 1em; }
`.trim();

export interface DisclosureOptions {
  /** Force on/off; defaults to ON for KDP-targeted exports. */
  readonly enabled?: boolean;
  /** Override the page body wording (metadata sentence stays standard). */
  readonly text?: string;
}

export interface DisclosedExportManifest extends ExportManifest {
  readonly aiDisclosure: boolean;
}

export interface DisclosedExportResult extends ExportResult {
  readonly manifest: DisclosedExportManifest;
}

export interface DisclosurePlan {
  /** Metadata copy to export (dc:description augmented when enabled). */
  readonly meta: BookMeta;
  /** Page body to insert, or null when disclosure is off. */
  readonly disclosureText: string | null;
}

/** Resolve the effective disclosure switch. KDP is the default-on target. */
export function disclosureEnabledFor(meta: BookMeta, options: DisclosureOptions = {}): boolean {
  return options.enabled ?? meta.publishTarget === "kdp";
}

/** The disclosure front-matter document, XML-safe by construction. */
export function disclosureDocument(text: string): ContentDocument {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeXml(paragraph.trim())}</p>`)
    .join("\n");
  return {
    id: DISCLOSURE_DOC_ID,
    title: DISCLOSURE_TITLE,
    data: [
      '<div class="ai-disclosure">',
      `<h1 class="disclosure-title">${escapeXml(DISCLOSURE_TITLE)}</h1>`,
      paragraphs,
      "</div>",
    ].join("\n"),
  };
}

/**
 * Compute the disclosure plan for a request: which page text (if any) to insert
 * and what the metadata description becomes. Pure — the caller's request is
 * never mutated, and the sentinel makes repeated planning idempotent.
 */
export function planDisclosure(
  request: ExportRequest,
  options: DisclosureOptions = {},
): DisclosurePlan {
  if (!disclosureEnabledFor(request.meta, options)) {
    return { meta: request.meta, disclosureText: null };
  }
  const room = Math.max(0, 4_000 - DEFAULT_DISCLOSURE.SENTENCE.length - 2);
  const base = request.meta.description.trim().slice(0, room);
  const description =
    base === ""
      ? DEFAULT_DISCLOSURE.SENTENCE
      : request.meta.description.includes(DEFAULT_DISCLOSURE.SENTENCE)
        ? request.meta.description
        : `${base}\n\n${DEFAULT_DISCLOSURE.SENTENCE}`;
  return {
    meta:
      description === request.meta.description ? request.meta : { ...request.meta, description },
    disclosureText: options.text ?? DEFAULT_DISCLOSURE.MARKDOWN,
  };
}

/** Same chapter mapping as the frozen core, extended for the disclosure page. */
function toEpubChapters(docs: readonly ContentDocument[]): EpubChapter[] {
  return docs.map((doc) => {
    const frontMatter =
      doc.id === "title-page" || doc.id === "copyright-page" || doc.id === DISCLOSURE_DOC_ID;
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
 * Export with the AI-disclosure layer applied. Enabled (default for KDP): the
 * page is spliced in after copyright and dc:description carries the disclosure
 * sentence. Disabled: delegates to the frozen `buildEpub()` verbatim.
 */
export async function buildDisclosedEpub(
  request: ExportRequest,
  options: DisclosureOptions = {},
): Promise<DisclosedExportResult> {
  const plan = planDisclosure(request, options);

  if (plan.disclosureText === null) {
    const plain = await buildEpub(request);
    return { ...plain, manifest: { ...plain.manifest, aiDisclosure: false } };
  }

  if (request.chapters.length === 0) {
    throw new ExportError("Cannot export an EPUB with zero chapters");
  }

  const lavish = request.lavish ?? true;
  const docs = assembleContentDocuments(plan.meta, request.chapters, {
    lavish,
    includeCopyright: true,
  });
  const copyrightIdx = docs.findIndex((doc) => doc.id === "copyright-page");
  const insertAt = copyrightIdx >= 0 ? copyrightIdx + 1 : 1; // after front matter
  const assembled = [
    ...docs.slice(0, insertAt),
    disclosureDocument(plan.disclosureText),
    ...docs.slice(insertAt),
  ];

  const words = request.chapters.reduce(
    (total, chapter) => total + (chapter.wordCount || countWords(chapter.markdown)),
    0,
  );

  const epubOptions: EpubOptions = {
    title: plan.meta.title,
    author: plan.meta.author,
    publisher: plan.meta.author,
    lang: plan.meta.language,
    css: `${EPUB_CSS}\n${DISCLOSURE_CSS}`,
    version: 3,
    prependChapterTitles: false,
    numberChaptersInTOC: false,
    verbose: false,
    ...(plan.meta.description.length > 0 ? { description: plan.meta.description } : {}),
    ...(request.cover !== undefined && request.cover.byteLength > 0
      ? { cover: new File([request.cover], "cover.png", { type: "image/png" }) }
      : {}),
  };

  try {
    const epub = new EPub(epubOptions, toEpubChapters(assembled));
    const buffer = await epub.genEpub();
    const manifest: DisclosedExportManifest = {
      filename: exportFilename(plan.meta),
      title: plan.meta.title,
      author: plan.meta.author,
      language: plan.meta.language,
      chapters: request.chapters.length,
      words,
      bytes: buffer.byteLength,
      documentIds: assembled.map((doc) => doc.id),
      hasCover: request.cover !== undefined && request.cover.byteLength > 0,
      generatedAt: new Date().toISOString(),
      aiDisclosure: true,
    };
    return { buffer, manifest };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ExportError(`EPUB generation failed: ${message}`, error);
  }
}
