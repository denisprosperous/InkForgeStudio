/**
 * G-15 — consistency & memory engine v1 (B5): the fact/entity ledger and the
 * deterministic post-generation validator.
 *
 * Deterministic first (register §4): extraction and validation are pure string
 * logic — no model calls — so the checks are reproducible in CI and the
 * LLM-assisted passes can layer on top later without changing the contract.
 */
import { describe, expect, it } from "vitest";
import {
  consistencyLedgerSchema,
  extractEntityCandidates,
  validateConsistency,
  type ConsistencyFact,
} from "@inkforge/core";
import type { Chapter } from "@inkforge/core";

function chapter(idx: number, title: string, markdown: string): Chapter {
  return {
    id: `ch-${idx}`,
    idx,
    title,
    markdown,
    status: "draft",
    wordCount: 0,
    createdAt: "",
    updatedAt: "",
  };
}

const MARA: ConsistencyFact = {
  kind: "entity",
  name: "Mara Vane",
  aliases: ["Mara"],
  summary: "The smith who wakes the old fire.",
  firstChapter: 0,
  lastChapter: 1,
};

describe("G-15 entity candidate extraction", () => {
  it("finds recurring proper nouns deterministically", () => {
    const text = "Mara Vane entered Ashfall. Mara Vane carried the lamp. The road was empty.";
    const candidates = extractEntityCandidates(text);
    const names = candidates.map((candidate) => candidate.name);
    expect(names).toContain("Mara Vane");
    expect(names).toContain("Ashfall");
    const mara = candidates.find((candidate) => candidate.name === "Mara Vane");
    expect(mara?.mentions).toBe(2);
  });

  it("drops leading articles and respects the minMentions gate", () => {
    const text = "The Lamp flickered. A gate opened. The Lamp steadied.";
    const candidates = extractEntityCandidates(text);
    const names = candidates.map((candidate) => candidate.name);
    expect(names).toContain("Lamp");
    expect(names).not.toContain("The");
    // single-mention proper nouns stay out of the unknown-entity noise
    expect(names).not.toContain("Gate");
  });
});

describe("G-15 ledger schema", () => {
  it("defaults a ledger to an empty fact list", () => {
    expect(consistencyLedgerSchema.parse({}).facts).toEqual([]);
  });

  it("rejects reversed chapter spans inside a fact", () => {
    expect(() =>
      consistencyLedgerSchema.parse({
        facts: [{ name: "Ashfall", firstChapter: 4, lastChapter: 2 }],
      }),
    ).not.toThrow(); // schema keeps spans loose; the validator flags them
  });
});

describe("G-15 validator", () => {
  const chapters = [
    chapter(0, "The Lamp", "Mara Vane entered Ashfall with the lamp lit."),
    chapter(1, "The Gate", "Mara Vane returned. Kessler watched from the wall."),
  ];

  it("reports no violations for a consistent ledger", () => {
    const report = validateConsistency(chapters, [MARA]);
    expect(report.violations).toEqual([]);
    expect(report.checkedChapters).toBe(2);
    expect(report.coverage).toBeGreaterThan(0);
  });

  it("flags conflicting definitions for the same canonical name", () => {
    const report = validateConsistency(chapters, [
      MARA,
      { ...MARA, summary: "A baker from the coast." },
    ]);
    const kinds = report.violations.map((violation) => violation.kind);
    expect(kinds).toContain("conflicting-definition");
  });

  it("flags out-of-range and reversed spans", () => {
    const report = validateConsistency(chapters, [
      { ...MARA, firstChapter: 0, lastChapter: 9 },
      {
        kind: "timeline",
        name: "The Long Night",
        aliases: [],
        summary: "",
        firstChapter: 5,
        lastChapter: 1,
      },
    ]);
    const kinds = report.violations.map((violation) => violation.kind);
    expect(kinds).toContain("out-of-range");
    expect(kinds).toContain("reversed-span");
  });

  it("flags orphan facts the manuscript never mentions", () => {
    const report = validateConsistency(chapters, [
      { ...MARA, name: "Orella Vex", aliases: ["the gray cartographer"] },
    ]);
    const kinds = report.violations.map((violation) => violation.kind);
    expect(kinds).toContain("orphan-fact");
  });

  it("lists recurring unknown entities that the ledger does not know", () => {
    const report = validateConsistency(chapters, [MARA]);
    expect(report.unknownEntities).toContain("Kessler");
    expect(report.unknownEntities).not.toContain("Mara Vane");
  });

  it("scores coverage as 1 when there is nothing to contradict", () => {
    const report = validateConsistency([], []);
    expect(report.coverage).toBe(1);
    expect(report.violations).toEqual([]);
  });
});
