/**
 * G-30g — localization package (per-market edition input).
 *
 * Deterministic segmentation of a manuscript into translatable segments with
 * stable keys plus the market's metadata. This is the hand-off artifact for
 * human translators or a TMS — the platform does not fabricate translations,
 * and coverage stays 0% until translations are supplied.
 */
import type { BookMeta } from "../book/index";
import type { PrintChapterInput } from "../print/index";

export interface LocalizationTarget {
  readonly language: string;
  readonly territory: string;
  readonly currency: string;
}

export interface LocalizationSegment {
  readonly key: string;
  readonly chapterIndex: number;
  readonly sourceText: string;
  readonly targetLanguage: string;
  readonly translatedText: string | null;
}

export interface LocalizationPackage {
  readonly bookTitle: string;
  readonly sourceLanguage: string;
  readonly target: LocalizationTarget;
  readonly segments: readonly LocalizationSegment[];
  readonly stats: {
    readonly segments: number;
    readonly words: number;
    readonly translatedSegments: number;
    readonly coveragePercent: number;
  };
}

const LANGUAGE = /^[a-z]{2}$/;
const TERRITORY = /^[A-Z]{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

export function buildLocalizationPackage(
  meta: BookMeta,
  chapters: readonly PrintChapterInput[],
  target: LocalizationTarget,
): LocalizationPackage {
  if (!LANGUAGE.test(target.language)) throw new Error("language must be ISO-639-1 (two letters)");
  if (!TERRITORY.test(target.territory)) throw new Error("territory must be ISO-3166-1 alpha-2");
  if (!CURRENCY.test(target.currency)) throw new Error("currency must be ISO-4217 alpha-3");

  const segments: LocalizationSegment[] = [];
  chapters.forEach((chapter, chapterIndex) => {
    const paragraphs = chapter.markdown
      .replace(/\r/g, "")
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0);
    paragraphs.forEach((paragraph, segmentIndex) => {
      segments.push({
        key: `ch${chapterIndex}-s${segmentIndex}`,
        chapterIndex,
        sourceText: paragraph,
        targetLanguage: target.language,
        translatedText: null,
      });
    });
  });

  const words = segments.reduce(
    (total, segment) => total + (segment.sourceText.match(/\S+/gu) ?? []).length,
    0,
  );
  const translatedSegments = segments.filter(
    (segment) => segment.translatedText !== null && segment.translatedText.length > 0,
  ).length;
  return {
    bookTitle: meta.title,
    sourceLanguage: meta.language,
    target,
    segments,
    stats: {
      segments: segments.length,
      words,
      translatedSegments,
      coveragePercent:
        segments.length === 0 ? 0 : Math.round((translatedSegments / segments.length) * 1000) / 10,
    },
  };
}
