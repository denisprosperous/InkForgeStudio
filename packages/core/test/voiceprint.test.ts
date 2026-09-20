/**
 * G-16 — Voiceprint v1 (B6): target-author voice matching on top of the
 * humanize engine's deterministic metrics. The profile distills reference
 * prose into a numeric signature; the analyzer scores candidate text against
 * it without any model calls (deterministic-first, per register §4).
 */
import { describe, expect, it } from "vitest";
import { buildVoiceprint, voiceprintSchema, voiceDistance, voiceReport } from "@inkforge/core";

const FLAT_REFERENCE = Array.from(
  { length: 12 },
  (_, i) => `Chapter ${i} opens with a steady deliberate rhythm that never rushes anywhere at all.`,
).join("\n\n");

const VARIED_REFERENCE = [
  "Short. Then a much longer sentence arrives, carrying several subordinate clauses, a couple of parenthetical asides (the kind this author likes), and finally lands.",
  "Bang. A sharp fragment.",
  "The middle-length sentence carries the story forward through the market square toward the harbor.",
  "Another short one.",
  "Dialogue, she said, carries its own cadence in this voice.",
].join("\n\n");

describe("G-16 voiceprint schema", () => {
  it("defaults an empty profile", () => {
    const profile = voiceprintSchema.parse({});
    expect(profile.avgSentenceLength).toBeGreaterThan(0);
    expect(profile.referenceWords).toBe(0);
  });

  it("rejects impossible metric ranges", () => {
    expect(() => voiceprintSchema.parse({ avgSentenceLength: -5 })).toThrow();
    expect(() => voiceprintSchema.parse({ fleschEase: 900 })).toThrow();
  });
});

describe("G-16 buildVoiceprint", () => {
  it("distills deterministic metrics from reference prose", () => {
    const profile = buildVoiceprint(VARIED_REFERENCE);
    expect(profile.avgSentenceLength).toBeGreaterThan(0);
    expect(profile.fleschEase).toBeGreaterThanOrEqual(0);
    expect(profile.fleschEase).toBeLessThanOrEqual(100);
  });

  it("keeps the two reference voices metrically distinct", () => {
    const flat = buildVoiceprint(FLAT_REFERENCE);
    const varied = buildVoiceprint(VARIED_REFERENCE);
    expect(Math.abs(flat.avgSentenceLength - varied.avgSentenceLength)).toBeGreaterThan(1);
  });
});

describe("G-16 matching", () => {
  const varied = buildVoiceprint(VARIED_REFERENCE);

  it("scores an on-voice sample near zero distance and high fit", () => {
    const sample =
      "Short. Then a much longer sentence arrives, carrying several subordinate clauses, a couple of parenthetical asides (the kind this author likes), and finally lands. Another short one. The middle-length sentence carries the story forward through the market square toward the harbor.";
    const distance = voiceDistance(sample, varied);
    const report = voiceReport(sample, varied);
    expect(distance).toBeLessThan(20);
    expect(report.fit).toBeGreaterThan(0.6);
  });

  it("scores an off-voice sample clearly worse", () => {
    const report = voiceReport(FLAT_REFERENCE, varied);
    expect(report.fit).toBeLessThan(0.8);
  });

  it("is deterministic: same input, same report", () => {
    const a = voiceReport(VARIED_REFERENCE, varied);
    const b = voiceReport(VARIED_REFERENCE, varied);
    expect(a).toEqual(b);
  });
});
