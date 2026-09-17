/**
 * G-17a — deterministic draft composer (frozen-core additive).
 *
 * The no-provider path of chapter.generate: expand an outline beat into a real
 * (if skeletal) scene draft the author edits. Contract: deterministic per seed,
 * bounded length, absorbs the brief's content words, differs across seeds.
 */
import { describe, expect, it } from "vitest";
import { composeDraft } from "../src/draft/index";

describe("composeDraft", () => {
  it("is deterministic for a given seed", () => {
    const a = composeDraft({
      title: "The Lamp",
      brief: "First contact with the machine.",
      targetWords: 300,
      seed: 7,
    });
    const b = composeDraft({
      title: "The Lamp",
      brief: "First contact with the machine.",
      targetWords: 300,
      seed: 7,
    });
    expect(a.markdown).toBe(b.markdown);
  });

  it("differs across seeds", () => {
    const a = composeDraft({
      title: "The Lamp",
      brief: "First contact.",
      targetWords: 300,
      seed: 7,
    });
    const b = composeDraft({
      title: "The Lamp",
      brief: "First contact.",
      targetWords: 300,
      seed: 8,
    });
    expect(a.markdown).not.toBe(b.markdown);
  });

  it("stays within the target band and is real prose", () => {
    const { markdown, wordCount } = composeDraft({
      title: "The Lamp",
      brief: "A lighthouse keeper teaches a machine to be alone.",
      targetWords: 400,
      seed: 42,
    });
    expect(wordCount).toBeGreaterThan(240);
    expect(wordCount).toBeLessThan(640);
    expect(markdown.startsWith("# The Lamp")).toBe(true);
    expect(markdown).toMatch(/keeper/i);
    // No template leakage: no lorem, no TODO, no placeholder braces.
    expect(markdown).not.toMatch(/lorem|TODO|\{\{/i);
  });

  it("rejects an empty brief", () => {
    expect(() => composeDraft({ title: "X", brief: "   ", targetWords: 200, seed: 1 })).toThrow(
      /brief/i,
    );
  });
});
