/**
 * G-13 — product metadata schema (B2): the market/product face of a book.
 *
 * Consumers (metadata UI, ONIX/AEO exporters) attach this under
 * `meta.extra.product`. Every field defaults so the schema validates an empty
 * payload and grows additively — no migration churn for later extensions.
 */
import { z } from "zod";

export const MATURITY_RATINGS = ["general", "mature"] as const;
export type MaturityRating = (typeof MATURITY_RATINGS)[number];

export const productMetadataSchema = z.object({
  /** Retail price in minor units (cents) of `currency`. */
  priceCents: z.number().int().min(0).default(0),
  /** ISO-4217 alpha-3, normalized to upper case. */
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .default("USD"),
  /** BISAC-ready category strings ("FICTION / Fantasy / Epic"). */
  categories: z.array(z.string().min(1).max(120)).max(12).default([]),
  /** ISO-3166 alpha-2 sales territories, normalized to upper case. */
  territories: z
    .array(
      z
        .string()
        .trim()
        .length(2)
        .transform((value) => value.toUpperCase()),
    )
    .max(250)
    .default([]),
  preorder: z.boolean().default(false),
  maturityRating: z.enum(MATURITY_RATINGS).default("general"),
});
export type ProductMetadata = z.infer<typeof productMetadataSchema>;
