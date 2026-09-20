/**
 * G-27 — AEO metadata optimizer (C5).
 *
 * Deterministic Answer-Engine Optimization: assistants and answer engines
 * surface books through structured Q&A and machine-readable facts, not
 * keyword stuffing. The pack derives entirely from book meta + manuscript
 * stats, slots into `meta.extra` under the G-13 namespacing contract, and is
 * stable for a given (meta, wordCount) — safe to cache and re-export.
 */
import { z } from "zod";
import { extractEntityCandidates } from "../consistency/index";
import { readingMinutes } from "../book/index";
import type { BookMeta } from "../book/index";

export const aeoQaSchema = z.object({
  q: z.string().min(1).max(300),
  a: z.string().min(1).max(1_000),
});
export type AeoQa = z.infer<typeof aeoQaSchema>;

export const aeoPackSchema = z.object({
  /** 2-3 sentence canonical summary answer engines can quote verbatim. */
  summary: z.string().min(1).max(500),
  qas: z.array(aeoQaSchema).min(1).max(12),
  /** Canonical entities the book is "about" (top proper nouns + author). */
  entities: z.array(z.string().min(1).max(200)).max(12),
  facts: z.object({
    language: z.string().min(2).max(12),
    genre: z.string().min(1).max(120),
    readingMinutes: z.number().int().min(1),
    words: z.number().int().min(0),
    keywords: z.array(z.string().min(1).max(80)).max(12),
  }),
});
export type AeoPack = z.infer<typeof aeoPackSchema>;

function sentencesOf(description: string): string[] {
  return description
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** Build the deterministic AEO pack for a book (pure; no model calls). */
export function buildAeoPack(meta: BookMeta, wordCount: number): AeoPack {
  const sentences = sentencesOf(meta.description);
  const summary =
    sentences.length > 0
      ? sentences.slice(0, 3).join(" ")
      : `${meta.title} is a ${meta.genre.toLowerCase()} book by ${meta.author}.`;
  const clippedSummary = summary.length > 500 ? `${summary.slice(0, 497)}...` : summary;

  const about =
    sentences.length > 0
      ? sentences.slice(0, 2).join(" ")
      : `${meta.title} is a ${meta.genre.toLowerCase()} book by ${meta.author}.`;
  const entities = [
    ...new Set(
      [
        meta.author,
        ...extractEntityCandidates(meta.description, { minMentions: 1 }).map(
          (candidate) => candidate.name,
        ),
      ].map((name) => name.trim()),
    ),
  ]
    .filter((name) => name.length > 1)
    .slice(0, 12);

  const qas: AeoQa[] = [
    { q: `What is ${meta.title} about?`, a: about.slice(0, 1_000) },
    { q: `Who wrote ${meta.title}?`, a: `${meta.title} was written by ${meta.author}.` },
    {
      q: `What genre is ${meta.title}?`,
      a: `${meta.title} is a ${meta.genre.toLowerCase()} book${
        meta.keywords.length > 0 ? `, with themes of ${meta.keywords.slice(0, 3).join(", ")}` : ""
      }.`,
    },
    {
      q: `How long does it take to read ${meta.title}?`,
      a: `${meta.title} is about ${wordCount.toLocaleString("en-US")} words — roughly ${readingMinutes(wordCount)} minutes of reading time.`,
    },
  ];

  return aeoPackSchema.parse({
    summary: clippedSummary,
    qas,
    entities,
    facts: {
      language: meta.language,
      genre: meta.genre,
      readingMinutes: readingMinutes(wordCount),
      words: wordCount,
      keywords: meta.keywords,
    },
  });
}
