/**
 * NEGENTROPY-Ω Section 3 — Anti-Fabrication Extension + Coverage Test Suite.
 *
 * One place asserting every guardrail: the platform must refuse (REFUSED
 * verdict, insufficient-data status, thrown error) instead of inventing a
 * reference, a market signal, a legal opinion, or age-inappropriate content.
 * Green here is the evidence for the anti-fabrication success criterion.
 */
import { describe, expect, it } from "vitest";
import {
  buildCaseStudyOutline,
  buildPictureBookPlan,
  checkClaims,
  deriveDemandSignal,
  evaluateMarketGate,
  findPriceArbitrage,
  pickCoverWinner,
  planForCell,
  renderCitation,
  buildCitationSlot,
  verifyCaseStudyClaims,
} from "@inkforge/core";

describe("anti-fabrication: refusals instead of invention", () => {
  it("refuses medical and harmful topics even with full data", () => {
    const medical = planForCell({
      category: "nonfiction",
      availability: "full",
      topic: "medical dosage guidance",
    });
    expect(medical.verdict).toBe("REFUSED");
    const harmful = planForCell({
      category: "fiction",
      availability: "full",
      topic: "suicide method",
    });
    expect(harmful.verdict).toBe("REFUSED");
    expect(harmful.refusalReason).toContain("prohibited");
  });

  it("refuses evidence-hungry categories with no verifiable data", () => {
    for (const category of ["nonfiction", "academic-technical", "professional-b2b"] as const) {
      const plan = planForCell({ category, availability: "none", topic: "anything" });
      expect(plan.verdict).toBe("REFUSED");
      expect(plan.refusalReason).toContain("no verifiable data");
    }
  });

  it("refuses to render an unverifiable citation", () => {
    const slot = buildCitationSlot({ title: "A plausible paper" });
    expect(slot.verifiable).toBe(false);
    expect(() => renderCitation(slot)).toThrow(/not verifiable/);
  });

  it("flags unsourced and weakly sourced claims", () => {
    const report = checkClaims([
      { text: "growth hit 40%", source: null },
      { text: "growth hit 40%", source: "vibes" },
      { text: "growth resumed", source: "author experience" },
    ]);
    expect(report.ok).toBe(false);
    expect(report.unsourced).toHaveLength(1);
    expect(report.weakSources).toHaveLength(1);
  });

  it("refuses a case study with no metrics", () => {
    expect(() =>
      buildCaseStudyOutline({ clientLabel: "X", confidential: false, metrics: [] }),
    ).toThrow(/metric/);
    const unsupported = verifyCaseStudyClaims([{ text: "savings doubled", metric: null }]);
    expect(unsupported.ok).toBe(false);
  });

  it("refuses age-inappropriate children's content", () => {
    const plan = buildPictureBookPlan({
      band: "picture-3-5",
      pages: 32,
      sampleText: "The wolf's violent attack left the village in terror.",
    });
    expect(plan.verdict).toBe("REFUSED");
  });

  it("refuses to crown a cover winner on thin impressions", () => {
    const result = pickCoverWinner(
      [
        { variant: "A", impressions: 10, clicks: 5 },
        { variant: "B", impressions: 10, clicks: 4 },
      ],
      { minImpressions: 500 },
    );
    expect(result.winner).toBeNull();
    expect(result.reason).toContain("insufficient");
  });

  it("refuses arbitrage signals on thin market data", () => {
    const report = findPriceArbitrage(
      [{ market: "US", currency: "USD", priceCents: 100, demandIndex: 50 }],
      {
        minMarkets: 3,
      },
    );
    expect(report.status).toBe("insufficient-data");
    expect(report.signals).toEqual([]);
  });

  it("withholds a market gate 'go' from a small sales sample", () => {
    const gate = evaluateMarketGate({
      niche: "test",
      demandScore: 95,
      competitionScore: 10,
      pricePower: 90,
      trendScore: 90,
      sampleSize: 3,
      source: "unit-test",
      capturedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(gate.verdict).not.toBe("go");
    expect(gate.reasons.join(" ")).toContain("sample");
  });

  it("keeps a weak seller's demand signal below the gate's hold band", () => {
    const signal = deriveDemandSignal({
      records: 1,
      totalUnits: 1,
      totalRevenueMicros: 499_000,
      totalRoyaltyMicros: 100_000,
      royaltyRate: 0.2,
      byChannel: [],
    });
    expect(signal.demandScore).toBeLessThan(50);
    expect(signal.rationale.join(" ")).toContain("1 units");
  });

  it("passes every honest cell with evidence requirements attached", () => {
    const fiction = planForCell({ category: "fiction", availability: "full", topic: "any" });
    expect(fiction.verdict).toBe("PASS");
    expect(fiction.refusalReason).toBeNull();
    const partial = planForCell({
      category: "nonfiction",
      availability: "partial",
      topic: "remote work",
    });
    expect(partial.evidenceRequired).toContain("primary-source");
    expect(partial.evidenceRequired).toContain("expert-review");
  });
});
