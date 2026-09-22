/**
 * Adapter E-1 — fiction structure: genre-aware beat architecture.
 */
import { describe, expect, it } from "vitest";
import { FICTION_GENRES, buildFictionOutline, fictionBeatsFor } from "@inkforge/core";

describe("E-1 fiction structure", () => {
  it("covers the major fiction genres", () => {
    expect(FICTION_GENRES.length).toBeGreaterThanOrEqual(8);
    expect(FICTION_GENRES).toContain("mystery");
    expect(FICTION_GENRES).toContain("romance");
  });

  it("allocates beats to chapters proportionally with a full target", () => {
    const outline = buildFictionOutline({ genre: "fantasy", chapters: 24, targetWords: 90_000 });
    expect(outline.beats.length).toBeGreaterThanOrEqual(4);
    const chapterTotal = outline.beats.reduce((total, beat) => total + beat.chapters, 0);
    expect(chapterTotal).toBe(24);
    const wordTotal = outline.beats.reduce((total, beat) => total + beat.targetWords, 0);
    expect(wordTotal).toBe(90_000);
  });

  it("carries genre conventions (POV/tense guidance) per genre", () => {
    const beats = fictionBeatsFor("mystery");
    expect(beats.map((beat) => beat.name)).toContain("Clue escalation");
    expect(fictionBeatsFor("romance").map((beat) => beat.name)).toContain("Meet-cute");
  });

  it("rejects unknown genres and impossible chapter counts", () => {
    expect(() => buildFictionOutline({ genre: "vibes" as never, chapters: 10, targetWords: 1000 })).toThrow();
    expect(() => buildFictionOutline({ genre: "fantasy", chapters: 0, targetWords: 1000 })).toThrow();
  });
});
