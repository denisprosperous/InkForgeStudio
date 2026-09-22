/**
 * G-30a — cover A/B assignment and winner selection (C4).
 * Deterministic: bucket assignment is a pure hash of the book id (stable
 * across processes) and the winner is chosen from observed CTR with a
 * minimum-sample guard, never from invented numbers.
 */
import { describe, expect, it } from "vitest";
import {
  assignCoverVariant,
  pickCoverWinner,
  type CoverSample,
  type CoverVariant,
} from "@inkforge/core";

const VARIANTS: CoverVariant[] = [
  { variant: "A", label: "Ember close-up" },
  { variant: "B", label: "City wide shot" },
];

describe("G-30a assignment", () => {
  it("assigns a variant deterministically for a given book id", () => {
    const first = assignCoverVariant({ bookId: "b-123", variants: VARIANTS });
    const again = assignCoverVariant({ bookId: "b-123", variants: VARIANTS });
    expect(first).toEqual(again);
    expect(["A", "B"]).toContain(first.variant);
  });

  it("spreads assignments across both variants", () => {
    const seen = new Set(
      Array.from({ length: 200 }, (_, i) =>
        assignCoverVariant({ bookId: `book-${i}`, variants: VARIANTS }).variant,
      ),
    );
    expect(seen.size).toBe(2);
  });

  it("rejects an empty variant list", () => {
    expect(() => assignCoverVariant({ bookId: "b", variants: [] })).toThrow();
  });
});

describe("G-30a winner selection", () => {
  const SAMPLES: CoverSample[] = [
    { variant: "A", impressions: 1000, clicks: 40 },
    { variant: "B", impressions: 1000, clicks: 62 },
  ];

  it("picks the higher-CTR variant once both clear the sample floor", () => {
    const result = pickCoverWinner(SAMPLES, { minImpressions: 500 });
    expect(result.winner).toBe("B");
    expect(result.ctr.B).toBeCloseTo(0.062, 4);
    expect(result.reason).toContain("CTR");
  });

  it("refuses to call a winner below the impression floor", () => {
    const result = pickCoverWinner(
      [
        { variant: "A", impressions: 100, clicks: 10 },
        { variant: "B", impressions: 40, clicks: 12 },
      ],
      { minImpressions: 500 },
    );
    expect(result.winner).toBeNull();
    expect(result.reason).toContain("insufficient");
  });

  it("breaks exact ties by variant name and is deterministic", () => {
    const tied: CoverSample[] = [
      { variant: "B", impressions: 1000, clicks: 50 },
      { variant: "A", impressions: 1000, clicks: 50 },
    ];
    expect(pickCoverWinner(tied, { minImpressions: 500 }).winner).toBe("A");
    expect(pickCoverWinner(tied, { minImpressions: 500 })).toEqual(
      pickCoverWinner(tied, { minImpressions: 500 }),
    );
  });

  it("returns null for empty samples", () => {
    expect(pickCoverWinner([], { minImpressions: 1 }).winner).toBeNull();
  });
});
