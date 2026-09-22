/**
 * G-30h — arbitrage signals: price/demand gaps across markets, with a
 * minimum-market rule so thin data produces a refusal, not a claim.
 */
import { describe, expect, it } from "vitest";
import { findPriceArbitrage, type MarketPricePoint } from "@inkforge/core";

const POINTS: MarketPricePoint[] = [
  { market: "US", currency: "USD", priceCents: 499, demandIndex: 70 },
  { market: "GB", currency: "GBP", priceCents: 399, demandIndex: 65 },
  { market: "DE", currency: "EUR", priceCents: 899, demandIndex: 80 },
];

describe("G-30h arbitrage", () => {
  it("flags markets priced far below the demand-weighted reference", () => {
    const report = findPriceArbitrage(POINTS, { minMarkets: 3, gapPercent: 20 });
    expect(report.status).toBe("ok");
    const flagged = report.signals.map((signal) => signal.market);
    expect(flagged).toContain("GB");
    for (const signal of report.signals) {
      expect(signal.reason).toContain("below reference");
      expect(signal.referencePriceCents).toBeGreaterThan(signal.priceCents);
    }
  });

  it("refuses to signal on thin data", () => {
    const report = findPriceArbitrage([POINTS[0]!], { minMarkets: 3, gapPercent: 20 });
    expect(report.status).toBe("insufficient-data");
    expect(report.signals).toEqual([]);
  });

  it("does not flag markets priced at or above the reference", () => {
    const report = findPriceArbitrage(POINTS, { minMarkets: 3, gapPercent: 20 });
    expect(report.signals.map((signal) => signal.market)).not.toContain("DE");
  });

  it("is deterministic and empty-safe", () => {
    expect(findPriceArbitrage(POINTS, { minMarkets: 3, gapPercent: 20 })).toEqual(
      findPriceArbitrage(POINTS, { minMarkets: 3, gapPercent: 20 }),
    );
    expect(findPriceArbitrage([], {}).signals).toEqual([]);
  });
});
