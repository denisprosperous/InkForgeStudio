/**
 * G-10 — print PDF pipeline (trim/bleed/spine). Deterministic core: KDP trim
 * table, gutter/margin math by page count, spine-width formula, page-box
 * geometry with bleed, and a self-contained print-interior PDF writer
 * (base-14 fonts, no runtime deps) whose bytes are a pure function of input.
 */
import { describe, expect, it } from "vitest";
import {
  buildPrintInterior,
  estimatePageCount,
  kdpTrimSizes,
  printLayoutSpec,
  PRINT_BLEED_IN,
  type PrintChapterInput,
} from "@inkforge/core";

const CHAPTERS: PrintChapterInput[] = [
  { title: "The Lamp", markdown: "Mara Vane entered Ashfall. ".repeat(2000) },
  { title: "The Gate", markdown: "Mara Vane returned. ".repeat(2000) },
];

describe("G-10 trim table + geometry", () => {
  it("carries the standard KDP trim sizes", () => {
    expect(kdpTrimSizes.map((size) => size.id)).toContain("6x9");
    const trim = kdpTrimSizes.find((size) => size.id === "6x9");
    expect(trim).toEqual({ id: "6x9", widthIn: 6, heightIn: 9 });
  });

  it("computes page boxes with bleed on every edge", () => {
    const spec = printLayoutSpec("6x9", 300, { paper: "white" });
    expect(spec.pageWidthIn).toBeCloseTo(6 + 2 * PRINT_BLEED_IN, 5);
    expect(spec.pageHeightIn).toBeCloseTo(9 + 2 * PRINT_BLEED_IN, 5);
    expect(spec.bleedIn).toBe(PRINT_BLEED_IN);
  });

  it("grows the inside gutter with page count per KDP guidance", () => {
    const thin = printLayoutSpec("6x9", 100, { paper: "white" });
    const thick = printLayoutSpec("6x9", 700, { paper: "white" });
    expect(thick.insideGutterIn).toBeGreaterThan(thin.insideGutterIn);
    expect(thin.outsideMarginIn).toBeGreaterThan(thin.insideGutterIn / 2);
  });

  it("computes spine width from the KDP paper formulas", () => {
    // white: 0.002252" per page; cream: 0.0025" per page.
    expect(printLayoutSpec("6x9", 400, { paper: "white" }).spineWidthIn).toBeCloseTo(0.9008, 4);
    expect(printLayoutSpec("6x9", 400, { paper: "cream" }).spineWidthIn).toBeCloseTo(1.0, 4);
  });

  it("rejects manuscripts below the KDP page floor", () => {
    expect(() => printLayoutSpec("6x9", 12, { paper: "white" })).toThrow();
  });

  it("reports spine-text eligibility (needs width room and enough pages)", () => {
    expect(printLayoutSpec("6x9", 400, { paper: "white" }).spineTextEligible).toBe(true);
    expect(printLayoutSpec("6x9", 50, { paper: "white" }).spineTextEligible).toBe(false);
  });
});

describe("G-10 page estimation", () => {
  const LONG: PrintChapterInput[] = [
    { title: "The Lamp", markdown: "Mara Vane entered Ashfall. ".repeat(2000) },
    { title: "The Gate", markdown: "Mara Vane returned. ".repeat(2000) },
  ];

  it("scales with words and trim area", () => {
    const small = estimatePageCount(LONG, "5x8");
    const big = estimatePageCount(LONG, "8.5x11");
    expect(small).toBeGreaterThan(big);
    expect(small).toBeGreaterThan(0);
  });
});

describe("G-10 print interior", () => {
  const interior = buildPrintInterior("A Study in Ember", "Dana Pryce", "6x9", CHAPTERS, {
    paper: "white",
  });

  it("emits a structurally valid, deterministic PDF", () => {
    const again = buildPrintInterior("A Study in Ember", "Dana Pryce", "6x9", CHAPTERS, {
      paper: "white",
    });
    expect(Buffer.compare(interior.pdf, again.pdf)).toBe(0);
    expect(interior.pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(interior.pdf.toString("latin1")).toContain("%%EOF");
  });

  it("matches its layout spec: page boxes include the bleed", () => {
    const expectedWidth = (interior.spec.pageWidthIn * 72).toFixed(2);
    const latin = interior.pdf.toString("latin1");
    expect(latin).toContain(`/MediaBox [0 0 ${expectedWidth}`);
    expect(interior.pages).toBeGreaterThan(0);
    expect(interior.pages).toBe(interior.spec.pageCount);
  });

  it("keeps chapter titles in the flow", () => {
    expect(interior.pdf.toString("latin1")).toContain("The Lamp");
  });

  it("fails fast on a too-short manuscript", () => {
    expect(() =>
      buildPrintInterior("t", "a", "6x9", [{ title: "One", markdown: "tiny" }]),
    ).toThrow();
  });
});
