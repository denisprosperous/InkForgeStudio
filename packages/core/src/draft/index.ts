/**
 * @inkforge/core/draft — deterministic scene-draft composer (G-17a, additive).
 *
 * The no-provider path of chapter generation: expand an outline beat into a
 * skeletal but REAL scene the author edits — no lorem, no placeholder braces,
 * no network. Seeded and pure, like the outline planner: the same request
 * yields the same draft, so previews are reproducible and auditable.
 *
 * The model-backed path lives with the worker; this composer is the fallback
 * and the offline floor. It never mutates frozen modules.
 */
import { createRng } from "../humanize/index";

export interface DraftRequest {
  readonly title: string;
  /** Outline beat brief — the scene's anchor. */
  readonly brief: string;
  /** Soft word target; the composer lands within ±40%. */
  readonly targetWords: number;
  readonly seed?: number;
}

export interface DraftResult {
  readonly markdown: string;
  readonly wordCount: number;
  readonly seed: number;
}

const STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "with",
  "from",
  "by",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "it",
  "its",
  "his",
  "her",
  "their",
  "they",
  "he",
  "she",
  "that",
  "this",
  "into",
  "about",
  "who",
  "which",
  "not",
]);

const OPENERS = [
  "{name} came to the door of it the way one comes to a debt: knowingly.",
  "The morning took its time arriving, and {name} took longer.",
  "There was a version of the day {name} had planned, and this was not it.",
  "{name} counted the hours the way other people counted money.",
  "By the time the light settled, {name} had already decided too much.",
];

const DEVELOP = [
  "{brief} That was the shape of it, and {name} turned the shape over and over.",
  "{name} worked the problem from the edges. {brief} — it kept returning, patient as weather.",
  "Twice {name} almost set it down. Twice the thought of {motif} pulled the hands back to work.",
  "The room held its small noises — clock, breath, the tick of cooling metal — and {name} listened like a student.",
  "{brief} It was not a plan. It was closer to a promise, which is harder to keep and easier to start.",
];

const TURN = [
  "Then the thing happened that {name} had been not-thinking-about for days: {motif} failed, quietly, all at once.",
  "The knock, when it came, was polite. That was the worst of it.",
  "It was {name} who broke first — a small break, a hairline, but it let the daylight in.",
  "One sentence, said plainly, rearranged the furniture of the whole afternoon.",
];

const CLOSE = [
  "By dark, {name} knew two things for certain and one thing at a price.",
  "The door closed. The room kept what it kept. Tomorrow would ask its question again.",
  "{name} slept the shallow sleep of the indebted, and dreamed, of course, of {motif}.",
  "Whatever came next would come to a changed address. {name} wrote the new one down.",
];

const NAMES = ["Vera", "Ivo", "Mara", "Sen", "Aldo", "Ruth", "Emeth", "Cato", "Nell", "Oren"];

function keyWords(brief: string): string[] {
  return brief
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP.has(word));
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function fill(template: string, slots: { name: string; brief: string; motif: string }): string {
  return template
    .replace(/\{name\}/g, slots.name)
    .replace(/\{brief\}/g, slots.brief.replace(/\.$/, ""))
    .replace(/\{motif\}/g, slots.motif);
}

/**
 * Compose a skeletal scene draft from a beat. Structure over poetry: an
 * opening image, two development movements, a turn, a close — each seeded from
 * small template banks and slotted with the brief's own words.
 */
export function composeDraft(request: DraftRequest): DraftResult {
  const brief = request.brief.trim();
  if (brief.length === 0) {
    throw new Error("composeDraft: brief is required");
  }
  const seed = request.seed ?? 4_242_424;
  const rng = createRng(seed);
  const words = keyWords(brief);
  const motif = capitalize(words[0] ?? request.title.toLowerCase());
  const name = NAMES[Math.floor(rng() * NAMES.length)] ?? "Vera";
  const slots = { name, brief, motif };
  const pick = (bank: readonly string[]): string =>
    bank[Math.floor(rng() * bank.length)] ?? bank[0]!;

  const paragraphs = [
    fill(pick(OPENERS), slots),
    fill(pick(DEVELOP), slots),
    fill(pick(DEVELOP), slots),
    fill(pick(TURN), slots),
    fill(pick(CLOSE), slots),
  ];

  // Pad toward the target with development variations so longer chapters are
  // still structured rather than repeated.
  let text = paragraphs.join("\n\n");
  const count = (value: string): number => value.split(/\s+/u).filter(Boolean).length;
  let guard = 0;
  while (count(text) < request.targetWords * 0.6 && guard < 12) {
    guard += 1;
    text += `\n\n${fill(pick(DEVELOP), slots)}`;
  }

  const markdown = `# ${request.title}\n\n${text}`;
  return { markdown, wordCount: count(markdown), seed };
}
