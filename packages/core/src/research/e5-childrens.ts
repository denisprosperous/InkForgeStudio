/**
 * Adapter E-5 — children's reading levels.
 *
 * Age bands carry hard word/sentence limits and a content-safety gate: the
 * platform refuses to draft age-inappropriate material for the chosen band
 * rather than softening it silently.
 */

export interface AgeBand {
  readonly id: "picture-3-5" | "picture-6-8" | "chapter-9-12";
  readonly label: string;
  readonly maxWords: number;
  readonly maxWordsPerSentence: number;
}

export const AGE_BANDS: readonly AgeBand[] = [
  { id: "picture-3-5", label: "Picture book, ages 3–5", maxWords: 500, maxWordsPerSentence: 8 },
  { id: "picture-6-8", label: "Picture book, ages 6–8", maxWords: 1_500, maxWordsPerSentence: 12 },
  { id: "chapter-9-12", label: "Chapter book, ages 9–12", maxWords: 25_000, maxWordsPerSentence: 18 },
];

/** Words that push content out of an early-reader band. */
const UNSAFE_FOR_EARLY = /\b(violent|violence|terror|gore|murder|slaughter|abuse|trauma)\b/i;
/** Long words raise the reading load in early readers. */
const LONG_WORD = 3;

export interface ReadingLevel {
  readonly words: number;
  readonly sentences: number;
  readonly wordsPerSentence: number;
  readonly longWordShare: number;
  readonly gradeBand: "early" | "middle" | "advanced";
}

export function assessReadingLevel(text: string): ReadingLevel {
  const sentences = text
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  const words = (text.match(/[A-Za-z'’-]+/gu) ?? []).map((word) => word.toLowerCase());
  const sentenceCount = sentences.length === 0 ? 1 : sentences.length;
  const wordsPerSentence = Math.round((words.length / sentenceCount) * 10) / 10;
  const longWords = words.filter(
    (word) => (word.match(/[aeiouy]+/g) ?? []).length >= LONG_WORD || word.length >= 9,
  ).length;
  const longWordShare = words.length === 0 ? 0 : Math.round((longWords / words.length) * 1000) / 1000;
  const gradeBand =
    wordsPerSentence <= 9 && longWordShare <= 0.12
      ? "early"
      : wordsPerSentence <= 16 && longWordShare <= 0.22
        ? "middle"
        : "advanced";
  return { words: words.length, sentences: sentenceCount, wordsPerSentence, longWordShare, gradeBand };
}

export interface PictureBookPlan {
  readonly band: AgeBand["id"];
  readonly pages: number;
  /** Page turns land on even multiples in a printed picture book. */
  readonly pageBreakTarget: number;
  readonly spreads: number;
  readonly maxWords: number;
  readonly maxWordsPerSentence: number;
  readonly verdict: "PASS" | "REFUSED";
  readonly refusalReason: string | null;
  readonly readingLevel: ReadingLevel | null;
}

export function buildPictureBookPlan(input: {
  readonly band: AgeBand["id"];
  readonly pages: number;
  readonly sampleText?: string;
}): PictureBookPlan {
  const band = AGE_BANDS.find((entry) => entry.id === input.band);
  if (!band) throw new Error(`unknown age band: ${String(input.band)}`);
  if (!Number.isInteger(input.pages) || input.pages < 8 || input.pages > 64) {
    throw new Error("picture-book page counts run between 8 and 64");
  }
  const readingLevel = input.sampleText === undefined ? null : assessReadingLevel(input.sampleText);
  const pageBreakTarget = input.pages % 2 === 0 ? input.pages : input.pages + 1;
  if (input.sampleText !== undefined && UNSAFE_FOR_EARLY.test(input.sampleText)) {
    return {
      band: band.id,
      pages: input.pages,
      pageBreakTarget,
      spreads: Math.floor(input.pages / 2),
      maxWords: band.maxWords,
      maxWordsPerSentence: band.maxWordsPerSentence,
      verdict: "REFUSED",
      refusalReason: `content is not appropriate for the age band ${band.id}`,
      readingLevel,
    };
  }
  return {
    band: band.id,
    pages: input.pages,
    pageBreakTarget,
    spreads: Math.floor(input.pages / 2),
    maxWords: band.maxWords,
    maxWordsPerSentence: band.maxWordsPerSentence,
    verdict: "PASS",
    refusalReason: null,
    readingLevel,
  };
}
