/**
 * G-30d — direct-to-consumer product page (C4-adjacent).
 *
 * Builds the storefront payload a D2C checkout needs (JSON-LD Product plus
 * the checkout link) strictly from supplied commerce data. When the author
 * has not set a price the offer is omitted and the omission is reported —
 * the platform never invents a price.
 */
import type { BookMeta } from "../book/index";
import { productMetadataSchema, type ProductMetadata } from "../book/product";
import { slugify } from "../book/index";

export interface DirectCommerceInput {
  readonly checkoutUrl: string;
  readonly storeName: string;
}

export interface DirectProductPage {
  readonly jsonLd: Readonly<Record<string, unknown>>;
  readonly checkoutUrl: string;
  readonly storeName: string;
  readonly warnings: readonly string[];
}

export function buildDirectProductPage(
  meta: BookMeta,
  product: ProductMetadata,
  commerce: DirectCommerceInput,
): DirectProductPage {
  if (commerce.checkoutUrl.trim().length === 0) {
    throw new Error("a D2C product page needs a checkoutUrl");
  }
  if (commerce.storeName.trim().length === 0) {
    throw new Error("a D2C product page needs a storeName");
  }
  const parsed = productMetadataSchema.parse(product);
  const warnings: string[] = [];
  const base: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: meta.title,
    description: meta.description,
    brand: { "@type": "Brand", name: commerce.storeName },
    category: parsed.categories[0] ?? meta.genre,
    sku: slugify(`${meta.title}-${meta.author}`, 6),
  };
  if (parsed.priceCents > 0) {
    base.offers = {
      "@type": "Offer",
      url: commerce.checkoutUrl,
      price: (parsed.priceCents / 100).toFixed(2),
      priceCurrency: parsed.currency,
      availability: parsed.preorder ? "https://schema.org/PreOrder" : "https://schema.org/InStock",
      ...(parsed.territories.length > 0 ? { eligibleRegion: parsed.territories } : {}),
    };
  } else {
    warnings.push("no price set — the offer block is omitted until one exists");
  }
  if (meta.description.trim().length === 0) {
    warnings.push("empty description weakens the page's search snippet");
  }
  return {
    jsonLd: base,
    checkoutUrl: commerce.checkoutUrl,
    storeName: commerce.storeName,
    warnings,
  };
}
