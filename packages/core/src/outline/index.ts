/**
 * @inkforge/core/outline — deterministic structure-before-prose planner (G-14).
 *
 * Turns a premise into a KDP-scaled outline: acts → chapter beats → scene
 * intents with a real word budget. The planner is pure and seeded, so the same
 * request always yields the same outline — the studio can show it, diff it,
 * reroll it with a new seed, and the worker can regenerate it for audit. It
 * only *produces* the frozen core's `Outline`; it never mutates it.
 *
 * The LLM-backed variant lives with the worker (apps/forge/src/outline.ts):
 * the model drafts, this planner is the fallback and the shape-enforcer.
 */
import { createRng } from "../humanize/index";
import type { Outline, OutlineBeat } from "../book/index";

export interface OutlineRequest {
  readonly premise: string;
  readonly genre?: string;
  readonly title?: string;
  /** Whole-book word target; beat targets sum to approximately this. */
  readonly targetWords?: number;
  readonly chapterCount?: number;
  /** 1-9 acts; 3 is the commercial default. */
  readonly acts?: number;
  readonly seed?: number;
}

export const DEFAULT_TARGET_WORDS = 40_000;
export const DEFAULT_CHAPTER_COUNT = 12;
export const DEFAULT_SEED = 20_260_916;
/** outlineBeatSchema hard bounds — the planner must never emit an invalid beat. */
export const MIN_BEAT_WORDS = 50;
export const MAX_BEAT_WORDS = 20_000;
export const MAX_CHAPTERS = 120;
export const MAX_ACTS = 9;

const ACT_NAMES = [
  "Setup",
  "Conflict",
  "Escalation",
  "Reversal",
  "Crisis",
  "Reckoning",
  "Cost",
  "Resolution",
  "Coda",
] as const;

/** Words that carry no story signal when they appear in a premise. */
const STOPWORDS = new Set([
  "the",
  "and",
  "but",
  "that",
  "this",
  "these",
  "those",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "with",
  "without",
  "from",
  "by",
  "as",
  "into",
  "over",
  "after",
  "before",
  "when",
  "while",
  "who",
  "whose",
  "which",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "has",
  "have",
  "had",
  "does",
  "did",
  "will",
  "would",
  "can",
  "could",
  "must",
  "should",
  "may",
  "might",
  "not",
  "his",
  "her",
  "their",
  "its",
  "our",
  "your",
  "him",
  "them",
  "about",
  "against",
  "between",
  "because",
  "than",
  "then",
  "there",
  "here",
  "she",
]);

const ADJECTIVES = [
  "Quiet",
  "Broken",
  "Last",
  "Hollow",
  "Cold",
  "Bright",
  "Small",
  "Long",
  "Sharp",
  "Hidden",
  "Bitter",
  "Waking",
  "Second",
  "Iron",
  "Salt",
  "Wide",
  "Deep",
  "Slow",
  "Patient",
  "Winter",
  "Borrowed",
  "Unmarked",
  "Final",
  "Distant",
] as const;

const NOUNS = [
  "Machine",
  "Lighthouse",
  "Ledger",
  "Orchard",
  "Signal",
  "Archive",
  "Bridge",
  "Kitchen",
  "Compass",
  "Harbour",
  "Garden",
  "Engine",
  "Letter",
  "Room",
  "Mountain",
  "Wire",
  "Coast",
  "Thaw",
  "Bell",
  "Field",
  "Ladder",
  "Verdict",
  "Departure",
  "Clock",
  "Ferry",
  "Threshold",
  "Seam",
  "Kiln",
] as const;

const ABSTRACTS = [
  "Silence",
  "Debt",
  "Weather",
  "Habit",
  "Appetite",
  "Distance",
  "Permission",
  "Rust",
  "Small Hours",
  "Long Winter",
  "Second Chance",
  "Quiet Hour",
] as const;

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh"] as const;

function signalWords(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/u)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word.toLowerCase()));
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Deterministic Fisher-Yates; identical seed implies identical order. */
function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * Every beat title the planner can emit, deduplicated by construction. The pool
 * is far larger than MAX_CHAPTERS so a 120-chapter request never runs dry.
 */
function titlePool(premise: string, genre: string, rng: () => number): string[] {
  const motifs = [...new Set(signalWords(premise).map(capitalize))].slice(0, 8);
  const seeds: string[] = [];
  for (const noun of NOUNS) for (const adjective of ADJECTIVES) seeds.push(adjective + " " + noun);
  for (const noun of NOUNS)
    for (const abstract of ABSTRACTS) seeds.push("The " + noun + " of " + abstract);
  for (const ordinal of ORDINALS)
    for (const noun of NOUNS) seeds.push("The " + ordinal + " " + noun);
  const tail = NOUNS.slice(0, 8);
  for (const motif of motifs) {
    seeds.push("The " + motif);
    if (motif !== genre) seeds.push(motif + " in " + genre);
    for (const noun of tail) seeds.push("The " + motif + " " + noun);
  }
  return [...new Set(shuffled(seeds, rng))];
}

/** Distribute the word target across beats; the last beat absorbs the remainder. */
function wordBudget(target: number, chapters: number, rng: () => number): number[] {
  const safe = clamp(Math.round(target), chapters * MIN_BEAT_WORDS, chapters * MAX_BEAT_WORDS);
  const base = Math.floor(safe / chapters);
  const budgets: number[] = [];
  let spent = 0;
  for (let i = 0; i < chapters - 1; i += 1) {
    const jitter = 1 + (rng() * 0.3 - 0.15); // within +/-15% of the even split
    const value = clamp(Math.round(base * jitter), MIN_BEAT_WORDS, MAX_BEAT_WORDS);
    budgets.push(value);
    spent += value;
  }
  budgets.push(clamp(safe - spent, MIN_BEAT_WORDS, MAX_BEAT_WORDS));
  return budgets;
}

/** Scene intents; the act name is folded in so briefs stay distinguishable. */
const INTENTS: ReadonlyArray<(motif: string, act: string) => string> = [
  (m, act) => "Open on " + m + "; show the ordinary day it interrupts. Act: " + act + ".",
  (m, act) =>
    "Force the first real choice about " +
    m +
    "; make the cheaper option costlier. Act: " +
    act +
    ".",
  (m, act) =>
    "Widen the frame — who else needs " + m + ", and who profits if it fails. Act: " + act + ".",
  (m, act) => "Let the plan work, then remove the one thing it depended on. Act: " + act + ".",
  (m, act) =>
    "Turn allies into witnesses; the protagonist is seen clearly for the first time. Act: " +
    act +
    ".",
  (m, act) => "Pay the debt from act one at the worst possible moment. Act: " + act + ".",
  (m, act) => "Close on a changed room: same objects, different stakes. Act: " + act + ".",
];

/**
 * Build a deterministic outline. Pure: no clock, no randomness beyond the seed.
 *
 * @throws RangeError when the premise is blank.
 */
export function generateOutline(request: OutlineRequest): Outline {
  const premise = request.premise.trim();
  if (premise.length === 0) {
    throw new RangeError("generateOutline: premise must be non-empty");
  }
  const acts = clamp(Math.round(request.acts ?? 3), 1, MAX_ACTS);
  const requested = clamp(
    Math.round(request.chapterCount ?? DEFAULT_CHAPTER_COUNT),
    1,
    MAX_CHAPTERS,
  );
  const chapters = Math.max(requested, acts);
  const seed = request.seed ?? DEFAULT_SEED;
  const genre = request.genre?.trim() || "General";
  const rng = createRng(seed);

  const titles = titlePool(premise, genre, rng);
  const budgets = wordBudget(request.targetWords ?? DEFAULT_TARGET_WORDS, chapters, rng);
  const motif = capitalize(signalWords(premise)[0] ?? "Story");

  const beats: OutlineBeat[] = [];
  for (let idx = 0; idx < chapters; idx += 1) {
    const actIndex = Math.min(acts - 1, Math.floor((idx / chapters) * acts));
    const act = ACT_NAMES[actIndex] ?? ACT_NAMES[0];
    const intent = INTENTS[actIndex % INTENTS.length] ?? INTENTS[0]!;
    beats.push({
      idx,
      title: titles[idx] ?? "Chapter " + (idx + 1),
      brief: intent(motif, act),
      targetWords: budgets[idx] ?? 1_200,
    });
  }

  return {
    premise: premise.slice(0, 4_000),
    genre: genre.slice(0, 120),
    acts: ACT_NAMES.slice(0, acts).map((name) => name + " — " + motif),
    chapters: beats,
  };
}

/** Total planned words across the outline. */
export function plannedWords(outline: Outline): number {
  return outline.chapters.reduce((total, beat) => total + beat.targetWords, 0);
}

/**
 * Deterministic re-roll: a new seed with every other input identical. Powers the
 * studio's "Reroll structure" action.
 */
export function rerollOutline(request: OutlineRequest): Outline {
  return generateOutline({ ...request, seed: (request.seed ?? DEFAULT_SEED) + 1 });
}
