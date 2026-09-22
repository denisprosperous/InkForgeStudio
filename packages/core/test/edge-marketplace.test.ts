/**
 * G-30e — marketplace listing pack: one deterministic mapping per target
 * with explicit limit reporting (truncation is flagged, never silent).
 */
import { describe, expect, it } from "vitest";
import { buildMarketplaceListing, MARKETPLACE_TARGETS, type BookMeta, type ProductMetadata } from "@inkforge/core";

const META: BookMeta = {
  title: "A Study in Ember",
  author: "Dana Pryce",
  description: "A smith wakes the old fire beneath the city of Ashfall.",
  genre: "Fantasy",
  keywords: ["epic fantasy", "smith"],
  language: "en",
  publishTarget: "kdp",
  extra: {},
};

const PRODUCT: ProductMetadata = {
  priceCents: 499,
  currency: "USD",
  categories: ["FIC009000"],
  territories: ["US", "GB"],
  preorder: false,
  maturityRating: "general",
};

describe("G-30e marketplace listings", () => {
  it("covers the supported targets", () => {
    expect(MARKETPLACE_TARGETS).toEqual(["kdp", "draft2digital", "kobo", "gumroad"]);
  });

  it("maps the same book into each target's shape", () => {
    for (const target of MARKETPLACE_TARGETS) {
      const listing = buildMarketplaceListing(META, PRODUCT, target);
      expect(listing.target).toBe(target);
      expect(listing.title).toBe("A Study in Ember");
      expect(listing.author).toBe("Dana Pryce");
      expect(listing.priceCents).toBe(499);
      expect(listing.currency).toBe("USD");
    }
  });

  it("flags truncation instead of silently cutting long text", () => {
    const long = { ...META, description: "x".repeat(5_000) };
    const listing = buildMarketplaceListing(long, PRODUCT, "kobo");
    expect(listing.description.length).toBeLessThanOrEqual(listing.limits.descriptionChars);
    expect(listing.warnings.join(" ")).toContain("description truncated");
  });

  it("rejects unknown targets", () => {
    expect(() => buildMarketplaceListing(META, PRODUCT, "amazon-unknown" as never)).toThrow();
  });
});
