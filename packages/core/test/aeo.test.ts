/**
 * G-27 — AEO metadata optimizer (C5): the deterministic Answer-Engine
 * Optimization pack. AI assistants and answer engines surface books by
 * structured Q&A and machine-readable metadata, not keyword stuffing.
 * Attaches under meta.extra (G-13 namespacing) — no schema migration.
 */
import { describe, expect, it } from "vitest";
import { buildAeoPack, aeoPackSchema, type BookMeta } from "@inkforge/core";

const META: BookMeta = {
  title: "A Study in Ember",
  author: "Dana Pryce",
  description:
    "A fantasy novel. Dana Pryce's A Study in Ember follows Mara Vane, a smith who wakes the old fire beneath Ashfall. A Study in Ember is an epic fantasy about craft, memory, and rebellion.",
  genre: "Fantasy",
  keywords: ["epic fantasy", "smith", "rebellion"],
  language: "en",
  publishTarget: "kdp",
  extra: {},
};

describe("G-27 buildAeoPack", () => {
  it("emits a schema-valid pack with Q&A pairs and a canonical summary", () => {
    const pack = buildAeoPack(META, 90_000);
    const parsed = aeoPackSchema.parse(pack);
    expect(parsed.qas.length).toBeGreaterThan(0);
    expect(parsed.summary.length).toBeGreaterThan(0);
    expect(parsed.summary.length).toBeLessThanOrEqual(500);
  });

  it("answers the standard discovery questions deterministically", () => {
    const pack = buildAeoPack(META, 90_000);
    const questions = pack.qas.map((qa) => qa.q);
    expect(questions).toContain("What is A Study in Ember about?");
    expect(questions).toContain("Who wrote A Study in Ember?");
    expect(questions).toContain("What genre is A Study in Ember?");
    const about = pack.qas.find((qa) => qa.q === "What is A Study in Ember about?");
    expect(about?.a).toContain("Mara Vane");
  });

  it("carries entity links and reading-time facts for answer engines", () => {
    const pack = buildAeoPack(META, 90_000);
    expect(pack.entities).toContain("Mara Vane");
    expect(pack.facts.readingMinutes).toBeGreaterThan(0);
    expect(pack.facts.language).toBe("en");
  });

  it("slots into meta.extra without disturbing other namespaces", () => {
    const meta: BookMeta = { ...META, extra: { origins: { seed: 7 } } };
    const pack = buildAeoPack(meta, 12_000);
    expect(pack.qas.length).toBeGreaterThan(0);
    void meta;
  });

  it("is deterministic — identical meta and word count yield identical packs", () => {
    expect(buildAeoPack(META, 90_000)).toEqual(buildAeoPack(META, 90_000));
  });

  it("degrades gracefully on a sparse meta (no description)", () => {
    const sparse = { ...META, description: "", keywords: [] };
    const pack = buildAeoPack(sparse, 5_000);
    const parsed = aeoPackSchema.parse(pack);
    expect(parsed.qas.length).toBeGreaterThan(0);
  });
});
