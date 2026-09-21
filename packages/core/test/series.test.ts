/**
 * G-26 — series bible / franchise architecture (C3). Deterministic merge of
 * per-book consistency ledgers into franchise-level knowledge: shared
 * entities, an ordered timeline, open threads worth paying off later, and
 * continuity conflicts across books.
 */
import { describe, expect, it } from "vitest";
import { buildSeriesBible, type SeriesBookInput } from "@inkforge/core";

const BOOK_ONE: SeriesBookInput = {
  bookId: "b1",
  title: "A Study in Ember",
  seriesLabel: "The Ember Cycle",
  facts: [
    {
      kind: "entity",
      name: "Mara Vane",
      aliases: ["Mara"],
      summary: "The smith who wakes the old fire.",
      firstChapter: 0,
      lastChapter: 2,
    },
    {
      kind: "entity",
      name: "Ashfall",
      aliases: [],
      summary: "The city above the fire.",
      firstChapter: 1,
      lastChapter: 2,
    },
    {
      kind: "entity",
      name: "Orella Vex",
      aliases: [],
      summary: "A cartographer who never returns.",
      firstChapter: 2,
      lastChapter: 2,
    },
  ],
};

const BOOK_TWO: SeriesBookInput = {
  bookId: "b2",
  title: "The Gate Below",
  seriesLabel: "The Ember Cycle",
  facts: [
    {
      kind: "entity",
      name: "Mara Vane",
      aliases: [],
      summary: "The smith who wakes the old fire.",
      firstChapter: 0,
      lastChapter: 1,
    },
    {
      kind: "entity",
      name: "ashfall",
      aliases: [],
      summary: "A drowned district.",
      firstChapter: 0,
      lastChapter: 1,
    },
  ],
};

describe("G-26 series bible", () => {
  const bible = buildSeriesBible({ seriesLabel: "The Ember Cycle", books: [BOOK_ONE, BOOK_TWO] });

  it("collects entities shared across books with per-book appearances", () => {
    const mara = bible.sharedEntities.find((entity) => entity.name.toLowerCase() === "mara vane");
    expect(mara).toBeDefined();
    expect(mara?.appearances).toHaveLength(2);
    expect(mara?.appearances[0]?.title).toBe("A Study in Ember");
    expect(bible.stats.sharedEntities).toBeGreaterThanOrEqual(1);
  });

  it("orders the timeline by book then chapter", () => {
    const order = bible.timeline.map((entry) => `${entry.title}#${entry.idx}`);
    expect(order[0]?.startsWith("A Study in Ember#")).toBe(true);
    expect(order.at(-1)?.startsWith("The Gate Below#")).toBe(true);
  });

  it("flags cross-book continuity conflicts on the same canonical name", () => {
    const conflict = bible.conflicts.find((entry) => entry.name.toLowerCase() === "ashfall");
    expect(conflict).toBeDefined();
    expect(conflict?.summaries).toHaveLength(2);
  });

  it("lists single-book entities as open threads", () => {
    const threads = bible.openThreads.map((thread) => thread.name);
    expect(threads).toContain("Orella Vex");
    expect(threads).not.toContain("Mara Vane");
  });

  it("tolerates a single-book series and reports stats", () => {
    const solo = buildSeriesBible({ seriesLabel: "The Ember Cycle", books: [BOOK_ONE] });
    expect(solo.sharedEntities).toEqual([]);
    expect(solo.openThreads.length).toBe(3);
    expect(solo.stats.books).toBe(1);
  });

  it("is deterministic", () => {
    expect(
      buildSeriesBible({ seriesLabel: "The Ember Cycle", books: [BOOK_ONE, BOOK_TWO] }),
    ).toEqual(bible);
  });
});
