import { describe, expect, it } from "vitest";
import {
  createRng,
  humanizeMarkdown,
  humanizeWithLlm,
  rewriteSentence,
  scoreText,
} from "../src/humanize/index";

const OPTS = {
  passes: 1,
  contractions: true,
  trimFiller: true,
  varySentences: true,
  rewriteStockPhrases: true,
  preserveStructure: true,
} as const;

describe("createRng", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const sequenceA = [a(), a(), a()];
    const sequenceB = [b(), b(), b()];
    expect(sequenceA).toEqual(sequenceB);
  });

  it("produces values in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 100; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("rewriteSentence", () => {
  const rng = createRng(424_242);

  it("removes stock AI phrasing", () => {
    const out = rewriteSentence("We must delve into the data.", OPTS, rng);
    expect(out).toBe("We must explore the data.");
  });

  it("applies contractions", () => {
    const out = rewriteSentence("It is clear that they do not agree.", OPTS, rng);
    expect(out).toBe("It's clear that they don't agree.");
  });

  it("trims filler hedges", () => {
    const out = rewriteSentence("The results were very quite basically final.", OPTS, rng);
    expect(out).toBe("The results were final.");
  });

  it("keeps structural lines untouched by design (heading passthrough)", () => {
    expect(rewriteSentence("# The Uncharted Deep", OPTS, rng)).toBe("# The Uncharted Deep");
  });
});

describe("humanizeMarkdown", () => {
  it("rewrites stock phrases across the chapter while preserving headings", () => {
    const draft = [
      "# Chapter One",
      "",
      "Furthermore, the hero had to delve into the mystery.",
      "It is a testament to her willpower.",
    ].join("\n");
    const result = humanizeMarkdown(draft);
    expect(result.markdown).toContain("# Chapter One");
    expect(result.markdown).not.toContain("delve into");
    expect(result.markdown).not.toContain("testament to");
    expect(result.changedSentences).toBeGreaterThan(0);
  });

  it("is reproducible for the same seed", () => {
    const draft = "The city was a vibrant tapestry of cultures. Moreover, it is ancient.";
    const a = humanizeMarkdown(draft, { seed: 99 });
    const b = humanizeMarkdown(draft, { seed: 99 });
    expect(a.markdown).toBe(b.markdown);
    expect(a.changedSentences).toBe(b.changedSentences);
  });

  it("raises reading ease for stock-heavy prose", () => {
    const draft =
      "It is important to note that the journey was breathtaking. " +
      "Furthermore, the vibrant tapestry of the city captivated everyone.";
    const result = humanizeMarkdown(draft);
    expect(result.scoreAfter.fleschEase).toBeGreaterThan(result.scoreBefore.fleschEase);
  });

  it("never increases the score when the text is already clean", () => {
    const clean = "The rain stopped. She walked home. The door was unlocked. She went in.";
    const result = humanizeMarkdown(clean);
    expect(result.markdown).toBe(clean);
    expect(result.changedSentences).toBe(0);
  });
});

describe("scoreText", () => {
  it("scores airy prose higher than dense prose", () => {
    const airy = "The dog ran. It was fast. The cat slept. All was quiet. Then night came.";
    const dense =
      "The disproportionately bureaucratic administrative infrastructure of the " +
      "intergovernmental regulatory apparatus promulgated supplementary documentation.";
    expect(scoreText(airy).fleschEase).toBeGreaterThan(scoreText(dense).fleschEase);
  });

  it("reports sentence-length variance", () => {
    const varied =
      "Hi. The remarkably tall man from the north of the city walked home slowly today, whistling.";
    const flat = "The man walked home. The man walked home. The man walked home again today.";
    expect(scoreText(varied).sentenceLengthStdDev).toBeGreaterThan(
      scoreText(flat).sentenceLengthStdDev * 0.9,
    );
  });
});

describe("humanizeWithLlm", () => {
  const draft = "# Deep Water\n\nFurthermore, the storm intensified. It is dangerous.";

  it("keeps the LLM rewrite when it preserves structure and length", async () => {
    const result = await humanizeWithLlm(draft, {
      complete: async () => "# Deep Water\n\nThe storm grew worse. It was dangerous now.",
    });
    expect(result.llmRewrites).toBe(1);
    expect(result.markdown).toContain("The storm grew worse");
  });

  it("falls back to the rule engine when the LLM drops structure", async () => {
    const result = await humanizeWithLlm(draft, { complete: async () => "one line only" });
    expect(result.llmRewrites).toBe(0);
    expect(result.markdown).toContain("# Deep Water");
  });

  it("falls back when the LLM throws", async () => {
    const result = await humanizeWithLlm(draft, {
      complete: async () => {
        throw new Error("provider down");
      },
    });
    expect(result.llmRewrites).toBe(0);
    expect(result.markdown).toContain("# Deep Water");
  });
});
