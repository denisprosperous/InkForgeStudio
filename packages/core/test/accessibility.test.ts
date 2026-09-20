/**
 * G-19 — accessibility editions (B20): the deterministic a11y audit (alt
 * text, headings, language), the EPUB a11y metadata pairs, and the
 * large-print edition produced through the G-10 print writer at 16pt.
 */
import { describe, expect, it } from "vitest";
import {
  auditAccessibility,
  buildPrintInterior,
  epubAccessibilityMetadata,
  estimatePageCount,
  largePrintOptions,
  type PrintChapterInput,
} from "@inkforge/core";

const CLEAN: PrintChapterInput[] = [
  {
    title: "The Lamp",
    markdown:
      "# The Lamp\n\nMara Vane entered Ashfall with the lamp lit. ![A kerosene lamp on a workbench](lamp.png)\n\nShe worked until dawn.",
  },
  {
    title: "The Gate",
    markdown: "# The Gate\n\nMara Vane returned. [The city records](records.html) were open.",
  },
];

const BROKEN: PrintChapterInput[] = [
  {
    title: "Silent",
    markdown: "No heading at all. ![](wordless.png) and []() empty link text.",
  },
];

describe("G-19 accessibility audit", () => {
  it("passes a clean manuscript with alt text and headings", () => {
    const report = auditAccessibility(CLEAN);
    expect(report.imagesTotal).toBe(1);
    expect(report.imagesMissingAlt).toBe(0);
    expect(report.chaptersMissingHeading).toBe(0);
    expect(report.score).toBe(1);
  });

  it("flags missing alt text, empty links and missing headings", () => {
    const report = auditAccessibility(BROKEN);
    expect(report.imagesTotal).toBe(1);
    expect(report.imagesMissingAlt).toBe(1);
    expect(report.linksEmptyText).toBe(1);
    expect(report.chaptersMissingHeading).toBe(1);
    expect(report.score).toBeLessThan(1);
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    expect(auditAccessibility(BROKEN)).toEqual(auditAccessibility(BROKEN));
  });
});

describe("G-19 EPUB a11y metadata", () => {
  it("emits the EPUB-A11Y-WCAG21-AA conformance pair and accessMode", () => {
    const pairs = epubAccessibilityMetadata({ language: "en" });
    const props = pairs.map((pair) => pair.property);
    expect(props).toContain("schema:accessMode");
    expect(props).toContain("schema:conformsTo");
    const conforms = pairs.find((pair) => pair.property === "schema:conformsTo");
    expect(conforms?.content).toContain("EPUB-A11Y-WCAG21-AA");
    const accessMode = pairs.find((pair) => pair.property === "schema:accessMode");
    expect(accessMode?.content).toContain("textual");
  });

  it("is deterministic and stable across calls", () => {
    expect(epubAccessibilityMetadata({ language: "en" })).toEqual(
      epubAccessibilityMetadata({ language: "en" }),
    );
  });
});

describe("G-19 large-print edition", () => {
  const options = largePrintOptions();
  const FAT: PrintChapterInput[] = [
    { title: "The Lamp", markdown: "Mara Vane entered Ashfall. ".repeat(2500) },
    { title: "The Gate", markdown: "Mara Vane returned. ".repeat(2500) },
  ];

  it("uses 16pt type on a bigger trim with more leading", () => {
    expect(options.bodyFontPt).toBe(16);
    expect(options.trimId).toBe("7x10");
    expect(options.leadingRatio).toBeGreaterThan(1.2);
  });

  it("costs more pages than the standard edition", () => {
    const base = estimatePageCount(FAT, "6x9");
    const large = estimatePageCount(FAT, options.trimId, options);
    expect(large).toBeGreaterThan(base);
  });

  it("produces a real 16pt print interior through the G-10 writer", () => {
    const interior = buildPrintInterior(
      "A Study in Ember",
      "Dana Pryce",
      options.trimId,
      FAT,
      options,
    );
    const latin = interior.pdf.toString("latin1");
    expect(latin).toContain("%PDF-");
    expect(latin).toContain("16 Tf");
    expect(interior.pages).toBeGreaterThanOrEqual(24);
  });
});
