/**
 * G-30a — cover A/B testing (C4): deterministic assignment + winner maths.
 *
 * Assignment is a stable hash of the book id so a reader always sees the
 * same cover variant across sessions (no flicker, reproducible QA), and
 * winner selection refuses to crown a variant until the impressions floor
 * is met — no fabricated conclusions from thin data.
 */

export interface CoverVariant {
  readonly variant: string;
  readonly label: string;
}

export interface CoverSample {
  readonly variant: string;
  readonly impressions: number;
  readonly clicks: number;
}

export interface CoverWinnerResult {
  readonly winner: string | null;
  readonly reason: string;
  readonly ctr: Readonly<Record<string, number>>;
}

/** FNV-1a over the book id — stable across processes (no Math.random). */
function hashBookId(bookId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bookId.length; index += 1) {
    hash ^= bookId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministically bucket a book into one of the A/B variants. */
export function assignCoverVariant(input: {
  readonly bookId: string;
  readonly variants: readonly CoverVariant[];
}): CoverVariant {
  if (input.variants.length === 0) {
    throw new Error("assignCoverVariant needs at least one variant");
  }
  const index = hashBookId(input.bookId) % input.variants.length;
  const variant = input.variants[index];
  if (!variant) throw new Error("variant index out of range");
  return variant;
}

/**
 * Pick the winning variant by click-through rate. Wins require every
 * *eligible* variant to have at least `minImpressions`; below that the
 * honest answer is "not enough data yet".
 */
export function pickCoverWinner(
  samples: readonly CoverSample[],
  options: { readonly minImpressions?: number } = {},
): CoverWinnerResult {
  const minImpressions = options.minImpressions ?? 500;
  const ctr: Record<string, number> = {};
  for (const sample of samples) {
    ctr[sample.variant] =
      sample.impressions === 0 ? 0 : sample.clicks / sample.impressions;
  }
  if (samples.length === 0) {
    return { winner: null, reason: "no samples recorded", ctr };
  }
  const thin = samples.filter((sample) => sample.impressions < minImpressions);
  if (thin.length > 0) {
    return {
      winner: null,
      reason: `insufficient data: ${thin
        .map((sample) => `${sample.variant}=${sample.impressions}`)
        .join(", ")} below ${minImpressions} impressions`,
      ctr,
    };
  }
  const ranked = [...samples].sort(
    (a, b) => (ctr[b.variant] ?? 0) - (ctr[a.variant] ?? 0) || a.variant.localeCompare(b.variant),
  );
  const best = ranked[0];
  if (!best) throw new Error("ranked list unexpectedly empty");
  return {
    winner: best.variant,
    reason: `CTR leader ${best.variant} at ${(ctr[best.variant] ?? 0).toFixed(4)}`,
    ctr,
  };
}
