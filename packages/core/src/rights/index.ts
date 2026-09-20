/**
 * G-09b — rights & licensing tracker + corpus retrieval (B9/B18).
 *
 * The rights side is a validated contract for licensing/permission records;
 * the corpus side is deterministic token-overlap retrieval over stored
 * chunks — no embeddings, no model calls, so ranking is reproducible and the
 * seam can later swap in a vector index without changing the response shape.
 */
import { z } from "zod";

export const RIGHTS_KINDS = ["license", "permission", "restriction"] as const;
export type RightsKind = (typeof RIGHTS_KINDS)[number];

export const RIGHTS_STATUSES = ["active", "expired", "revoked"] as const;
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];

export const rightsRecordSchema = z.object({
  kind: z.enum(RIGHTS_KINDS),
  title: z.string().trim().min(1).max(200),
  /** Counterparty holding or granting the right. */
  holder: z.string().trim().min(1).max(200),
  terms: z.string().max(4_000).default(""),
  territory: z.string().trim().min(1).max(120).default("world"),
  exclusive: z.boolean().default(false),
  /** ISO timestamps; both optional (perpetual records have neither). */
  startsAt: z.string().optional(),
  expiresAt: z.string().optional(),
  status: z.enum(RIGHTS_STATUSES).default("active"),
});
export type RightsRecord = z.infer<typeof rightsRecordSchema>;

export const corpusChunkSchema = z.object({
  idx: z.number().int().min(0),
  source: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(20_000),
});
export type CorpusChunk = z.infer<typeof corpusChunkSchema>;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "she",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "to",
  "was",
  "were",
  "will",
  "with",
  "you",
  "your",
]);

/** Lowercase alphanumeric tokens with stopwords removed (deterministic). */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter(
    (token) => token.length > 1 && !STOPWORDS.has(token),
  );
}

/**
 * Split text into chunks of at most `maxChars`, packing whole paragraphs
 * first and hard-splitting only over-long ones. Deterministic for a given
 * input.
 */
export function chunkText(text: string, options: { readonly maxChars?: number } = {}): string[] {
  const maxChars = options.maxChars ?? 1_200;
  const paragraphs = text
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.length > 0) chunks.push(current);
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      flush();
      for (const word of paragraph.split(/\s+/)) {
        const candidate = current.length === 0 ? word : `${current} ${word}`;
        if (candidate.length > maxChars) flush();
        current = current.length === 0 ? word : `${current} ${word}`;
      }
      flush();
      continue;
    }
    const candidate = current.length === 0 ? paragraph : `${current}\n\n${paragraph}`;
    if (candidate.length > maxChars) {
      flush();
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  flush();
  return chunks;
}

export interface CorpusHit {
  readonly idx: number;
  readonly source: string;
  readonly score: number;
  readonly snippet: string;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Deterministic retrieval: score = Σ over query tokens of tf * idf, where
 * idf = 1 + log(chunks / chunksContainingToken). Higher score first, then
 * document order. Empty/stopword-only queries return nothing.
 */
export function corpusSearch(
  chunks: readonly CorpusChunk[],
  query: string,
  options: { readonly limit?: number } = {},
): CorpusHit[] {
  const limit = Math.max(1, options.limit ?? 5);
  const queryTokens = [...new Set(tokenize(query))];
  if (chunks.length === 0 || queryTokens.length === 0) return [];

  const tokenized = chunks.map((chunk) => tokenize(chunk.text));
  const documentFrequency = new Map<string, number>();
  for (const tokens of tokenized) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const hits: CorpusHit[] = [];
  chunks.forEach((chunk, index) => {
    const tokens = tokenized[index] ?? [];
    let score = 0;
    for (const token of queryTokens) {
      const tf = tokens.filter((candidate) => candidate === token).length;
      if (tf === 0) continue;
      const df = documentFrequency.get(token) ?? 1;
      score += tf * (1 + Math.log(chunks.length / df));
    }
    if (score > 0) {
      hits.push({
        idx: chunk.idx,
        source: chunk.source,
        score: round4(score),
        snippet: chunk.text.length > 200 ? `${chunk.text.slice(0, 197)}...` : chunk.text,
      });
    }
  });

  return hits.sort((a, b) => b.score - a.score || a.idx - b.idx).slice(0, limit);
}
