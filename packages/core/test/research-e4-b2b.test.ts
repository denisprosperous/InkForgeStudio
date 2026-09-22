/**
 * Adapter E-4 — professional / B2B case studies: every outcome claim needs a
 * measured metric slot, and confidentiality is explicit.
 */
import { describe, expect, it } from "vitest";
import { buildCaseStudyOutline, verifyCaseStudyClaims, type CaseStudyClaim } from "@inkforge/core";

describe("E-4 professional case-study adapter", () => {
  it("structures a case study around situation→intervention→metrics→lessons", () => {
    const outline = buildCaseStudyOutline({
      clientLabel: "a mid-market publisher",
      confidential: true,
      metrics: [{ name: "cycle time", before: "42 days", after: "19 days", source: "client ops export" }],
    });
    expect(outline.sections.map((section) => section.id)).toEqual([
      "situation",
      "intervention",
      "metrics",
      "lessons",
    ]);
    expect(outline.disclosure).toContain("anonymized");
  });

  it("requires at least one metric before the outline is valid", () => {
    expect(() =>
      buildCaseStudyOutline({ clientLabel: "X", confidential: false, metrics: [] }),
    ).toThrow(/metric/);
  });

  it("flags outcome claims that lack measured evidence", () => {
    const claims: CaseStudyClaim[] = [
      { text: "we cut costs by 40%", metric: null },
      { text: "the team shipped weekly", metric: { name: "cadence", value: "weekly", source: "client report" } },
    ];
    const report = verifyCaseStudyClaims(claims);
    expect(report.unsupported).toHaveLength(1);
    expect(report.ok).toBe(false);
  });

  it("flags a metric without a source", () => {
    const report = verifyCaseStudyClaims([
      { text: "sales doubled", metric: { name: "sales", value: "2x", source: "" } },
    ]);
    expect(report.unsupported).toHaveLength(1);
    expect(report.ok).toBe(false);
  });

  it("passes fully measured claims", () => {
    const report = verifyCaseStudyClaims([
      { text: "sales doubled", metric: { name: "sales", value: "2x", source: "client dashboard" } },
    ]);
    expect(report.ok).toBe(true);
  });
});
