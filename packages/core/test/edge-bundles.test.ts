/**
 * G-30c — bundling engine (C8): composition + deterministic pricing ladder.
 */
import { describe, expect, it } from "vitest";
import { bundleRoyalty, priceBundle, recommendBundleDiscount } from "@inkforge/core";

describe("G-30c bundle pricing", () => {
  it("applies the discount to the summed list price", () => {
    const result = priceBundle(
      [
        { title: "One", priceCents: 499 },
        { title: "Two", priceCents: 699 },
      ],
      { discountPercent: 15 },
    );
    expect(result.listPriceCents).toBe(1198);
    expect(result.priceCents).toBe(Math.round(1198 * 0.85));
    expect(result.savingsCents).toBe(1198 - result.priceCents);
  });

  it("rejects empty bundles and out-of-range discounts", () => {
    expect(() => priceBundle([], { discountPercent: 10 })).toThrow();
    expect(() =>
      priceBundle([{ title: "One", priceCents: 100 }], { discountPercent: 80 }),
    ).toThrow();
  });

  it("recommends a bounded ladder by item count", () => {
    expect(recommendBundleDiscount(2).discountPercent).toBe(10);
    expect(recommendBundleDiscount(3).discountPercent).toBe(15);
    expect(recommendBundleDiscount(6).discountPercent).toBe(25);
  });

  it("computes bundle royalty from an explicit rate", () => {
    expect(bundleRoyalty(1000, 0.7)).toEqual({ royaltyCents: 700, rate: 0.7 });
    expect(() => bundleRoyalty(1000, 1.5)).toThrow();
  });
});
