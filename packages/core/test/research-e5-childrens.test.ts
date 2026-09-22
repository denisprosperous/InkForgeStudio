/**
 * Adapter E-5 — children's reading levels: age bands with hard limits and a
 * content-safety gate. The platform will not draft age-inappropriate content.
 */
import { describe, expect, it } from "vitest";
import { AGE_BANDS, assessReadingLevel, buildPictureBookPlan } from "@inkforge/core";

describe("E-5 children's reading-level adapter", () => {
  it("declares age bands with word and sentence limits", () => {
    expect(AGE_BANDS.map((band) => band.id)).toEqual(["picture-3-5", "picture-6-8", "chapter-9-12"]);
    for (const band of AGE_BANDS) {
      expect(band.maxWordsPerSentence).toBeGreaterThan(0);
      expect(band.maxWords).toBeGreaterThan(0);
    }
  });

  it("estimates a reading level from sentence and syllable load", () => {
    const easy = assessReadingLevel("The cat sat. The dog ran. We had fun.");
    const hard = assessReadingLevel(
      "Notwithstanding the administrative complexities, the preliminary investigation demonstrated considerable institutional resistance.",
    );
    expect(easy.wordsPerSentence).toBeLessThan(hard.wordsPerSentence);
    expect(easy.gradeBand).toBe("early");
    expect(hard.gradeBand).not.toBe("early");
  });

  it("plans a picture book inside the band's limits", () => {
    const plan = buildPictureBookPlan({ band: "picture-3-5", pages: 32 });
    expect(plan.maxWordsPerSentence).toBe(AGE_BANDS[0]!.maxWordsPerSentence);
    expect(plan.pageBreakTarget).toBe(32);
    expect(plan.spreads).toBe(16);
  });

  it("refuses age-inappropriate content for the chosen band", () => {
    const plan = buildPictureBookPlan({
      band: "picture-3-5",
      pages: 32,
      sampleText: "The wolf's violent attack left the village in terror.",
    });
    expect(plan.verdict).toBe("REFUSED");
    expect(plan.refusalReason).toContain("age band");
  });

  it("rejects unknown bands", () => {
    expect(() => buildPictureBookPlan({ band: "teen-16" as never, pages: 10 })).toThrow();
  });
});
