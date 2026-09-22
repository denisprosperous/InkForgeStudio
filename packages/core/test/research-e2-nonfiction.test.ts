/**
 * Adapter E-2 — nonfiction evidence: promise-first architecture whose every
 * claim carries an evidence slot (the anti-fabrication backbone for how-to,
 * business and self-help books).
 */
import { describe, expect, it } from "vitest";
import { buildNonfictionOutline, checkClaims, type Claim } from "@inkforge/core";

describe("E-2 nonfiction evidence adapter", () => {
  it("builds a promise→evidence→steps→objections→close structure", () => {
    const outline = buildNonfictionOutline({
      promise: "Ship a book in 90 days",
      steps: ["Plan", "Draft", "Publish"],
      objections: ["I have no time"],
      evidenceSlots: [{ claim: "90-day cadence works", source: "author cohort data" }],
    });
    expect(outline.sections.map((section) => section.id)).toEqual([
      "promise",
      "evidence",
      "steps",
      "objections",
      "close",
    ]);
    expect(outline.sections.find((section) => section.id === "steps")?.items).toHaveLength(3);
  });

  it("refuses to build without a promise or evidence slots", () => {
    expect(() =>
      buildNonfictionOutline({ promise: "", steps: ["a"], objections: [], evidenceSlots: [] }),
    ).toThrow();
    expect(() =>
      buildNonfictionOutline({ promise: "P", steps: ["a"], objections: [], evidenceSlots: [] }),
    ).toThrow();
  });

  it("flags claims that carry no source", () => {
    const claims: Claim[] = [
      { text: "sales tripled in 2026", source: null },
      { text: "the method works", source: "author experience" },
    ];
    const report = checkClaims(claims);
    expect(report.unsourced).toHaveLength(1);
    expect(report.unsourced[0]?.text).toContain("tripled");
    expect(report.ok).toBe(false);
  });

  it("flags numeric claims even when a vague source exists", () => {
    const report = checkClaims([
      { text: "86% of authors finish", source: "vibes" },
      { text: "reads keep improving with revisions", source: "author experience" },
    ]);
    expect(report.weakSources).toHaveLength(1);
    expect(report.ok).toBe(false);
  });

  it("passes fully sourced claims", () => {
    const report = checkClaims([
      { text: "reader retention drops after chapter 3", source: "primary-source: cohort study 2025" },
    ]);
    expect(report.ok).toBe(true);
  });
});
