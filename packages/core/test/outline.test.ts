/**
 * G-14 — deterministic outline generator.
 *
 * The product spine is structure-before-prose, so these tests assert the two
 * properties the studio and the worker both depend on: (1) every emitted
 * outline satisfies the frozen `outlineSchema`, and (2) the same request always
 * produces the same outline, reroll only on an explicit seed change.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAPTER_COUNT,
  DEFAULT_TARGET_WORDS,
  MAX_BEAT_WORDS,
  MAX_CHAPTERS,
  MIN_BEAT_WORDS,
  generateOutline,
  outlineSchema,
  plannedWords,
  rerollOutline,
} from "../src/index";

const PREMISE = "A lighthouse keeper teaches a machine to be alone after the coast is evacuated.";

describe("generateOutline", () => {
  it("emits an outline that satisfies the frozen outlineSchema", () => {
    const outline = generateOutline({ premise: PREMISE, genre: "Science Fiction" });
    expect(() => outlineSchema.parse(outline)).not.toThrow();
    expect(outline.chapters).toHaveLength(DEFAULT_CHAPTER_COUNT);
    expect(outline.acts).toHaveLength(3);
  });

  it("indexes beats contiguously from zero", () => {
    const outline = generateOutline({ premise: PREMISE, chapterCount: 17 });
    expect(outline.chapters.map((beat) => beat.idx)).toEqual([...Array(17).keys()]);
  });

  it("is deterministic for an identical request", () => {
    const a = generateOutline({ premise: PREMISE, seed: 7 });
    const b = generateOutline({ premise: PREMISE, seed: 7 });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("changes only when the seed changes", () => {
    const a = generateOutline({ premise: PREMISE, seed: 7 });
    const b = generateOutline({ premise: PREMISE, seed: 8 });
    expect(b).not.toEqual(a);
    expect(b.chapters).toHaveLength(a.chapters.length);
  });

  it("budgets words to the requested total within one beat", () => {
    const outline = generateOutline({ premise: PREMISE, targetWords: 60_000, chapterCount: 20 });
    const total = plannedWords(outline);
    expect(Math.abs(total - 60_000)).toBeLessThanOrEqual(MAX_BEAT_WORDS);
    for (const beat of outline.chapters) {
      expect(beat.targetWords).toBeGreaterThanOrEqual(MIN_BEAT_WORDS);
      expect(beat.targetWords).toBeLessThanOrEqual(MAX_BEAT_WORDS);
    }
  });

  it("clamps a target too small to divide across beats", () => {
    const outline = generateOutline({ premise: PREMISE, targetWords: 100, chapterCount: 12 });
    for (const beat of outline.chapters) {
      expect(beat.targetWords).toBeGreaterThanOrEqual(MIN_BEAT_WORDS);
    }
    expect(() => outlineSchema.parse(outline)).not.toThrow();
  });

  it("honours an explicit act count and clamps beyond nine", () => {
    expect(generateOutline({ premise: PREMISE, acts: 5 }).acts).toHaveLength(5);
    expect(generateOutline({ premise: PREMISE, acts: 99 }).acts).toHaveLength(9);
    expect(generateOutline({ premise: PREMISE, acts: 0 }).acts).toHaveLength(1);
  });

  it("caps chapters at the schema maximum", () => {
    const outline = generateOutline({ premise: PREMISE, chapterCount: 500, targetWords: 900_000 });
    expect(outline.chapters).toHaveLength(MAX_CHAPTERS);
    expect(() => outlineSchema.parse(outline)).not.toThrow();
  });

  it("never repeats a beat title", () => {
    const outline = generateOutline({ premise: PREMISE, chapterCount: MAX_CHAPTERS });
    const titles = outline.chapters.map((beat) => beat.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("names every beat after premise signal, not filler", () => {
    const outline = generateOutline({ premise: PREMISE, seed: 3 });
    expect(outline.chapters.every((beat) => beat.title.length > 2)).toBe(true);
    expect(outline.chapters.every((beat) => beat.brief.length > 20)).toBe(true);
  });

  it("defaults the target and genre when omitted", () => {
    const outline = generateOutline({ premise: PREMISE });
    expect(outline.genre).toBe("General");
    expect(Math.abs(plannedWords(outline) - DEFAULT_TARGET_WORDS)).toBeLessThanOrEqual(
      MAX_BEAT_WORDS,
    );
  });

  it("throws on a blank premise", () => {
    expect(() => generateOutline({ premise: "   " })).toThrow(RangeError);
  });

  it("truncates an over-long premise instead of failing schema validation", () => {
    const outline = generateOutline({ premise: "word ".repeat(1_500) });
    expect(outline.premise.length).toBeLessThanOrEqual(4_000);
    expect(() => outlineSchema.parse(outline)).not.toThrow();
  });
});

describe("rerollOutline", () => {
  it("is deterministic and differs from its base seed", () => {
    const base = generateOutline({ premise: PREMISE, seed: 11 });
    const rolled = rerollOutline({ premise: PREMISE, seed: 11 });
    expect(rolled).toEqual(rerollOutline({ premise: PREMISE, seed: 11 }));
    expect(rolled).not.toEqual(base);
    expect(rolled.chapters).toHaveLength(base.chapters.length);
  });
});

describe("plannedWords", () => {
  it("sums beat targets", () => {
    const outline = generateOutline({ premise: PREMISE, targetWords: 30_000, chapterCount: 10 });
    expect(plannedWords(outline)).toBe(
      outline.chapters.reduce((total, beat) => total + beat.targetWords, 0),
    );
  });
});
