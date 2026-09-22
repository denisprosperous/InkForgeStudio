/**
 * G-30d — direct-to-consumer product page (C4/C8 adjacent): the storefront
 * payload a D2C checkout needs, assembled only from supplied commerce data.
 */
import { describe, expect, it } from "vitest";
import { buildDirectProductPage, type BookMeta, type ProductMetadata } from "@inkforge/core";

const META: BookMeta = {
  title: "A Study in Ember",
  author: "Dana Pryce",
  description: "A smith wakes the old fire.",
  genre: "Fantasy",
  keywords: ["epic fantasy"],
  language: "en",
  publishTarget: "kdp",
  extra: {},
};

const PRODUCT: ProductMetadata = {
  priceCents: 499,
  currency: "USD",
  categories: ["FIC009000"],
  territories: ["US"],
  preorder: false,
  maturityRating: "general",
};

describe("G-30d direct product page", () => {
  it("emits a JSON-LD Product with an offer only when price data exists", () => {
    const page = buildDirectProductPage(META, PRODUCT, {
      checkoutUrl: "https://shop.example/checkout/1",
      storeName: "Pryce Press",
    });
    const jsonld = page.jsonLd as Record<string, unknown>;
    expect(jsonld["@type"]).toBe("Product");
    expect(jsonld.name).toBe("A Study in Ember");
    const offers = jsonld.offers as Record<string, unknown>;
    expect(offers.price).toBe("4.99");
    expect(offers.priceCurrency).toBe("USD");
    expect(page.checkoutUrl).toContain("shop.example");
  });

  it("omits the offer when there is no price and flags it", () => {
    const page = buildDirectProductPage(
      META,
      { ...PRODUCT, priceCents: 0 },
      { checkoutUrl: "https://shop.example/checkout/1", storeName: "Pryce Press" },
    );
    expect((page.jsonLd as Record<string, unknown>).offers).toBeUndefined();
    expect(page.warnings.join(" ")).toContain("price");
  });

  it("requires a checkout url and is deterministic", () => {
    expect(() =>
      buildDirectProductPage(META, PRODUCT, { checkoutUrl: "", storeName: "X" }),
    ).toThrow();
    expect(
      buildDirectProductPage(META, PRODUCT, {
        checkoutUrl: "https://shop.example/c",
        storeName: "Pryce Press",
      }),
    ).toEqual(
      buildDirectProductPage(META, PRODUCT, {
        checkoutUrl: "https://shop.example/c",
        storeName: "Pryce Press",
      }),
    );
  });
});
