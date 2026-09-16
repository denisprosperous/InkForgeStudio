import { describe, expect, it } from "vitest";
import {
  countWords,
  HEALTHY_DAILY_WORDS,
  KDP_MAX_WORDS,
  parseBookMeta,
  parseOutline,
  readingMinutes,
  reorderChapters,
  slugify,
  statsFor,
  type Chapter,
} from "../src/book/index";

function chapter(partial: Partial<Chapter>): Chapter {
  return {
    id: partial.id ?? "c1",
    idx: partial.idx ?? 0,
    title: partial.title ?? "Chapter One",
    markdown: partial.markdown ?? "It was a dark and stormy night.",
    status: partial.status ?? "draft",
    wordCount: partial.wordCount ?? 0,
    createdAt: "",
    updatedAt: "",
  };
}

describe("countWords", () => {
  it("counts prose words and ignores markdown noise", () => {
    expect(countWords("Hello world.")).toBe(2);
    expect(countWords("# Heading\n\nSome *emphasized* text here.")).toBe(5);
    expect(countWords("[link text](https://example.com) more")).toBe(3);
    expect(countWords("```\ncode block\n```\nafter")).toBe(1);
    expect(countWords("")).toBe(0);
  });
});

describe("readingMinutes", () => {
  it("never returns zero and follows the 238 wpm baseline", () => {
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(238)).toBe(1);
    expect(readingMinutes(2380)).toBe(10);
  });
});

describe("slugify", () => {
  it("produces kebab-case slugs safe for filenames", () => {
    expect(slugify("The Martian: A Novel!")).toBe("the-martian-a-novel");
    expect(slugify("Créatures  of the  Deep -- 2024")).toBe("creatures-of-the-deep-2024");
    expect(slugify("")).toBe("untitled");
    expect(slugify("one two three four five six seven eight nine ten", 3)).toBe("one-two-three");
  });
});

describe("parseBookMeta / parseOutline", () => {
  it("applies defaults and rejects malformed metadata", () => {
    const meta = parseBookMeta({ title: "Book", author: "A. Author" });
    expect(meta.language).toBe("en");
    expect(meta.publishTarget).toBe("kdp");
    expect(meta.keywords).toEqual([]);
    expect(() => parseBookMeta({ title: "" })).toThrow();
  });

  it("validates outline beats", () => {
    const outline = parseOutline({
      chapters: [{ idx: 0, title: "The Call" }],
    });
    expect(outline.chapters[0]?.targetWords).toBe(1_200);
    expect(() => parseOutline({ chapters: [] })).toThrow();
    expect(() => parseOutline({ chapters: [{ idx: -1, title: "x" }] })).toThrow();
  });
});

describe("statsFor", () => {
  it("aggregates manuscript statistics", () => {
    const stats = statsFor([
      chapter({ wordCount: 1_000, status: "final" }),
      chapter({ wordCount: 500 }),
    ]);
    expect(stats.chapters).toBe(2);
    expect(stats.words).toBe(1_500);
    expect(stats.finalChapters).toBe(1);
    expect(stats.minutes).toBe(6);
    expect(stats.withinKdpLimits).toBe(true);
  });

  it("flags empty and oversized manuscripts against KDP limits", () => {
    expect(statsFor([]).withinKdpLimits).toBe(false);
    expect(statsFor([chapter({ wordCount: KDP_MAX_WORDS + 1 })]).withinKdpLimits).toBe(false);
  });
});

describe("reorderChapters", () => {
  it("reindexes after a drag reorder", () => {
    const a = chapter({ id: "a", title: "A" });
    const b = chapter({ id: "b", title: "B" });
    const c = chapter({ id: "c", title: "C" });
    const reordered = reorderChapters([a, b, c], ["c", "a"]);
    expect(reordered.map((entry) => `${entry.idx}:${entry.id}`)).toEqual(["0:c", "1:a", "2:b"]);
  });

  it("keeps chapters missing from the order list instead of dropping them", () => {
    const a = chapter({ id: "a" });
    const b = chapter({ id: "b" });
    const reordered = reorderChapters([a, b], ["b"]);
    expect(reordered).toHaveLength(2);
    expect(reordered.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});

describe("constants", () => {
  it("keeps the documented cadence constants", () => {
    expect(KDP_MAX_WORDS).toBe(650_000);
    expect(HEALTHY_DAILY_WORDS).toBe(1_111);
  });
});
