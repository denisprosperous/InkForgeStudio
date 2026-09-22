/**
 * G-30e — marketplace listing pack: one deterministic mapping per target.
 *
 * Each target declares its own text limits and required fields. Long text is
 * truncated to the limit and the truncation is reported in `warnings` — a
 * silent cut would ship broken listings.
 */
import type { BookMeta } from "../book/index";
import { productMetadataSchema, type ProductMetadata } from "../book/product";

export const MARKETPLACE_TARGETS = ["kdp", "draft2digital", "kobo", "gumroad"] as const;
export type MarketplaceTarget = (typeof MARKETPLACE_TARGETS)[number];

interface TargetRules {
  readonly descriptionChars: number;
  readonly titleChars: number;
  readonly requiresCategories: boolean;
}

const RULES: Readonly<Record<MarketplaceTarget, TargetRules>> = {
  kdp: { descriptionChars: 4_000, titleChars: 200, requiresCategories: true },
  draft2digital: { descriptionChars: 3_000, titleChars: 200, requiresCategories: false },
  kobo: { descriptionChars: 2_000, titleChars: 250, requiresCategories: true },
  gumroad: { descriptionChars: 1_500, titleChars: 200, requiresCategories: false },
};

export interface MarketplaceListing {
  readonly target: MarketplaceTarget;
  readonly title: string;
  readonly author: string;
  readonly description: string;
  readonly language: string;
  readonly categories: readonly string[];
  readonly priceCents: number;
  readonly currency: string;
  readonly territories: readonly string[];
  readonly limits: { readonly descriptionChars: number; readonly titleChars: number };
  readonly warnings: readonly string[];
}

function clamp(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit);
}

/** Map one book onto a target marketplace's listing shape. */
export function buildMarketplaceListing(
  meta: BookMeta,
  product: ProductMetadata,
  target: MarketplaceTarget,
): MarketplaceListing {
  const rules = RULES[target];
  if (!rules) throw new Error(`unknown marketplace target: ${String(target)}`);
  const parsed = productMetadataSchema.parse(product);
  const warnings: string[] = [];
  const title = clamp(meta.title, rules.titleChars);
  if (title !== meta.title) warnings.push(`title truncated to ${rules.titleChars} chars`);
  const description = clamp(meta.description, rules.descriptionChars);
  if (description !== meta.description) {
    warnings.push(`description truncated to ${rules.descriptionChars} chars`);
  }
  if (rules.requiresCategories && parsed.categories.length === 0) {
    warnings.push(`${target} needs at least one category`);
  }
  if (parsed.priceCents === 0) warnings.push("no price set — the target will reject the listing");
  return {
    target,
    title,
    author: meta.author,
    description,
    language: meta.language,
    categories: parsed.categories,
    priceCents: parsed.priceCents,
    currency: parsed.currency,
    territories: parsed.territories,
    limits: { descriptionChars: rules.descriptionChars, titleChars: rules.titleChars },
    warnings,
  };
}
