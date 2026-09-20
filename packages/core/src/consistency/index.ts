/**
 * G-15 — consistency & memory engine v1 (B5).
 *
 * The long-form memory substrate: a per-book fact/entity ledger plus a
 * deterministic post-generation validator. Extraction and validation are pure
 * functions over the manuscript text so results are reproducible in CI; model
 * passes may layer on top later, but the contract below never changes under
 * them. Attaches at the core seam (additive); storage lives in @inkforge/db
 * (consistency_facts) and routes live in the forge.
 */
import { z } from "zod";

export const CONSISTENCY_KINDS = ["entity", "fact", "timeline"] as const;
export type ConsistencyKind = (typeof CONSISTENCY_KINDS)[number];

export const consistencyFactSchema = z.object({
  kind: z.enum(CONSISTENCY_KINDS).default("entity"),
  name: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  summary: z.string().max(2_000).default(""),
  firstChapter: z.number().int().min(0).default(0),
  lastChapter: z.number().int().min(0).default(0),
});
export type ConsistencyFact = z.infer<typeof consistencyFactSchema>;

export const consistencyLedgerSchema = z.object({
  facts: z.array(consistencyFactSchema).max(2_000).default([]),
});
export type ConsistencyLedger = z.infer<typeof consistencyLedgerSchema>;

/** Structural view of a fact the validator consumes (row- and schema-shaped). */
export interface ConsistencyFactLike {
  readonly kind: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly summary: string;
  readonly firstChapter: number;
  readonly lastChapter: number;
}

export interface EntityCandidate {
  readonly name: string;
  readonly mentions: number;
}

/** Words that never open an entity on their own (deterministic stoplist). */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "chapter",
  "for",
  "from",
  "he",
  "her",
  "his",
  "how",
  "i",
  "if",
  "in",
  "it",
  "its",
  "my",
  "no",
  "not",
  "now",
  "of",
  "on",
  "one",
  "or",
  "our",
  "she",
  "so",
  "that",
  "the",
  "their",
  "then",
  "there",
  "they",
  "this",
  "to",
  "two",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~]+/g, " ");
}

const PROPER_NOUN = /[A-Z][a-zA-Z'’-]*(?:\s+[A-Z][a-zA-Z'’-]*)*/g;

/**
 * Deterministic proper-noun extraction. Returns sequences of capitalized
 * words with leading stopword fragments removed, keyed case-insensitively,
 * keeping only names with `minMentions`+ occurrences (default 1: any
 * capitalized proper noun counts; raise the gate to cut one-off noise).
 */
export function extractEntityCandidates(
  markdown: string,
  options: { readonly minMentions?: number } = {},
): EntityCandidate[] {
  const minMentions = options.minMentions ?? 1;
  const counts = new Map<string, { display: string; mentions: number }>();
  for (const match of stripMarkdown(markdown).matchAll(PROPER_NOUN)) {
    const words = match[0].split(/\s+/);
    for (;;) {
      const head = words[0]?.toLowerCase();
      if (words.length === 0 || head === undefined || !STOPWORDS.has(head)) break;
      words.shift();
    }
    if (words.length === 0) continue;
    const name = words.join(" ");
    if (name.length < 2) continue;
    const key = name.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.mentions += 1;
    else counts.set(key, { display: name, mentions: 1 });
  }
  return [...counts.values()]
    .filter((entry) => entry.mentions >= minMentions)
    .map((entry) => ({ name: entry.display, mentions: entry.mentions }))
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
}

export type ViolationKind =
  | "conflicting-definition"
  | "out-of-range"
  | "reversed-span"
  | "orphan-fact";

export interface ConsistencyViolation {
  readonly kind: ViolationKind;
  readonly name: string;
  readonly detail: string;
}

export interface ConsistencyReport {
  readonly checkedChapters: number;
  readonly violations: readonly ConsistencyViolation[];
  /** Recurring proper nouns the ledger does not know (patch the ledger). */
  readonly unknownEntities: readonly string[];
  /** Known mentions / (known + unknown mentions); 1 when nothing to contradict. */
  readonly coverage: number;
}

function canonical(name: string): string {
  return name.trim().toLowerCase();
}

function chapterText(chapters: readonly { readonly markdown: string }[]): string {
  return chapters
    .map((chapter) => stripMarkdown(chapter.markdown))
    .join("\n")
    .toLowerCase();
}

function mentionsCount(text: string, names: readonly string[]): number {
  let total = 0;
  for (const name of names) {
    const needle = name.toLowerCase();
    if (needle.length === 0) continue;
    let at = text.indexOf(needle);
    while (at !== -1) {
      total += 1;
      at = text.indexOf(needle, at + needle.length);
    }
  }
  return total;
}

/**
 * Validate a manuscript against its fact ledger. Deterministic checks:
 * conflicting definitions (same canonical name/alias, differing summaries),
 * chapter spans outside the manuscript or reversed, ledger entries the text
 * never mentions, and recurring unknown entities the ledger should learn.
 */
export function validateConsistency(
  chapters: readonly { readonly markdown: string }[],
  facts: readonly ConsistencyFactLike[],
): ConsistencyReport {
  const violations: ConsistencyViolation[] = [];

  // 1. Conflicting definitions: canonical key collisions with differing summaries.
  const byKey = new Map<string, ConsistencyFactLike>();
  for (const fact of facts) {
    const keys = [fact.name, ...fact.aliases].map(canonical).filter((key) => key.length > 0);
    for (const key of keys) {
      const prior = byKey.get(key);
      if (
        prior &&
        prior.summary.trim() !== "" &&
        fact.summary.trim() !== "" &&
        prior.summary !== fact.summary
      ) {
        violations.push({
          kind: "conflicting-definition",
          name: fact.name,
          detail: `conflicts with "${prior.name}" on ${key}`,
        });
      } else if (!prior) {
        byKey.set(key, fact);
      }
    }
  }

  const text = chapterText(chapters);

  // 2. Span sanity + 3. orphan detection.
  for (const fact of facts) {
    if (fact.lastChapter < fact.firstChapter) {
      violations.push({
        kind: "reversed-span",
        name: fact.name,
        detail: `lastChapter ${fact.lastChapter} < firstChapter ${fact.firstChapter}`,
      });
    }
    if (
      chapters.length > 0 &&
      (fact.firstChapter >= chapters.length || fact.lastChapter >= chapters.length)
    ) {
      violations.push({
        kind: "out-of-range",
        name: fact.name,
        detail: `span ${fact.firstChapter}..${fact.lastChapter} beyond ${chapters.length} chapters`,
      });
    }
    if (chapters.length > 0 && mentionsCount(text, [fact.name, ...fact.aliases]) === 0) {
      violations.push({
        kind: "orphan-fact",
        name: fact.name,
        detail: "never mentioned in the manuscript",
      });
    }
  }

  // 4. Unknown recurring entities the ledger should learn.
  const knownNames = facts.flatMap((fact) => [fact.name, ...fact.aliases]);
  const knownKeys = new Set(knownNames.map(canonical));
  const candidates = extractEntityCandidates(
    chapters.map((chapter) => chapter.markdown).join("\n"),
  );
  const unknownEntities: string[] = [];
  let knownMentions = 0;
  let unknownMentions = 0;
  for (const candidate of candidates) {
    if (knownKeys.has(canonical(candidate.name))) {
      knownMentions += candidate.mentions;
    } else {
      unknownMentions += candidate.mentions;
      unknownEntities.push(candidate.name);
    }
  }
  // Ledger names mentioned fewer times than the candidate gate still count as
  // known coverage when the text contains them.
  knownMentions += Math.max(
    0,
    mentionsCount(text, knownNames) -
      candidates
        .filter((candidate) => knownKeys.has(canonical(candidate.name)))
        .reduce((total, candidate) => total + candidate.mentions, 0),
  );

  return {
    checkedChapters: chapters.length,
    violations,
    unknownEntities,
    coverage:
      knownMentions + unknownMentions === 0 ? 1 : knownMentions / (knownMentions + unknownMentions),
  };
}
