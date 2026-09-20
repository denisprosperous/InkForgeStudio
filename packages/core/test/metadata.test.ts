/**
 * G-13 — metadata extension: `extra` jsonb passthrough + product schema (B2).
 *
 * Back-compat gate: every pre-G-13 book meta payload must parse identically
 * (extra defaults to {}), so adding the extension never breaks stored rows or
 * in-flight requests. The product schema carries the market/product fields the
 * metadata UI (and later the ONIX/AEO consumers) attach under `extra.product`.
 */
import { describe, expect, it } from "vitest";
import { bookMetaSchema, productMetadataSchema } from "@inkforge/core";

const baseMeta = {
  title: "A Study in Ember",
  author: "Dana Pryce",
};

describe("G-13 bookMeta extra extension", () => {
  it("defaults extra to an empty object when absent (back-compat)", () => {
    const meta = bookMetaSchema.parse(baseMeta);
    expect(meta.extra).toEqual({});
  });

  it("round-trips a namespaced extra payload", () => {
    const meta = bookMetaSchema.parse({
      ...baseMeta,
      extra: { product: { priceCents: 499, currency: "USD" }, origins: { seed: 42 } },
    });
    expect(meta.extra).toEqual({
      product: { priceCents: 499, currency: "USD" },
      origins: { seed: 42 },
    });
  });

  it("rejects extra keys that are empty or over the namespace limit", () => {
    expect(() => bookMetaSchema.parse({ ...baseMeta, extra: { "": 1 } })).toThrow();
    expect(() => bookMetaSchema.parse({ ...baseMeta, extra: { ["k".repeat(65)]: 1 } })).toThrow();
  });
});

describe("G-13 product metadata schema", () => {
  it("parses the empty object with market defaults", () => {
    const product = productMetadataSchema.parse({});
    expect(product).toEqual({
      priceCents: 0,
      currency: "USD",
      categories: [],
      territories: [],
      preorder: false,
      maturityRating: "general",
    });
  });

  it("accepts a KDP-style product payload and clamps to the contract", () => {
    const product = productMetadataSchema.parse({
      priceCents: 999,
      currency: "usd",
      categories: ["FICTION / Fantasy / Epic"],
      territories: ["US", "GB", "DE"],
      preorder: true,
      maturityRating: "mature",
    });
    expect(product.currency).toBe("USD");
    expect(product.categories).toHaveLength(1);
    expect(product.territories).toEqual(["US", "GB", "DE"]);
  });

  it("rejects negative prices and malformed currencies", () => {
    expect(() => productMetadataSchema.parse({ priceCents: -1 })).toThrow();
    expect(() => productMetadataSchema.parse({ currency: "DOLLAR" })).toThrow();
  });
});
