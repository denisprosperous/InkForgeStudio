/**
 * @inkforge/core — the publishing domain.
 *
 * Pure, dependency-light logic every other workspace builds on: the book model,
 * the humanization engine, KDP-grade formatting, EPUB export and validation.
 * Nothing here knows about HTTP, databases or specific AI vendors.
 */
import { z } from "zod";

export { productMetadataSchema, MATURITY_RATINGS } from "./product";
export type { ProductMetadata, MaturityRating } from "./product";

export const CHAPTER_STATUSES = ["draft", "humanized", "final"] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

export const bookMetaSchema = z.object({
  title: z.string().min(1).max(300),
  subtitle: z.string().max(300).optional(),
  author: z.string().min(1).max(200),
  description: z.string().max(4_000).default(""),
  genre: z.string().min(1).max(120).default("General"),
  keywords: z.array(z.string().min(1).max(80)).max(12).default([]),
  language: z.string().min(2).max(12).default("en"),
  seriesLabel: z.string().max(160).optional(),
  publishTarget: z.literal("kdp").default("kdp"),
  /** G-13: namespaced extension payload — unknown keys must never break parse. */
  extra: z.record(z.string().min(1).max(64), z.unknown()).default({}),
});
export type BookMeta = z.infer<typeof bookMetaSchema>;

export const chapterSchema = z.object({
  id: z.string().min(1),
  idx: z.number().int().min(0),
  title: z.string().min(1).max(300),
  markdown: z.string().default(""),
  status: z.enum(CHAPTER_STATUSES).default("draft"),
  wordCount: z.number().int().min(0).default(0),
  createdAt: z.string().default(""),
  updatedAt: z.string().default(""),
});
export type Chapter = z.infer<typeof chapterSchema>;

export const outlineBeatSchema = z.object({
  idx: z.number().int().min(0),
  title: z.string().min(1).max(300),
  brief: z.string().max(2_000).default(""),
  targetWords: z.number().int().min(50).max(20_000).default(1_200),
});
export type OutlineBeat = z.infer<typeof outlineBeatSchema>;

export const outlineSchema = z.object({
  premise: z.string().max(4_000).default(""),
  genre: z.string().max(120).default("General"),
  acts: z.array(z.string().min(1).max(200)).max(9).default([]),
  chapters: z.array(outlineBeatSchema).min(1).max(120),
});
export type Outline = z.infer<typeof outlineSchema>;

/** KDP's upper bound for a reflowable ebook body. */
export const KDP_MAX_WORDS = 650_000;
/** Words/day a healthy drafting cadence implies for a 90-day run. */
export const HEALTHY_DAILY_WORDS = 1_111;

/** Count words the way word processors do: whitespace-separated runs. */
export function countWords(markdown: string): number {
  const stripped = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~\-]+/g, " ");
  const matches = stripped.match(/\S+/gu);
  return matches ? matches.length : 0;
}

/** Average adult reading speed ≈ 238 wpm; a chapter never reads as 0 minutes. */
export function readingMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 238));
}

/** URL-safe kebab-case slug used for filenames and export identifiers. */
export function slugify(input: string, maxWords = 8): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return slug.split("-").slice(0, maxWords).join("-") || "untitled";
}

export function parseBookMeta(raw: unknown): BookMeta {
  return bookMetaSchema.parse(raw);
}

export function parseOutline(raw: unknown): Outline {
  return outlineSchema.parse(raw);
}

/** Aggregate stats for a manuscript; powers dashboards and DoD gates. */
export interface ManuscriptStats {
  readonly chapters: number;
  readonly words: number;
  readonly minutes: number;
  readonly finalChapters: number;
  readonly withinKdpLimits: boolean;
}

export function statsFor(chapters: readonly Chapter[]): ManuscriptStats {
  const words = chapters.reduce((total, chapter) => total + chapter.wordCount, 0);
  const finalChapters = chapters.filter((chapter) => chapter.status === "final").length;
  return {
    chapters: chapters.length,
    words,
    minutes: readingMinutes(words),
    finalChapters,
    withinKdpLimits: words > 0 && words <= KDP_MAX_WORDS,
  };
}

/** Reindex chapters 0..n-1 after drag-and-drop reorder or delete. */
export function reorderChapters(chapters: readonly Chapter[], order: readonly string[]): Chapter[] {
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const ordered: Chapter[] = [];
  for (const id of order) {
    const chapter = byId.get(id);
    if (!chapter) continue;
    ordered.push({ ...chapter, idx: ordered.length });
    byId.delete(id);
  }
  for (const chapter of byId.values()) {
    ordered.push({ ...chapter, idx: ordered.length });
  }
  return ordered;
}
