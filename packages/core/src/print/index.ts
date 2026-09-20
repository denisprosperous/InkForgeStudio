/**
 * G-10 — print PDF pipeline v1 (B10/B11): trim, bleed, spine.
 *
 * Deterministic print interior: KDP trim table, margins/gutter by page count,
 * spine-width by paper formula, and a self-contained PDF 1.4 writer (base-14
 * fonts, no runtime deps) whose bytes are a pure function of the manuscript —
 * the G-11 zip precedent: light, testable, diffable artifacts.
 */
import { countWords } from "../book/index";

export interface KdpTrimSize {
  readonly id: string;
  readonly widthIn: number;
  readonly heightIn: number;
}

/** Standard KDP paperback trims. */
export const kdpTrimSizes: readonly KdpTrimSize[] = [
  { id: "5x8", widthIn: 5, heightIn: 8 },
  { id: "5.06x7.81", widthIn: 5.06, heightIn: 7.81 },
  { id: "5.25x8", widthIn: 5.25, heightIn: 8 },
  { id: "5.5x8.5", widthIn: 5.5, heightIn: 8.5 },
  { id: "6x9", widthIn: 6, heightIn: 9 },
  { id: "6.14x9.21", widthIn: 6.14, heightIn: 9.21 },
  { id: "6.69x9.61", widthIn: 6.69, heightIn: 9.61 },
  { id: "7x10", widthIn: 7, heightIn: 10 },
  { id: "7.44x9.69", widthIn: 7.44, heightIn: 9.69 },
  { id: "7.5x9.25", widthIn: 7.5, heightIn: 9.25 },
  { id: "8x10", widthIn: 8, heightIn: 10 },
  { id: "8.5x11", widthIn: 8.5, heightIn: 11 },
];

/** KDP bleed requirement on every edge (inches). */
export const PRINT_BLEED_IN = 0.125;
/** KDP page floor for paperback interiors. */
export const PRINT_MIN_PAGES = 24;
/** Spine text needs this much width to be readable. */
const SPINE_TEXT_MIN_IN = 0.0625;
/** Spine text needs at least this many pages per KDP guidance. */
const SPINE_TEXT_MIN_PAGES = 79;

const WHITE_PER_PAGE_IN = 0.002252;
const CREAM_PER_PAGE_IN = 0.0025;

export interface PrintSpecOptions {
  readonly paper?: "white" | "cream";
}

export interface PrintLayoutSpec {
  readonly trim: KdpTrimSize;
  readonly paper: "white" | "cream";
  readonly pageCount: number;
  readonly bleedIn: number;
  readonly pageWidthIn: number;
  readonly pageHeightIn: number;
  readonly insideGutterIn: number;
  readonly outsideMarginIn: number;
  readonly topMarginIn: number;
  readonly bottomMarginIn: number;
  readonly spineWidthIn: number;
  readonly spineTextEligible: boolean;
}

function trimById(id: string): KdpTrimSize {
  const trim = kdpTrimSizes.find((size) => size.id === id);
  if (!trim) throw new Error(`unknown trim size: ${id}`);
  return trim;
}

/** KDP inside (gutter) margin grows with page count; outside stays 0.375". */
function gutterFor(pageCount: number): number {
  if (pageCount <= 150) return 0.375;
  if (pageCount <= 300) return 0.5;
  if (pageCount <= 500) return 0.625;
  return 0.75;
}

/** Full layout geometry for a print interior. */
export function printLayoutSpec(trimId: string, pageCount: number, options: PrintSpecOptions = {}) {
  const paper = options.paper ?? "white";
  const trim = trimById(trimId);
  if (!Number.isInteger(pageCount) || pageCount < PRINT_MIN_PAGES) {
    throw new Error(`print interiors need >= ${PRINT_MIN_PAGES} pages, got ${pageCount}`);
  }
  const spineWidthIn = pageCount * (paper === "white" ? WHITE_PER_PAGE_IN : CREAM_PER_PAGE_IN);
  const insideGutterIn = gutterFor(pageCount);
  return {
    trim,
    paper,
    pageCount,
    bleedIn: PRINT_BLEED_IN,
    pageWidthIn: round4(trim.widthIn + 2 * PRINT_BLEED_IN),
    pageHeightIn: round4(trim.heightIn + 2 * PRINT_BLEED_IN),
    insideGutterIn,
    outsideMarginIn: 0.375,
    topMarginIn: 0.75,
    bottomMarginIn: 0.75,
    spineWidthIn: round4(spineWidthIn),
    spineTextEligible: pageCount >= SPINE_TEXT_MIN_PAGES && spineWidthIn >= SPINE_TEXT_MIN_IN,
  };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export interface PrintChapterInput {
  readonly title: string;
  readonly markdown: string;
}

/**
 * Estimate the page count before layout: words per page scale with the trim
 * area against the 6x9 baseline (~300 words/page).
 */
export function estimatePageCount(chapters: readonly PrintChapterInput[], trimId: string): number {
  const trim = trimById(trimId);
  const baselineArea = 6 * 9;
  const area = trim.widthIn * trim.heightIn;
  const words = chapters.reduce((total, chapter) => total + countWords(chapter.markdown), 0);
  const wordsPerPage = Math.round(300 * (area / baselineArea));
  const frontMatterPages = 6;
  return Math.ceil(words / Math.max(1, wordsPerPage)) + frontMatterPages;
}

// ── PDF 1.4 writer (base-14 Helvetica) ───────────────────────────────

function pdfEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapWords(text: string, maxWidthChars: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (candidate.length > maxWidthChars && line.length > 0) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

interface PdfPage {
  readonly lines: readonly { x: number; y: number; size: number; text: string; bold?: boolean }[];
}

/** Assemble the PDF with a correct xref table; stable for identical input. */
function assemblePdf(pages: readonly PdfPage[], pageWidth: number, pageHeight: number): Buffer {
  const objects: string[] = [];
  const objectIds = { catalog: 1, pages: 2, font: 3 };
  let nextId = 4;
  const pageKidRefs: string[] = [];

  for (const page of pages) {
    const pageId = nextId;
    const contentId = nextId + 1;
    pageKidRefs.push(`${pageId} 0 R`);
    nextId += 2;

    let stream = "";
    for (const line of page.lines) {
      if (line.text.length === 0) continue;
      const font = line.bold ? "/F2" : "/F1";
      stream += `BT ${font} ${line.size} Tf 1 0 0 1 ${line.x.toFixed(2)} ${line.y.toFixed(2)} Tm (${pdfEscape(line.text)}) Tj ET\n`;
    }
    objects[contentId] =
      `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream\nendobj\n`;
    objects[pageId] =
      `${pageId} 0 obj\n<< /Type /Page /Parent ${objectIds.pages} 0 R ` +
      `/MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] ` +
      `/Resources << /Font << /F1 ${objectIds.font} 0 R /F2 ${nextId} 0 R >> >> ` +
      `/Contents ${contentId} 0 R >>\nendobj\n`;
  }

  const boldFontId = nextId;
  objects[objectIds.catalog] =
    `${objectIds.catalog} 0 obj\n<< /Type /Catalog /Pages ${objectIds.pages} 0 R >>\nendobj\n`;
  objects[objectIds.pages] =
    `${objectIds.pages} 0 obj\n<< /Type /Pages /Count ${pageKidRefs.length} ` +
    `/Kids [${pageKidRefs.join(" ")}] >>\nendobj\n`;
  objects[objectIds.font] =
    `${objectIds.font} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  objects[boldFontId] =
    `${boldFontId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  const total = nextId;
  for (let id = 1; id < total; id += 1) {
    offsets[id] = Buffer.byteLength(body, "latin1");
    body += objects[id] ?? `${id} 0 obj\n<< >>\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let id = 1; id < total; id += 1) {
    xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${total} /Root ${objectIds.catalog} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body + xref, "latin1");
}

/**
 * Typeset the interior: chapter opening pages, body text flow, running
 * headers and page numbers. Conservative chars-per-inch keeps Helvetica
 * metrics inside the type area without embedding font files.
 */
function typeset(
  title: string,
  author: string,
  chapters: readonly PrintChapterInput[],
  spec: PrintLayoutSpec,
): PdfPage[] {
  const pointPerIn = 72;
  const typeLeft = spec.insideGutterIn * pointPerIn + 18;
  const typeRight = spec.pageWidthIn * pointPerIn - spec.outsideMarginIn * pointPerIn - 9;
  const typeWidthChars = Math.floor((typeRight - typeLeft) / 5.0);
  const topY = spec.pageHeightIn * pointPerIn - spec.topMarginIn * pointPerIn;
  const bottomY = spec.bottomMarginIn * pointPerIn + 14;
  const lineHeight = 13.3;
  const maxBodyLines = Math.floor((topY - bottomY) / lineHeight) - 2;
  const pages: PdfPage[] = [];

  type FlowLine = { readonly text: string; readonly bold?: boolean };
  const flow: FlowLine[] = [];
  for (const chapter of chapters) {
    flow.push({ text: chapter.title, bold: true });
    const paragraphs = chapter.markdown
      .replace(/\r/g, "")
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    for (const paragraph of paragraphs) {
      for (const line of wrapWords(paragraph, typeWidthChars)) flow.push({ text: line });
      flow.push({ text: "" });
    }
  }

  for (let start = 0; start < flow.length || pages.length === 0; start += maxBodyLines) {
    const chunk = flow.slice(start, start + maxBodyLines);
    const pageNumber = pages.length + 1;
    const lines: { x: number; y: number; size: number; text: string; bold?: boolean }[] = [];
    if (pageNumber > 1) {
      lines.push({ x: typeLeft, y: topY + 10, size: 7.5, text: title });
      lines.push({
        x: (spec.pageWidthIn * pointPerIn) / 2 - 10,
        y: bottomY - 10,
        size: 8,
        text: String(pageNumber),
      });
    } else {
      lines.push({ x: typeLeft, y: topY - 40, size: 14, text: title, bold: true });
      lines.push({ x: typeLeft, y: topY - 60, size: 10, text: author });
    }
    chunk.forEach((entry, index) => {
      lines.push({
        x: typeLeft,
        y: topY - index * lineHeight,
        size: entry.bold ? 12 : 9.5,
        text: entry.text,
        ...(entry.bold ? { bold: true } : {}),
      });
    });
    pages.push({ lines });
    if (flow.length === 0) break;
  }

  return pages;
}

export interface PrintInterior {
  readonly spec: PrintLayoutSpec;
  readonly pages: number;
  readonly pdf: Buffer;
}

/** Build the deterministic print-interior PDF for a manuscript. */
export function buildPrintInterior(
  title: string,
  author: string,
  trimId: string,
  chapters: readonly PrintChapterInput[],
  options: PrintSpecOptions = {},
): PrintInterior {
  // Gate on the estimate first: a manuscript that cannot reach the KDP page
  // floor must fail fast instead of producing an unusable artifact.
  const estimated = estimatePageCount(chapters, trimId);
  if (estimated < PRINT_MIN_PAGES) {
    throw new Error(`print interiors need >= ${PRINT_MIN_PAGES} pages, estimate was ${estimated}`);
  }
  const pages = typeset(title, author, chapters, {
    ...printLayoutSpec(trimId, Math.max(estimated, PRINT_MIN_PAGES), options),
  });
  // Geometry comes from the ACTUAL typeset page count (spine math must match).
  const spec = printLayoutSpec(trimId, pages.length, options);
  const pdf = assemblePdf(pages, spec.pageWidthIn * 72, spec.pageHeightIn * 72);
  return { spec, pages: pages.length, pdf };
}
