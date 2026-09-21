/**
 * G-25 — reader simulation panel (C2), deterministic first per register §4:
 * no LLM judges, no stochastic sampling. Personas are explicit preferences;
 * the engagement model is pure arithmetic over chapter structure, so panel
 * results are reproducible and can be regression-tested. An LLM-judge layer
 * may sit on top later without changing this contract.
 */
import { describe, expect, it } from "vitest";
import {
  PANEL_PRESETS,
  readerPersonaSchema,
  simulatePanel,
  simulateReader,
  type ReaderChapter,
} from "@inkforge/core";

function chapter(idx: number, markdown: string): ReaderChapter {
  return { idx, markdown, title: `Chapter ${idx + 1}` };
}

const HOOKED = chapter(
  0,
  'The lamp exploded. "Run!" Mara shouted, and she was already moving through the dark.',
);
const EXPOSITION_HEAVY = chapter(
  1,
  "It is important to note that the historical context of the region, which had been shaped by centuries of administrative reform and its attendant fiscal consequences, was in many respects a precursor to the events that followed, and moreover the institutional memory of those reforms persisted in the bureaucracy long after the principals had departed from public life entirely.",
);
const DIALOGUE_HEAVY = chapter(
  2,
  '"Why now?" she asked. "Because the gate opened," he said. "And nobody closed it." "Then we close it," she said.',
);
const NEUTRAL = chapter(
  3,
  "Mara walked to the market and bought bread. She returned before dusk and fed the fire.",
);

const BORING = [HOOKED, EXPOSITION_HEAVY, EXPOSITION_HEAVY, NEUTRAL];

describe("G-25 persona contract", () => {
  it("defaults a persona and rejects out-of-range prefs", () => {
    const persona = readerPersonaSchema.parse({ name: "Skim reader" });
    expect(persona.attentionSpanChapters).toBeGreaterThan(0);
    expect(persona.dialoguePreference).toBeGreaterThanOrEqual(0);
    expect(() => readerPersonaSchema.parse({ name: "Bad", genreAffinity: 2 })).toThrow();
  });

  it("ships at least three presets with distinct preferences", () => {
    expect(PANEL_PRESETS.length).toBeGreaterThanOrEqual(3);
    const names = PANEL_PRESETS.map((persona) => persona.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("G-25 per-chapter engagement", () => {
  it("scores a hook chapter above an exposition wall", () => {
    const hook = simulateReader([HOOKED, NEUTRAL], PANEL_PRESETS[0]!).chapters[0]!;
    const wall = simulateReader([EXPOSITION_HEAVY, NEUTRAL], PANEL_PRESETS[0]!).chapters[0]!;
    expect(hook.engagement).toBeGreaterThan(wall.engagement);
    expect(hook.hookScore).toBeGreaterThan(wall.hookScore);
  });

  it("lets a dialogue-loving persona diverge from an exposition-tolerant one", () => {
    const dialoguePersona = readerPersonaSchema.parse({
      name: "Dialogue lover",
      dialoguePreference: 1,
      patienceWithExposition: 0,
    });
    const patientPersona = readerPersonaSchema.parse({
      name: "Patient reader",
      dialoguePreference: 0,
      patienceWithExposition: 1,
    });
    const dialogueChapter = simulateReader([DIALOGUE_HEAVY], dialoguePersona).chapters[0]!;
    const dialogueForPatient = simulateReader([DIALOGUE_HEAVY], patientPersona).chapters[0]!;
    const wallForDialogue = simulateReader([EXPOSITION_HEAVY], dialoguePersona).chapters[0]!;
    const wallForPatient = simulateReader([EXPOSITION_HEAVY], patientPersona).chapters[0]!;
    expect(dialogueChapter.engagement).toBeGreaterThan(dialogueForPatient.engagement);
    expect(wallForPatient.engagement).toBeGreaterThan(wallForDialogue.engagement);
  });

  it("reports where a reader drops off in a boring middle", () => {
    const skim = PANEL_PRESETS[0]!;
    const result = simulateReader(BORING, { ...skim, attentionSpanChapters: 1 });
    expect(result.dropOffChapter).not.toBeNull();
    expect(result.dropOffChapter).toBeGreaterThanOrEqual(1);
    expect(result.completion).toBeLessThan(1);
  });

  it("keeps a hooked reader to the end", () => {
    const hooked = [HOOKED, DIALOGUE_HEAVY, HOOKED, DIALOGUE_HEAVY];
    const result = simulateReader(hooked, PANEL_PRESETS[0]!);
    expect(result.dropOffChapter).toBeNull();
    expect(result.completion).toBe(1);
  });
});

describe("G-25 panel", () => {
  const report = simulatePanel(BORING);

  it("summarizes every persona and names consensus weak chapters", () => {
    expect(report.readers).toHaveLength(PANEL_PRESETS.length);
    expect(report.meanCompletion).toBeGreaterThanOrEqual(0);
    expect(report.meanCompletion).toBeLessThanOrEqual(1);
    expect(report.weakChapters.length).toBeGreaterThan(0);
    expect(report.weakChapters).toContain(1);
  });

  it("is deterministic", () => {
    expect(simulatePanel(BORING)).toEqual(report);
  });

  it("handles an empty manuscript without throwing", () => {
    const empty = simulatePanel([]);
    expect(empty.meanCompletion).toBe(1);
    expect(empty.weakChapters).toEqual([]);
  });
});
