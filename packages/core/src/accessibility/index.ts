/**
 * G-19 — accessibility editions (B20).
 *
 * Three deterministic surfaces: (1) an a11y audit over the manuscript
 * (alt text, heading coverage, empty link text) with a 0..1 score, (2) the
 * EPUB accessibility metadata pairs (EPUB-A11Y-WCAG21-AA conformance block),
 * (3) the large-print edition recipe — 16pt body on a 7x10 trim — carried by
 * the G-10 print writer's PrintSpecOptions.
 */
import type { PrintChapterInput } from "../print/index";

export interface AccessibilityReport {
  readonly imagesTotal: number;
  readonly imagesMissingAlt: number;
  readonly linksEmptyText: number;
  readonly chaptersMissingHeading: number;
  readonly score: number;
  readonly issues: readonly string[];
}

const IMAGE = /!\[([^\]]*)\]\(([^)]*)\)/g;
/** Negative lookbehind keeps image syntax out of the bare-link scan. */
const LINK = /(?<!!)\[([^\]]*)\]\(([^)]*)\)/g;
const HEADING = /^#{1,6}\s+\S/m;

/** Deterministic accessibility audit over the manuscript chapters. */
export function auditAccessibility(chapters: readonly PrintChapterInput[]): AccessibilityReport {
  let imagesTotal = 0;
  let imagesMissingAlt = 0;
  let linksEmptyText = 0;
  let chaptersMissingHeading = 0;
  const issues: string[] = [];

  for (const chapter of chapters) {
    if (!HEADING.test(chapter.markdown)) {
      chaptersMissingHeading += 1;
      issues.push(`"${chapter.title}" has no heading`);
    }
    for (const match of chapter.markdown.matchAll(IMAGE)) {
      imagesTotal += 1;
      if ((match[1] ?? "").trim().length === 0) {
        imagesMissingAlt += 1;
        issues.push(`"${chapter.title}" image missing alt text`);
      }
    }
    for (const match of chapter.markdown.matchAll(LINK)) {
      if ((match[1] ?? "").trim().length === 0) {
        linksEmptyText += 1;
        issues.push(`"${chapter.title}" link has no text`);
      }
    }
  }

  const checks = 3;
  const penalties =
    (imagesTotal > 0 ? imagesMissingAlt / imagesTotal : 0) +
    (chapters.length > 0 ? chaptersMissingHeading / chapters.length : 0) +
    (linksEmptyText > 0 ? 1 : 0);
  const score = Math.max(0, Math.round((1 - penalties / checks) * 100) / 100);
  return {
    imagesTotal,
    imagesMissingAlt,
    linksEmptyText,
    chaptersMissingHeading,
    score,
    issues,
  };
}

export interface A11yMetaPair {
  readonly property: string;
  readonly content: string;
}

/**
 * EPUB accessibility metadata pairs (EPUB Accessibility 1.1 / WCAG 2.1 AA).
 * Injected as OPF <meta property=...> entries at export time.
 */
export function epubAccessibilityMetadata(input: {
  readonly language: string;
}): readonly A11yMetaPair[] {
  return [
    { property: "schema:accessMode", content: "textual" },
    { property: "schema:accessModeSufficient", content: "textual" },
    { property: "schema:accessibilityFeature", content: "structuralNavigation" },
    { property: "schema:accessibilityFeature", content: "tableOfContents" },
    { property: "schema:accessibilityHazard", content: "none" },
    { property: "schema:conformsTo", content: "EPUB-A11Y-WCAG21-AA" },
    { property: "dcterms:language", content: input.language },
  ];
}

export interface LargePrintOptions {
  readonly trimId: "7x10";
  readonly bodyFontPt: 16;
  readonly leadingRatio: 1.5;
  readonly paper: "white" | "cream";
}

/** The large-print edition recipe: 16pt body, generous leading, 7x10 trim. */
export function largePrintOptions(paper: "white" | "cream" = "white"): LargePrintOptions {
  return { trimId: "7x10", bodyFontPt: 16, leadingRatio: 1.5, paper };
}
