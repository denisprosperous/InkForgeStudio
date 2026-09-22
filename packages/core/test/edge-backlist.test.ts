/**
 * G-30b — backlist resurrection (C6). Deterministic dormancy assessment and
 * a revival plan assembled from the book's own signals — no market claims,
 * only actions with stated reasons.
 */
import { describe, expect, it } from "vitest";
import { assessBacklist, buildRevivalPlan, type BacklistItem } from "@inkforge/core";

const NOW = "2026-09-22T00:00:00Z";

const ITEMS: BacklistItem[] = [
  {
    bookId: "b-old",
    title: "Quiet Machines",
    status: "published",
    updatedAt: "2025-01-01T00:00:00.000Z",
    chapters: 20,
    words: 60_000,
    hasCover: false,
    keywords: ["automata"],
    seriesLabel: "",
    lastSaleAt: "2025-02-01T00:00:00.000Z",
  },
  {
    bookId: "b-fresh",
    title: "New Signal",
    status: "published",
    updatedAt: "2026-09-01T00:00:00.000Z",
    chapters: 18,
    words: 55_000,
    hasCover: true,
    keywords: ["a", "b", "c", "d", "e", "f"],
    seriesLabel: "Signal Cycle",
    lastSaleAt: "2026-09-10T00:00:00.000Z",
  },
  {
    bookId: "b-never",
    title: "Never Sold",
    status: "published",
    updatedAt: "2025-06-01T00:00:00.000Z",
    chapters: 10,
    words: 30_000,
    hasCover: true,
    keywords: ["x"],
    seriesLabel: "",
  },
];

describe("G-30b dormancy assessment", () => {
  it("classifies by dormancy window and sales history, newest-opportunity first", () => {
    const report = assessBacklist(ITEMS, { now: NOW, dormantDays: 180 });
    expect(report.items.map((item) => item.bookId)).toEqual(["b-old", "b-never", "b-fresh"]);
    const old = report.items[0]!;
    expect(old.bucket).toBe("dormant");
    expect(old.daysDormant).toBeGreaterThan(180);
    const fresh = report.items.find((item) => item.bookId === "b-fresh")!;
    expect(fresh.bucket).toBe("active");
  });

  it("flags books that have never sold as neglected", () => {
    const report = assessBacklist(ITEMS, { now: NOW, dormantDays: 180 });
    expect(report.items.find((item) => item.bookId === "b-never")!.bucket).toBe("neglected");
    expect(report.stats.neglected).toBe(1);
    expect(report.stats.dormant).toBe(1);
  });

  it("is deterministic and empty-safe", () => {
    expect(assessBacklist(ITEMS, { now: NOW, dormantDays: 180 })).toEqual(
      assessBacklist(ITEMS, { now: NOW, dormantDays: 180 }),
    );
    expect(assessBacklist([], { now: NOW, dormantDays: 180 }).items).toEqual([]);
  });
});

describe("G-30b revival plan", () => {
  it("derives actions from the item's own signals, each with a reason", () => {
    const plan = buildRevivalPlan(
      {
        bookId: "b-old",
        title: "Quiet Machines",
        status: "published",
        updatedAt: "2025-01-01T00:00:00.000Z",
        chapters: 20,
        words: 60_000,
        hasCover: false,
        keywords: ["automata"],
        seriesLabel: "",
        lastSaleAt: "2025-02-01T00:00:00.000Z",
      },
      { now: NOW },
    );
    const actions = plan.actions.map((action) => action.action);
    expect(actions).toContain("new-cover");
    expect(actions).toContain("expand-keywords");
    expect(actions).toContain("price-review");
    expect(actions).toContain("audiobook-candidate");
    expect(actions).toContain("series-link");
    for (const action of plan.actions) expect(action.reason.length).toBeGreaterThan(0);
    expect(plan.actions.map((action) => action.priority)).toEqual(
      [...plan.actions].map((action) => action.priority).sort((a, b) => a - b),
    );
  });

  it("plans nothing for a healthy book", () => {
    const plan = buildRevivalPlan(
      {
        bookId: "b-fresh",
        title: "New Signal",
        status: "published",
        updatedAt: "2026-09-01T00:00:00.000Z",
        chapters: 18,
        // Under the audiobook threshold on purpose: this fixture is healthy
        // in every signal, so the plan must be empty.
        words: 25_000,
        hasCover: true,
        keywords: ["a", "b", "c", "d", "e", "f"],
        seriesLabel: "Signal Cycle",
        lastSaleAt: "2026-09-10T00:00:00.000Z",
      },
      { now: NOW },
    );
    expect(plan.actions).toEqual([]);
  });

  it("flags a long book as an audiobook candidate", () => {
    const plan = buildRevivalPlan(
      {
        bookId: "b-long",
        title: "Long Haul",
        status: "published",
        updatedAt: NOW,
        chapters: 30,
        words: 90_000,
        hasCover: true,
        keywords: ["a", "b", "c", "d", "e"],
        seriesLabel: "Long Cycle",
        lastSaleAt: NOW,
      },
      { now: NOW },
    );
    expect(plan.actions.map((action) => action.action)).toEqual(["audiobook-candidate"]);
  });

  it("is deterministic", () => {
    const item = ITEMS[0]!;
    expect(buildRevivalPlan(item)).toEqual(buildRevivalPlan(item));
  });
});
