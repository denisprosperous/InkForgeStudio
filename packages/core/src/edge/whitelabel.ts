/**
 * G-30f — white-label branding (agency/imprint mode).
 *
 * Applies a validated brand kit to the export surface: legal line, imprint
 * and accent. The copyright line is assembled only from supplied fields, so
 * an unbranded or malformed kit fails loudly instead of shipping "undefined"
 * into a customer's book.
 */
import type { BookMeta } from "../book/index";

export interface BrandKit {
  readonly imprint: string;
  readonly url?: string;
  readonly accentColor?: string;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export interface AppliedBrand {
  readonly imprint: string;
  readonly url: string | null;
  readonly accentColor: string | null;
  readonly copyrightLine: string;
  readonly manifest: {
    readonly title: string;
    readonly author: string;
    readonly brand: { readonly imprint: string; readonly accentColor: string | null };
  };
}

export function applyBrandKit(meta: BookMeta, brand: BrandKit): AppliedBrand {
  const imprint = brand.imprint.trim();
  if (imprint.length === 0) throw new Error("brand imprint is required");
  if (brand.accentColor !== undefined && !HEX_COLOR.test(brand.accentColor)) {
    throw new Error("accentColor must be a #rrggbb hex value");
  }
  const url = brand.url?.trim() ?? "";
  if (brand.url !== undefined && url.length === 0) {
    throw new Error("brand url was provided but empty");
  }
  const copyrightLine = [
    `Copyright © ${meta.author}.`,
    `Published by ${imprint}.`,
    url.length > 0 ? url : "All rights reserved.",
  ].join(" ");
  return {
    imprint,
    url: url.length > 0 ? url : null,
    accentColor: brand.accentColor ?? null,
    copyrightLine,
    manifest: {
      title: meta.title,
      author: meta.author,
      brand: { imprint, accentColor: brand.accentColor ?? null },
    },
  };
}
