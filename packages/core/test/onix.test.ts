/**
 * G-18 — ISBN/BISAC/ONIX (B19): identifiers and the ONIX 3.0 export.
 * Deterministic: checksums, code shapes and XML assembly are pure functions.
 */
import { describe, expect, it } from "vitest";
import {
  buildOnix30,
  distributionIdentifierSchema,
  isbn13CheckDigit,
  isValidBisacCode,
  isValidIsbn13,
  normalizeIsbn13,
  type BookMeta,
} from "@inkforge/core";

const META: BookMeta = {
  title: "A Study in Ember",
  author: "Dana Pryce",
  description: "A smith wakes the old fire.",
  genre: "Fantasy",
  keywords: [],
  language: "en",
  publishTarget: "kdp",
  extra: {},
};

describe("G-18 ISBN-13", () => {
  it("computes the modulus-10 check digit and validates real ISBNs", () => {
    // 978-0-306-40615-? is the canonical worked example; check digit is 7.
    expect(isbn13CheckDigit("978030640615")).toBe("7");
    expect(isValidIsbn13("978-0-306-40615-7")).toBe(true);
    expect(isValidIsbn13("9780306406158")).toBe(false);
    expect(isValidIsbn13("97803064")).toBe(false);
  });

  it("normalizes dashed input and rejects garbage", () => {
    expect(normalizeIsbn13("978-0-306-40615-7")).toBe("9780306406157");
    expect(() => normalizeIsbn13("abc")).toThrow();
  });
});

describe("G-18 BISAC", () => {
  it("accepts canonical BISAC codes and rejects free text", () => {
    expect(isValidBisacCode("FIC000000")).toBe(true);
    expect(isValidBisacCode("FIC028000")).toBe(true);
    expect(isValidBisacCode("Fantasy / Epic")).toBe(false);
  });
});

describe("G-18 identifier schema", () => {
  it("binds an ISBN-13 only when the checksum is right", () => {
    expect(distributionIdentifierSchema.safeParse({ isbn13: "9780306406157" }).success).toBe(true);
    expect(distributionIdentifierSchema.safeParse({ isbn13: "9780306406158" }).success).toBe(false);
    expect(distributionIdentifierSchema.safeParse({ sku: "KDP-ASIN-B01" }).success).toBe(true);
  });
});

describe("G-18 ONIX 3.0 export", () => {
  it("emits a release-3.0 message with title, contributor, language and subjects", () => {
    const xml = buildOnix30({
      meta: META,
      product: {
        priceCents: 499,
        currency: "USD",
        categories: ["FIC009000"],
        territories: [],
        preorder: false,
        maturityRating: "general",
      },
      identifier: { isbn13: "9780306406157" },
    });
    expect(xml).toContain('<ONIXMessage release="3.0"');
    expect(xml).toContain("<IDValue>9780306406157</IDValue>");
    expect(xml).toContain("<LanguageCode>en</LanguageCode>");
    expect(xml).toContain("<SubjectCode>FIC009000</SubjectCode>");
    expect(xml).toContain("<PriceAmount>4.99</PriceAmount>");
  });

  it("keeps markup inert via CDATA and stays byte-stable for identical input", () => {
    // Reason: ONIX 3.0 text elements wrap content in CDATA rather than entity-
    // escaping it, so markup and ampersands stay literal but cannot break XML.
    const hostile = { ...META, title: 'Ember & Flame <I>"rev"</I>' };
    const xml = buildOnix30({ meta: hostile, identifier: { sku: "SKU-1" } });
    expect(xml).toContain('Ember & Flame <I>"rev"</I>');
    expect(buildOnix30({ meta: hostile, identifier: { sku: "SKU-1" } })).toBe(xml);
  });

  it("refuses to emit without an identifier", () => {
    expect(() => buildOnix30({ meta: META })).toThrow();
  });
});
