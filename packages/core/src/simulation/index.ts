/**
 * G-25 — reader simulation panel (C2), deterministic first (register §4).
 *
 * Personas are explicit preferences; the engagement model is pure arithmetic
 * over chapter structure (hook strength, dialogue share, sentence-length
 * load, pacing deviation), so panel results are reproducible and
 * regression-testable. An LLM-judge layer may sit on top later without
 * changing this contract.
 */
import { z } from "zod";
import { countWords } from "../book/index";

export const readerPersonaSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** Chapters this reader will stay engaged without a strong hook. */
  attentionSpanChapters: z.number().int().min(1).max(50).default(3),
  /** 0 = indifferent to genre fit, 1 = only reads their genre. */
  genreAffinity: z.number().min(0).max(1).default(0.5),
  /** 0 = abandons exposition walls, 1 = tolerates them. */
  patienceWithExposition: z.number().min(0).max(1).default(0.5),
  /** 0 = prose-led, 1 = dialogue-led. */
  dialoguePreference: z.number().min(0).max(1).default(0.5),
});
export type ReaderPersona = z.infer<typeof readerPersonaSchema>;

/** Three presets covering the spread of real reading habits. */
export const PANEL_PRESETS: readonly ReaderPersona[] = [
  readerPersonaSchema.parse({
    name: "Skim reader",
    attentionSpanChapters: 1,
    genreAffinity: 0.4,
    patienceWithExposition: 0.2,
    dialoguePreference: 0.8,
  }),
  readerPersonaSchema.parse({
    name: "Genre devotee",
    attentionSpanChapters: 5,
    genreAffinity: 0.9,
    patienceWithExposition: 0.5,
    dialoguePreference: 0.5,
  }),
  readerPersonaSchema.parse({
    name: "Literary critic",
    attentionSpanChapters: 8,
    genreAffinity: 0.6,
    patienceWithExposition: 0.2,
    dialoguePreference: 0.3,
  }),
];

export interface ReaderChapter {
  readonly idx: number;
  readonly title: string;
  readonly markdown: string;
}

export interface ChapterEngagement {
  readonly idx: number;
  readonly hookScore: number;
  readonly dialogueRatio: number;
  readonly expositionLoad: number;
  /** Mean words per sentence (structure, not style). */
  readonly avgSentenceLength: number;
  /** 0..1 blended interest for this persona. */
  readonly engagement: number;
}

export interface ReaderResult {
  readonly persona: ReaderPersona;
  readonly chapters: readonly ChapterEngagement[];
  /** First chapter whose interest falls below the persona's patience. */
  readonly dropOffChapter: number | null;
  /** Share of chapters read before dropping off (1 = finished). */
  readonly completion: number;
}

export interface PanelReport {
  readonly readers: readonly ReaderResult[];
  readonly meanCompletion: number;
  /** Chapters the panel as a whole finds weak (mean engagement < 0.3). */
  readonly weakChapters: readonly number[];
  readonly meanEngagementByChapter: readonly number[];
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

function sentences(markdown: string): string[] {
  return markdown
    .replace(/[#>*_`]/g, "")
    .split(SENTENCE_SPLIT)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function analyze(markdown: string): Omit<ChapterEngagement, "idx" | "engagement"> {
  const parts = sentences(markdown);
  const words = countWords(markdown);
  const sentenceCount = parts.length || 1;
  const avgSentenceLength = round2(words / sentenceCount);
  const dialogueSentences = parts.filter((sentence) => /[""«]|^\s*[-—–]\s/.test(sentence)).length;
  const dialogueRatio = round2(dialogueSentences / sentenceCount);
  const longSentences = parts.filter(
    (sentence) => (sentence.match(/[A-Za-z0-9'’-]+/gu) ?? []).length >= 30,
  ).length;
  const connectives = (
    markdown.match(
      /\b(?:moreover|furthermore|additionally|it is important to note|in conclusion)\b/gi,
    ) ?? []
  ).length;
  const expositionLoad = Math.min(
    1,
    round2(0.6 * (longSentences / sentenceCount) + 0.4 * Math.min(1, connectives / 3)),
  );
  const opening = parts[0] ?? "";
  const openingWords = (opening.match(/[A-Za-z0-9'’-]+/gu) ?? []).length;
  const explosive = /[!?]/.test(opening) || /^[""«]/.test(opening.trim()) ? 0.3 : 0;
  const shortness = openingWords === 0 ? 0 : Math.max(0, 1 - openingWords / 25);
  const hookScore = Math.min(1, round2(0.7 * shortness + explosive));
  return { hookScore, dialogueRatio, expositionLoad, avgSentenceLength };
}

/** Deterministic per-chapter engagement for one persona. */
export function simulateReader(
  chapters: readonly ReaderChapter[],
  personaInput: ReaderPersona,
): ReaderResult {
  const persona = readerPersonaSchema.parse(personaInput);
  const engagements: ChapterEngagement[] = [];
  let dropOffChapter: number | null = null;

  const lengths = chapters.map((chapter) => countWords(chapter.markdown));
  const meanLength = lengths.length === 0 ? 0 : lengths.reduce((a, b) => a + b, 0) / lengths.length;

  chapters.forEach((chapter, index) => {
    const base = analyze(chapter.markdown);
    const length = lengths[index] ?? 0;
    const pacingPenalty =
      meanLength === 0 ? 0 : Math.min(0.3, Math.abs(length - meanLength) / (meanLength * 3));
    const dialogueFit = persona.dialoguePreference * base.dialogueRatio;
    const expositionPenalty = (1 - persona.patienceWithExposition) * base.expositionLoad;
    const genreBoost = 0.1 * persona.genreAffinity;
    const engagement = round2(
      Math.max(
        0,
        Math.min(
          1,
          0.45 * base.hookScore +
            0.25 * dialogueFit +
            genreBoost +
            0.2 -
            pacingPenalty -
            expositionPenalty,
        ),
      ),
    );
    engagements.push({ idx: chapter.idx, ...base, engagement });
    if (dropOffChapter === null && index >= persona.attentionSpanChapters && engagement < 0.25) {
      dropOffChapter = chapter.idx;
    }
  });

  const readChapters =
    dropOffChapter === null
      ? chapters.length
      : Math.max(
          1,
          engagements.findIndex((entry) => entry.idx === dropOffChapter),
        );
  return {
    persona,
    chapters: engagements,
    dropOffChapter,
    completion: chapters.length === 0 ? 1 : round2(readChapters / chapters.length),
  };
}

/** Run the whole panel (or a custom one) and summarize consensus. */
export function simulatePanel(
  chapters: readonly ReaderChapter[],
  personas: readonly ReaderPersona[] = PANEL_PRESETS,
): PanelReport {
  const readers = personas.map((persona) => simulateReader(chapters, persona));
  if (readers.length === 0 || chapters.length === 0) {
    return { readers, meanCompletion: 1, weakChapters: [], meanEngagementByChapter: [] };
  }
  const meanCompletion = round2(
    readers.reduce((total, reader) => total + reader.completion, 0) / readers.length,
  );
  const meanEngagementByChapter = chapters.map((_chapter, index) =>
    round2(
      readers.reduce((total, reader) => total + (reader.chapters[index]?.engagement ?? 0), 0) /
        readers.length,
    ),
  );
  const weakChapters = chapters
    .map((chapter, index) => ({
      idx: chapter.idx,
      engagement: meanEngagementByChapter[index] ?? 1,
    }))
    .filter((row) => row.engagement < 0.3)
    .map((row) => row.idx);
  return { readers, meanCompletion, weakChapters, meanEngagementByChapter };
}
