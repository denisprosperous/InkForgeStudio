/**
 * G-16 — Voiceprint v1 (B6): target-author voice matching.
 *
 * Distills reference prose into a deterministic numeric signature (sentence
 * rhythm, lexical measures, contraction habit) and scores candidate text
 * against it. Pure functions — no model calls — so profiles and fits are
 * reproducible in CI. Wraps the humanize engine's metrics; never edits it.
 */
import { z } from "zod";

const voiceprintSchemaShape = {
  /** Mean words per sentence. */
  avgSentenceLength: z.number().min(0).max(200),
  /** Standard deviation of sentence length (rhythm). */
  sentenceLengthStdDev: z.number().min(0).max(200),
  /** Flesch reading ease 0..100. */
  fleschEase: z.number().min(0).max(100),
  /** Contractions per 1,000 words (voice habit marker). */
  contractionsPer1k: z.number().min(0).max(200),
  /** Dialogue share of sentences 0..1 (may be absent in reference prose). */
  dialogueRatio: z.number().min(0).max(1),
  /** Reference corpus size in words — weights the fit confidence. */
  referenceWords: z.number().int().min(0),
};

export const voiceprintSchema = z.object({
  ...voiceprintSchemaShape,
  avgSentenceLength: voiceprintSchemaShape.avgSentenceLength.default(17),
  sentenceLengthStdDev: voiceprintSchemaShape.sentenceLengthStdDev.default(6),
  fleschEase: voiceprintSchemaShape.fleschEase.default(65),
  contractionsPer1k: voiceprintSchemaShape.contractionsPer1k.default(10),
  dialogueRatio: voiceprintSchemaShape.dialogueRatio.default(0),
  referenceWords: voiceprintSchemaShape.referenceWords.default(0),
});
export type Voiceprint = z.infer<typeof voiceprintSchema>;

const DEFAULT_VOICEPRINT: Voiceprint = {
  avgSentenceLength: 17,
  sentenceLengthStdDev: 6,
  fleschEase: 65,
  contractionsPer1k: 10,
  dialogueRatio: 0,
  referenceWords: 0,
};

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[^a-z])/;
const CONTRACTION = /\b[a-z]+'(?:s|t|re|ve|ll|d|m)\b/gi;
const DIALOGUE = /[""«]|^\s*[-—–]\s*\S/m;

interface SampleMetrics {
  readonly avgSentenceLength: number;
  readonly sentenceLengthStdDev: number;
  readonly fleschEase: number;
  readonly contractionsPer1k: number;
  readonly dialogueRatio: number;
  readonly words: number;
}

function countSyllables(word: string): number {
  const groups = word
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function measure(markdown: string): SampleMetrics {
  const prose = markdown
    .split("\n")
    .filter((line) => !/^\s*(#|>|-{3,}|\*{3,}|[-*+]\s|\d+\.\s|\|)/.test(line.trim()))
    .join(" ")
    .replace(/[*_`>]/g, "");
  const sentences = prose
    .split(SENTENCE_SPLIT)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  const words = prose.match(/[A-Za-z0-9'’-]+/gu) ?? [];
  const wordCount = words.length;
  const syllables = words.reduce((total, word) => total + countSyllables(word), 0);
  const sentenceCount = sentences.length || 1;
  const avg = wordCount / sentenceCount;
  const variance =
    sentences.reduce((acc, sentence) => {
      const len = (sentence.match(/[A-Za-z0-9'’-]+/gu) ?? []).length;
      return acc + (len - avg) ** 2;
    }, 0) / sentenceCount;
  const fleschEase = wordCount === 0 ? 100 : 206.835 - 1.015 * avg - 84.6 * (syllables / wordCount);
  const contractions = (prose.match(CONTRACTION) ?? []).length;
  const dialogueSentences = sentences.filter((sentence) => DIALOGUE.test(sentence)).length;
  return {
    avgSentenceLength: round2(avg),
    sentenceLengthStdDev: round2(Math.sqrt(variance)),
    fleschEase: round2(Math.max(0, Math.min(100, fleschEase))),
    contractionsPer1k: round2(wordCount === 0 ? 0 : (contractions / wordCount) * 1_000),
    dialogueRatio: round2(sentences.length === 0 ? 0 : dialogueSentences / sentences.length),
    words: wordCount,
  };
}

/** Distill reference prose into a voice profile (pure, deterministic). */
export function buildVoiceprint(referenceMarkdown: string): Voiceprint {
  const metrics = measure(referenceMarkdown);
  return voiceprintSchema.parse({
    avgSentenceLength: metrics.avgSentenceLength,
    sentenceLengthStdDev: metrics.sentenceLengthStdDev,
    fleschEase: metrics.fleschEase,
    contractionsPer1k: metrics.contractionsPer1k,
    dialogueRatio: metrics.dialogueRatio,
    referenceWords: metrics.words,
  });
}

/** Per-metric normalized distance between a sample and the profile. */
export function voiceDistance(sampleMarkdown: string, profile: Voiceprint): number {
  const sample = measure(sampleMarkdown);
  const effective = sample.words < 30 ? { ...DEFAULT_VOICEPRINT, ...profile } : profile;
  const gaps = [
    Math.abs(sample.avgSentenceLength - effective.avgSentenceLength),
    Math.abs(sample.sentenceLengthStdDev - effective.sentenceLengthStdDev),
    Math.abs(sample.fleschEase - effective.fleschEase) / 4,
    Math.abs(sample.contractionsPer1k - effective.contractionsPer1k) / 4,
    Math.abs(sample.dialogueRatio - effective.dialogueRatio) * 20,
  ];
  return round2(gaps.reduce((total, gap) => total + gap, 0));
}

/** Overall voice fit 0..1 (1 = indistinguishable from the profile). */
export function voiceFit(sampleMarkdown: string, profile: Voiceprint): number {
  return Math.max(0, Math.min(1, round2(1 - voiceDistance(sampleMarkdown, profile) / 60)));
}

export interface VoiceReport {
  readonly distance: number;
  readonly fit: number;
  readonly sample: Voiceprint;
  readonly profile: Voiceprint;
  /** Suggested humanize targets to close the largest gap first. */
  readonly advice: readonly string[];
}

/** Full deterministic comparison report, ready for the studio UI. */
export function voiceReport(sampleMarkdown: string, profile: Voiceprint): VoiceReport {
  const sampleMetrics = measure(sampleMarkdown);
  const effective = sampleMetrics.words < 30 ? { ...DEFAULT_VOICEPRINT, ...profile } : profile;
  const sample: Voiceprint = {
    avgSentenceLength: sampleMetrics.avgSentenceLength,
    sentenceLengthStdDev: sampleMetrics.sentenceLengthStdDev,
    fleschEase: sampleMetrics.fleschEase,
    contractionsPer1k: sampleMetrics.contractionsPer1k,
    dialogueRatio: sampleMetrics.dialogueRatio,
    referenceWords: sampleMetrics.words,
  };
  const gaps: [string, number, string][] = [
    [
      "sentence-length",
      Math.abs(sample.avgSentenceLength - effective.avgSentenceLength),
      sample.avgSentenceLength > effective.avgSentenceLength
        ? "Shorten sentences toward the profile's average."
        : "Let sentences run longer toward the profile's average.",
    ],
    [
      "rhythm",
      Math.abs(sample.sentenceLengthStdDev - effective.sentenceLengthStdDev),
      sample.sentenceLengthStdDev > effective.sentenceLengthStdDev
        ? "Even out sentence-length swings."
        : "Vary sentence length more.",
    ],
    [
      "reading-ease",
      Math.abs(sample.fleschEase - effective.fleschEase) / 4,
      sample.fleschEase > effective.fleschEase
        ? "Choose heavier words where the profile does."
        : "Simplify diction toward the profile's reading ease.",
    ],
    [
      "contractions",
      Math.abs(sample.contractionsPer1k - effective.contractionsPer1k) / 4,
      sample.contractionsPer1k > effective.contractionsPer1k
        ? "Spell out contractions where the profile would."
        : "Contract more words to match the profile's habit.",
    ],
    [
      "dialogue",
      Math.abs(sample.dialogueRatio - effective.dialogueRatio) * 20,
      sample.dialogueRatio > effective.dialogueRatio
        ? "Convert some dialogue to narration."
        : "Let characters speak more.",
    ],
  ];
  gaps.sort((a, b) => b[1] - a[1]);
  return {
    distance: voiceDistance(sampleMarkdown, profile),
    fit: voiceFit(sampleMarkdown, profile),
    sample,
    profile,
    advice: gaps
      .slice(0, 3)
      .filter(([, gap]) => gap > 0.5)
      .map(([, , hint]) => hint),
  };
}
