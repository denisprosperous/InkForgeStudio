/**
 * G-30c — bundling engine (C8): composition and a bounded pricing ladder.
 * Integer cents only; no channel assumptions — royalties need an explicit
 * rate so nothing is fabricated.
 */

export interface BundleMember {
  readonly title: string;
  readonly priceCents: number;
}

export interface PricedBundle {
  readonly listPriceCents: number;
  readonly priceCents: number;
  readonly savingsCents: number;
  readonly discountPercent: number;
}

/** Discounts beyond this would price inventory below sustainable bounds. */
const MAX_DISCOUNT_PERCENT = 60;

export function priceBundle(
  members: readonly BundleMember[],
  options: { readonly discountPercent: number },
): PricedBundle {
  if (members.length === 0) throw new Error("a bundle needs at least one member");
  const discountPercent = options.discountPercent;
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > MAX_DISCOUNT_PERCENT) {
    throw new Error(`discountPercent must be within 0..${MAX_DISCOUNT_PERCENT}`);
  }
  const listPriceCents = members.reduce((total, member) => total + member.priceCents, 0);
  const priceCents = Math.round(listPriceCents * (1 - discountPercent / 100));
  return {
    listPriceCents,
    priceCents,
    savingsCents: listPriceCents - priceCents,
    discountPercent,
  };
}

export interface BundleDiscountRecommendation {
  readonly discountPercent: number;
  readonly reason: string;
}

/** Deterministic ladder: more titles, deeper (but bounded) discount. */
export function recommendBundleDiscount(memberCount: number): BundleDiscountRecommendation {
  if (!Number.isInteger(memberCount) || memberCount < 2) {
    throw new Error("bundles start at two titles");
  }
  const discountPercent = memberCount >= 6 ? 25 : memberCount >= 4 ? 20 : memberCount >= 3 ? 15 : 10;
  return {
    discountPercent,
    reason: `${memberCount} titles sit in the ${discountPercent}% ladder rung`,
  };
}

export interface BundleRoyalty {
  readonly royaltyCents: number;
  readonly rate: number;
}

/** Royalty from an explicit rate (0..1) — never an assumed channel rate. */
export function bundleRoyalty(priceCents: number, rate: number): BundleRoyalty {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error("royalty rate must be within 0..1");
  }
  if (!Number.isFinite(priceCents) || priceCents < 0) {
    throw new Error("priceCents must be a non-negative number");
  }
  return { royaltyCents: Math.round(priceCents * rate), rate };
}
