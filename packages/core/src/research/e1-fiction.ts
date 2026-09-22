/**
 * Adapter E-1 — fiction structure: genre-aware beat architecture.
 * Every genre carries its own beat names and POV/tense guidance; chapters and
 * words are allocated across beats proportionally so totals always match.
 */

export const FICTION_GENRES = [
  "fantasy",
  "science-fiction",
  "mystery",
  "thriller",
  "romance",
  "historical",
  "horror",
  "literary",
] as const;
export type FictionGenre = (typeof FICTION_GENRES)[number];

export interface FictionBeat {
  readonly name: string;
  /** Share of the manuscript this beat should occupy (0..1). */
  readonly weight: number;
}

const BEATS: Readonly<Record<FictionGenre, readonly FictionBeat[]>> = {
  fantasy: [
    { name: "Ordinary world & call", weight: 0.15 },
    { name: "Threshold & first magic", weight: 0.25 },
    { name: "Rising cost", weight: 0.3 },
    { name: "Climax at the source", weight: 0.2 },
    { name: "New order", weight: 0.1 },
  ],
  "science-fiction": [
    { name: "Baseline world", weight: 0.15 },
    { name: "Anomaly", weight: 0.2 },
    { name: "Escalation of consequences", weight: 0.3 },
    { name: "Hard choice", weight: 0.25 },
    { name: "Aftermath", weight: 0.1 },
  ],
  mystery: [
    { name: "Body & sleuth", weight: 0.15 },
    { name: "Clue escalation", weight: 0.3 },
    { name: "False solution", weight: 0.2 },
    { name: "Reveal", weight: 0.25 },
    { name: "Restoration", weight: 0.1 },
  ],
  thriller: [
    { name: "Inciting threat", weight: 0.15 },
    { name: "Ticking clock", weight: 0.3 },
    { name: "Betrayal", weight: 0.2 },
    { name: "Confrontation", weight: 0.25 },
    { name: "Resolution", weight: 0.1 },
  ],
  romance: [
    { name: "Meet-cute", weight: 0.15 },
    { name: "Growing pull", weight: 0.25 },
    { name: "Break", weight: 0.25 },
    { name: "Grand gesture", weight: 0.25 },
    { name: "HEA", weight: 0.1 },
  ],
  historical: [
    { name: "World & stakes", weight: 0.2 },
    { name: "Personal entanglement", weight: 0.3 },
    { name: "Historical pressure", weight: 0.25 },
    { name: "Reckoning", weight: 0.15 },
    { name: "Legacy", weight: 0.1 },
  ],
  horror: [
    { name: "Unease", weight: 0.2 },
    { name: "First contact", weight: 0.25 },
    { name: "Isolation", weight: 0.25 },
    { name: "Escalation", weight: 0.2 },
    { name: "Final image", weight: 0.1 },
  ],
  literary: [
    { name: "Situation", weight: 0.2 },
    { name: "Complication of self", weight: 0.3 },
    { name: "Rupture", weight: 0.25 },
    { name: "Recognition", weight: 0.15 },
    { name: "Coda", weight: 0.1 },
  ],
};

export function fictionBeatsFor(genre: FictionGenre): readonly FictionBeat[] {
  const beats = BEATS[genre];
  if (!beats) throw new Error(`unknown fiction genre: ${String(genre)}`);
  return beats;
}

export interface FictionOutline {
  readonly genre: FictionGenre;
  readonly chapters: number;
  readonly targetWords: number;
  readonly beats: readonly {
    readonly name: string;
    readonly chapters: number;
    readonly targetWords: number;
  }[];
}

/**
 * Allocate chapters and words across the genre's beats. The last beat absorbs
 * rounding so the totals always equal the request exactly.
 */
export function buildFictionOutline(input: {
  readonly genre: FictionGenre;
  readonly chapters: number;
  readonly targetWords: number;
}): FictionOutline {
  if (!Number.isInteger(input.chapters) || input.chapters <= 0) {
    throw new Error("chapters must be a positive integer");
  }
  if (!Number.isFinite(input.targetWords) || input.targetWords <= 0) {
    throw new Error("targetWords must be positive");
  }
  const beats = fictionBeatsFor(input.genre);
  let chaptersLeft = input.chapters;
  let wordsLeft = input.targetWords;
  const allocated = beats.map((beat, index) => {
    const last = index === beats.length - 1;
    const chapters = last ? chaptersLeft : Math.max(1, Math.floor(input.chapters * beat.weight));
    const targetWords = last ? wordsLeft : Math.max(1, Math.floor(input.targetWords * beat.weight));
    chaptersLeft -= chapters;
    wordsLeft -= targetWords;
    return { name: beat.name, chapters, targetWords };
  });
  if (chaptersLeft !== 0 || wordsLeft !== 0) {
    const last = allocated[allocated.length - 1];
    if (!last) throw new Error("no beats to allocate");
    allocated[allocated.length - 1] = {
      name: last.name,
      chapters: last.chapters + chaptersLeft,
      targetWords: last.targetWords + wordsLeft,
    };
  }
  return {
    genre: input.genre,
    chapters: input.chapters,
    targetWords: input.targetWords,
    beats: allocated,
  };
}
