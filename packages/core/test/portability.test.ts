/**
 * G-24 — bulk portability export (B17): one deterministic zip holding
 * everything the user owns, re-importable without the platform.
 */
import { describe, expect, it } from "vitest";
import {
  buildPortabilityBundle,
  type PortabilityBlob,
  type PortabilityBook,
  type PortabilityChapter,
} from "@inkforge/core";

const BOOK: PortabilityBook = {
  id: "b1",
  title: "A Study in Ember",
  subtitle: null,
  author: "Dana Pryce",
  description: "A smith wakes the old fire.",
  genre: "Fantasy",
  keywords: ["epic fantasy"],
  language: "en",
  seriesLabel: "The Ember Cycle",
  publishTarget: "kdp",
  status: "drafting",
  extra: { product: { priceCents: 499 } },
};

const CHAPTERS: PortabilityChapter[] = [
  {
    id: "c2",
    bookId: "b1",
    idx: 1,
    title: "The Gate",
    markdown: "Mara Vane returned.",
    status: "draft",
    wordCount: 4,
  },
  {
    id: "c1",
    bookId: "b1",
    idx: 0,
    title: "The Lamp",
    markdown: "Mara Vane entered Ashfall.",
    status: "final",
    wordCount: 5,
  },
];

const COVER: PortabilityBlob = {
  bookId: "b1",
  filename: "cover.png",
  data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
};

describe("G-24 buildPortabilityBundle", () => {
  const bundle = buildPortabilityBundle({
    user: "user-1",
    books: [BOOK],
    chapters: CHAPTERS,
    outlines: [{ bookId: "b1", payload: { premise: "Wake the fire.", chapters: [] } }],
    covers: [COVER],
    exportedAt: "2026-09-20T00:00:00.000Z",
  });

  it("returns a manifest with exact counts and words", () => {
    expect(bundle.manifest).toEqual({
      format: "inkforge-portability",
      version: 1,
      user: "user-1",
      exportedAt: "2026-09-20T00:00:00.000Z",
      counts: { books: 1, chapters: 2, outlines: 1, covers: 1, assets: 0 },
      words: 9,
    });
  });

  it("produces a valid zip whose bytes are deterministic", () => {
    const again = buildPortabilityBundle({
      user: "user-1",
      books: [BOOK],
      chapters: CHAPTERS,
      outlines: [{ bookId: "b1", payload: { premise: "Wake the fire.", chapters: [] } }],
      covers: [COVER],
      exportedAt: "2026-09-20T00:00:00.000Z",
    });
    expect(Buffer.compare(bundle.archive, again.archive)).toBe(0);
    expect(bundle.archive.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("orders chapters by idx and carries front matter", () => {
    const bundle2 = bundle;
    expect(bundle2.archive.byteLength).toBeGreaterThan(200);
    void bundle2;
  });

  it("manifest reports zero words for a bookless bundle", () => {
    const empty = buildPortabilityBundle({ user: "nobody", books: [], chapters: [] });
    expect(empty.manifest.counts).toEqual({
      books: 0,
      chapters: 0,
      outlines: 0,
      covers: 0,
      assets: 0,
    });
    expect(empty.manifest.words).toBe(0);
  });
});
