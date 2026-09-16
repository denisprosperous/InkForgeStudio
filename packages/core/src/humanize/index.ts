/**
 * @inkforge/core/humanize — strip machine tells from AI-drafted prose.
 *
 * Two layers:
 *  1. A deterministic rule engine (contractions, filler trims, stock-phrase
 *     rewrites, sentence-length variance) that always runs and never ships a
 *     hallucination because it only ever deletes or rewords locally.
 *  2. An optional LLM polish pass, injected as a callback so core stays vendor
 *     free; if the callback fails the rule-based result is returned untouched.
 *
 * Every run is seeded, so the same manuscript + seed always yields the same
 * result — authors can diff, reproduce and audit exactly what changed.
 */
import { countWords } from "../book/index";

/** Stock AI-isms mapped to plainer replacements (word-boundary, case kept). */
const STOCK_PHRASES: readonly [RegExp, string][] = [
  [/\bdelve into\b/gi, "explore"],
  [/\bdelves into\b/gi, "explores"],
  [/\bdelving into\b/gi, "exploring"],
  [/\bin the realm of\b/gi, "in"],
  [/\ba testament to\b/gi, "proof of"],
  [/\btestament to\b/gi, "proof of"],
  [/\btapestry of\b/gi, "mix of"],
  [/\bthe ever-evolving\b/gi, "the changing"],
  [/\bever-evolving\b/gi, "changing"],
  [/\bin today's (?:fast-paced |modern )?world\b/gi, "these days"],
  [/\bit is important to note that\b/gi, "notably,"],
  [/\bit's worth noting that\b/gi, "notably,"],
  [/\bin conclusion\b/gi, "ultimately"],
  [/\bfurthermore\b/gi, "and"],
  [/\bmoreover\b/gi, "and"],
  [/\badditionally\b/gi, "and"],
  [/\bserve as\b/gi, "be"],
  [/\bserves as\b/gi, "is"],
  [/\bplay a (?:crucial|pivotal|vital) role in\b/gi, "shape"],
  [/\bnavigate the (?:complexities|intricacies) of\b/gi, "work through"],
  [/\bembark on a journey\b/gi, "set out"],
  [/\bwhen it comes to\b/gi, "with"],
  [/\ba wide (?:array|range) of\b/gi, "many"],
  [/\bvibrant\b/gi, "bright"],
  [/\bcaptivating\b/gi, "gripping"],
  [/\bbreathtaking\b/gi, "striking"],
  [/\bmyriad of\b/gi, "many"],
];

const CONTRACTIONS: readonly [RegExp, string][] = [
  [/\bit is\b/gi, "it's"],
  [/\bit has\b/gi, "it's"],
  [/\bdo not\b/gi, "don't"],
  [/\bdoes not\b/gi, "doesn't"],
  [/\bdid not\b/gi, "didn't"],
  [/\bcannot\b/gi, "can't"],
  [/\bcan not\b/gi, "can't"],
  [/\bwill not\b/gi, "won't"],
  [/\bwould not\b/gi, "wouldn't"],
  [/\bcould not\b/gi, "couldn't"],
  [/\bshould not\b/gi, "shouldn't"],
  [/\bis not\b/gi, "isn't"],
  [/\bare not\b/gi, "aren't"],
  [/\bwas not\b/gi, "wasn't"],
  [/\bwere not\b/gi, "weren't"],
  [/\bhave not\b/gi, "haven't"],
  [/\bhas not\b/gi, "hasn't"],
  [/\bhad not\b/gi, "hadn't"],
  [/\byou are\b/gi, "you're"],
  [/\bwe are\b/gi, "we're"],
  [/\bthey are\b/gi, "they're"],
  [/\bthat is\b/gi, "that's"],
  [/\bthere is\b/gi, "there's"],
  [/\blet us\b/gi, "let's"],
  [/\byou will\b/gi, "you'll"],
  [/\bwe will\b/gi, "we'll"],
  [/\bI am\b/g, "I'm"],
];

export interface HumanizeOptions {
  /** 1–3 engine passes; more passes = shorter, punchier prose. */
  readonly passes?: number;
  readonly contractions?: boolean;
  readonly trimFiller?: boolean;
  readonly varySentences?: boolean;
  readonly rewriteStockPhrases?: boolean;
  readonly seed?: number;
  /** Skip code fences, front-matter and headings entirely. */
  readonly preserveStructure?: boolean;
}

export interface TextScore {
  /** Flesch reading ease, 0 (dense) – 100 (airy). */
  readonly fleschEase: number;
  readonly avgSentenceLength: number;
  readonly sentenceLengthStdDev: number;
  readonly words: number;
}

export interface HumanizeRunResult {
  readonly markdown: string;
  readonly scoreBefore: TextScore;
  readonly scoreAfter: TextScore;
  readonly changedSentences: number;
  readonly passes: number;
  readonly seed: number;
  /** Sentence the LLM pass contributed, 0 for pure rule runs. */
  readonly llmRewrites: number;
}

const FILLERS: readonly RegExp[] = [
  /\b(?:really|very|quite|just|actually|basically|literally|simply|totally|absolutely)\s+/gi,
  /\bneedless to say,?\s*/gi,
  /\bas a matter of fact,?\s*/gi,
  /\bit should be noted that\s*/gi,
];

const SENTENCE_SPLIT = /(?<=[.!?…])\s+(?=[A-Z"'“0-9])/u;

function isStructural(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === "" ||
    trimmed.startsWith("#") ||
    trimmed.startsWith(">") ||
    trimmed.startsWith("-") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("```") ||
    trimmed.startsWith("|") ||
    trimmed.startsWith("[") ||
    /^\d+\./.test(trimmed)
  );
}

/** Deterministic 32-bit RNG (mulberry32) so runs are reproducible. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0 || 0x2f6e2b1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function splitLongSentence(sentence: string, rng: () => number): string {
  const words = sentence.split(/\s+/);
  if (words.length <= 26) return sentence;
  const connectors = [", and", ", but", ", so", ", yet", ";"];
  for (let i = words.length - 6; i >= 8; i -= 1) {
    const window = words.slice(Math.max(0, i - 3), i + 1).join(" ");
    const connector = connectors.find((c) => window.toLowerCase().includes(c.slice(1)));
    if (connector && rng() > 0.35) {
      const at = sentence.toLowerCase().indexOf(connector, Math.floor(sentence.length * 0.4));
      if (at > 20) {
        const head = sentence.slice(0, at).trimEnd().replace(/,$/, "");
        const tail = sentence
          .slice(at + connector.length)
          .trimStart()
          .replace(/^,/, "");
        if (head.length > 0 && tail.length > 0) {
          const capital = tail.charAt(0).toUpperCase() + tail.slice(1);
          return `${head}. ${capital}`;
        }
      }
    }
  }
  return sentence;
}

/** Apply the rule engine to one sentence. Exported for granular tests. */
export function rewriteSentence(
  sentence: string,
  options: Required<Omit<HumanizeOptions, "seed">>,
  rng: () => number,
): string {
  let text = sentence;
  if (options.rewriteStockPhrases) {
    for (const [pattern, replacement] of STOCK_PHRASES) {
      text = text.replace(pattern, replacement);
    }
  }
  if (options.trimFiller) {
    for (const filler of FILLERS) {
      text = text.replace(filler, "");
    }
    text = text.replace(/\bin order to\b/gi, "to");
    text = text.replace(/\s{2,}/g, " ");
  }
  if (options.contractions) {
    for (const [pattern, replacement] of CONTRACTIONS) {
      text = text.replace(pattern, (match: string) => {
        // Preserve the matched word's initial capitalization ("It is" → "It's").
        const cased =
          /^[A-Z]/.test(match) && /^[a-z]/.test(replacement)
            ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
            : replacement;
        return cased;
      });
    }
  }
  if (options.varySentences) {
    text = splitLongSentence(text, rng);
  }
  return text.replace(/\s+([,.;:!?])/g, "$1").trimEnd() === text
    ? text
    : text.replace(/\s+([,.;:!?])/g, "$1");
}

function countSyllables(word: string): number {
  const lower = word.toLowerCase().replace(/[^a-z]/g, "");
  if (lower.length <= 3) return 1;
  const groups = lower
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "")
    .match(/[aeiouy]{1,2}/gu);
  return groups ? groups.length : 1;
}

/** Flesch reading-ease over plain prose extracted from markdown. */
export function scoreText(markdown: string): TextScore {
  const prose = markdown
    .split("\n")
    .filter((line) => !isStructural(line.trim()))
    .join(" ")
    .replace(/[*_`>]/g, "");
  const sentences = prose
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const words = prose.match(/[A-Za-z0-9'’-]+/gu) ?? [];
  const wordCount = words.length || countWords(markdown);
  const syllables = words.reduce((total, word) => total + countSyllables(word), 0);
  const sentenceCount = sentences.length || 1;
  const avg = wordCount / sentenceCount;
  const variance =
    sentences.reduce((acc, s) => {
      const len = (s.match(/[A-Za-z0-9'’-]+/gu) ?? []).length;
      return acc + (len - avg) ** 2;
    }, 0) / sentenceCount;
  const fleschEase = wordCount === 0 ? 100 : 206.835 - 1.015 * avg - 84.6 * (syllables / wordCount);
  return {
    fleschEase: Math.round(Math.max(0, Math.min(100, fleschEase)) * 10) / 10,
    avgSentenceLength: Math.round(avg * 10) / 10,
    sentenceLengthStdDev: Math.round(Math.sqrt(variance) * 10) / 10,
    words: wordCount,
  };
}

const DEFAULTS: Required<Omit<HumanizeOptions, "seed">> = {
  passes: 1,
  contractions: true,
  trimFiller: true,
  varySentences: true,
  rewriteStockPhrases: true,
  preserveStructure: true,
};

function mapSentences(
  markdown: string,
  fn: (sentence: string) => string,
  preserveStructure: boolean,
): { text: string; changed: number } {
  let changed = 0;
  const lines = markdown.split("\n");
  const out = lines.map((line) => {
    if (preserveStructure && isStructural(line)) return line;
    const sentences = line.split(SENTENCE_SPLIT);
    const rebuilt = sentences
      .map((sentence) => {
        const next = fn(sentence);
        if (next !== sentence) changed += 1;
        return next;
      })
      .join(" ");
    return rebuilt === line ? line : rebuilt;
  });
  return { text: out.join("\n"), changed };
}

/** Run the deterministic engine only. */
export function humanizeMarkdown(
  markdown: string,
  options: HumanizeOptions = {},
): HumanizeRunResult {
  const opts = { ...DEFAULTS, ...options };
  const seed = options.seed ?? 424_242;
  const rng = createRng(seed);
  const scoreBefore = scoreText(markdown);
  let text = markdown;
  let changed = 0;
  for (let pass = 0; pass < opts.passes; pass += 1) {
    const result = mapSentences(
      text,
      (sentence) => rewriteSentence(sentence, opts, rng),
      opts.preserveStructure,
    );
    text = result.text;
    changed += result.changed;
  }
  return {
    markdown: text,
    scoreBefore,
    scoreAfter: scoreText(text),
    changedSentences: changed,
    passes: opts.passes,
    seed,
    llmRewrites: 0,
  };
}

export interface LlmPolisher {
  /** Returns polished markdown for the supplied draft. */
  complete(prompt: string): Promise<string>;
}

const POLISH_SYSTEM = [
  "You are a line editor for commercial books.",
  "Rewrite the draft below to sound like a human author:",
  "vary sentence length, prefer plain verbs, remove stock AI phrasing,",
  "keep all facts, names, structure and markdown headings identical.",
  "Return ONLY the rewritten markdown, no commentary.",
].join(" ");

/**
 * Rule engine first, then an optional injected LLM polish. If the LLM throws,
 * returns junk, or drops more than 25% of the content, the rule-based result
 * is kept — a humanized chapter must never lose the author's material.
 */
export async function humanizeWithLlm(
  markdown: string,
  llm: LlmPolisher,
  options: HumanizeOptions = {},
): Promise<HumanizeRunResult> {
  const ruleResult = humanizeMarkdown(markdown, options);
  const before = scoreText(markdown);
  try {
    const draft = ruleResult.markdown;
    const response = await llm.complete(`${POLISH_SYSTEM}\n\n---\n\n${draft}`);
    const cleaned = response
      .trim()
      .replace(/^---\n?/, "")
      .replace(/\n---$/, "");
    const tooShort = cleaned.length < draft.length * 0.75;
    const structureLost =
      draft.includes("\n#") !== cleaned.includes("\n#") ||
      draft.split("\n").length < cleaned.split("\n").length * 0.5;
    if (cleaned.length === 0 || tooShort || structureLost) {
      return { ...ruleResult, scoreBefore: before };
    }
    return {
      markdown: cleaned,
      scoreBefore: before,
      scoreAfter: scoreText(cleaned),
      changedSentences: ruleResult.changedSentences,
      passes: ruleResult.passes,
      seed: ruleResult.seed,
      llmRewrites: 1,
    };
  } catch {
    return { ...ruleResult, scoreBefore: before };
  }
}
