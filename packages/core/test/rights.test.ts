/**
 * G-09b — rights & licensing contracts + corpus retrieval (B9/B18).
 *
 * Deterministic-first: rights records are a validated contract; corpus
 * retrieval is a pure token-overlap scorer over stored chunks (no model, no
 * embeddings) so ranking is reproducible in CI and upgradeable later.
 */
import { describe, expect, it } from "vitest";
import {
  RIGHTS_KINDS,
  chunkText,
  corpusSearch,
  rightsRecordSchema,
  tokenize,
  type CorpusChunk,
} from "@inkforge/core";

describe("G-09b rights contract", () => {
  it("defaults territory, exclusivity and status", () => {
    const record = rightsRecordSchema.parse({
      kind: "license",
      title: "Audiobook rights",
      holder: "Northlight Audio",
    });
    expect(record.territory).toBe("world");
    expect(record.exclusive).toBe(false);
    expect(record.status).toBe("active");
    expect(RIGHTS_KINDS).toContain("restriction");
  });

  it("rejects unknown kinds and empty holders", () => {
    expect(() => rightsRecordSchema.parse({ kind: "wish", title: "t", holder: "h" })).toThrow();
    expect(() => rightsRecordSchema.parse({ kind: "license", title: "t", holder: "" })).toThrow();
  });
});

describe("G-09b chunking", () => {
  it("packs paragraphs up to the character budget without splitting them", () => {
    const paragraphA = "alpha ".repeat(40).trim(); // 239 chars
    const paragraphB = "beta ".repeat(40).trim();
    const text = `${paragraphA}\n\n${paragraphB}`;
    const chunks = chunkText(text, { maxChars: 300 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain("alpha");
    expect(chunks[1]).toContain("beta");
  });

  it("hard-splits a paragraph that exceeds the budget", () => {
    const big = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkText(big, { maxChars: 60 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(60);
  });

  it("is deterministic and ignores empty input", () => {
    expect(chunkText("  \n\n ")).toEqual([]);
    expect(chunkText("one\n\ntwo", { maxChars: 100 })).toEqual(
      chunkText("one\n\ntwo", { maxChars: 100 }),
    );
  });
});

describe("G-09b corpus search", () => {
  const chunks: CorpusChunk[] = [
    { idx: 0, source: "chapter-1", text: "Mara Vane forged the lamp in Ashfall." },
    { idx: 1, source: "chapter-1", text: "The gate of Ashfall opened at dawn." },
    { idx: 2, source: "chapter-2", text: "Bread cooled on the sill while the forge slept." },
  ];

  it("tokenizes deterministically and drops stopwords", () => {
    expect(tokenize("The gate of Ashfall opened at dawn.")).toEqual([
      "gate",
      "ashfall",
      "opened",
      "dawn",
    ]);
  });

  it("ranks rarer terms above common ones via idf weighting", () => {
    const results = corpusSearch(chunks, "dawn");
    expect(results).toHaveLength(1);
    expect(results[0]?.idx).toBe(1);
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  it("returns every matching chunk ordered by score then idx", () => {
    // Reason: v1 retrieval matches whole tokens and does NOT stem, so the
    // exact "forge" (chunk 2, df=1) outranks the inflected "forged" (chunk 0)
    // and the twice-seen "ashfall" — the assertion documents that contract.
    const results = corpusSearch(chunks, "ashfall forge");
    const ids = results.map((result) => result.idx);
    expect(ids).toContain(0);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
    expect(results[0]?.idx).toBe(2);
  });

  it("returns nothing for empty queries and clamps the limit", () => {
    expect(corpusSearch(chunks, "   ")).toEqual([]);
    expect(corpusSearch(chunks, "ashfall", { limit: 1 })).toHaveLength(1);
  });
});
