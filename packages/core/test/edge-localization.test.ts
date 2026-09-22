/**
 * G-30g — localization: per-market translation package with stable segment
 * keys and market metadata. No machine translation — the package is the
 * input a human or TMS vendor needs, with coverage reported honestly.
 */
import { describe, expect, it } from "vitest";
import { buildLocalizationPackage, type BookMeta, type PrintChapterInput } from "@inkforge/core";

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

const CHAPTERS: PrintChapterInput[] = [
  { title: "The Lamp", markdown: "Mara lit the lamp.\n\nShe waited." },
  { title: "The Gate", markdown: "The gate opened at dawn." },
];

describe("G-30g localization package", () => {
  it("segments every chapter with stable keys and target market metadata", () => {
    const pack = buildLocalizationPackage(META, CHAPTERS, {
      language: "de",
      territory: "DE",
      currency: "EUR",
    });
    expect(pack.target).toEqual({ language: "de", territory: "DE", currency: "EUR" });
    expect(pack.segments.length).toBeGreaterThanOrEqual(3);
    expect(pack.segments[0]?.key).toMatch(/^ch0-s0$/);
    expect(pack.segments.every((segment) => segment.targetLanguage === "de")).toBe(true);
    expect(pack.stats.words).toBeGreaterThan(0);
  });

  it("refuses an unsupported target language shape", () => {
    expect(() =>
      buildLocalizationPackage(META, CHAPTERS, {
        language: "deu",
        territory: "DE",
        currency: "EUR",
      }),
    ).toThrow();
    expect(() =>
      buildLocalizationPackage(META, CHAPTERS, {
        language: "de",
        territory: "DEU",
        currency: "EUR",
      }),
    ).toThrow();
  });

  it("reports coverage as untranslated until a translation is supplied", () => {
    const pack = buildLocalizationPackage(META, CHAPTERS, {
      language: "de",
      territory: "DE",
      currency: "EUR",
    });
    expect(pack.stats.translatedSegments).toBe(0);
    expect(pack.stats.coveragePercent).toBe(0);
  });

  it("is deterministic", () => {
    const target = { language: "de", territory: "DE", currency: "EUR" };
    expect(buildLocalizationPackage(META, CHAPTERS, target)).toEqual(
      buildLocalizationPackage(META, CHAPTERS, target),
    );
  });
});
