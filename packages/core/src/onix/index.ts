/**
 * G-18 — ISBN / BISAC / ONIX 3.0 (B19): the wide-distribution metadata face.
 *
 * Deterministic identifiers + trade-metadata export: ISBN-13 with real
 * checksum validation, BISAC category-code validation, and a minimal but
 * spec-conformant ONIX 3.0 XML message built from book meta + the G-13
 * product payload. Pure string assembly — no model calls, byte-stable.
 */
import { z } from "zod";
import type { BookMeta } from "../book/index";
import { productMetadataSchema, type ProductMetadata } from "../book/product";

/** ISBN-13: 12 digits + computed check digit; accepts dashed/hyphenated input. */
export function normalizeIsbn13(input: string): string {
  const digits = input.replace(/[^0-9Xx]/g, "").toUpperCase();
  if (digits.length !== 13 || !/^\d{12}[\dX]$/.test(digits)) {
    throw new Error(`invalid ISBN-13: ${input}`);
  }
  return digits;
}

/** Validates and returns the check digit per the ISBN-13 modulus-10 rule. */
export function isbn13CheckDigit(first12: string): string {
  if (!/^\d{12}$/.test(first12)) throw new Error("ISBN check digit needs exactly 12 digits");
  const sum = [...first12].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return String((10 - (sum % 10)) % 10);
}

export function isValidIsbn13(input: string): boolean {
  try {
    const digits = normalizeIsbn13(input);
    return isbn13CheckDigit(digits.slice(0, 12)) === digits[12];
  } catch {
    return false;
  }
}

/** BISAC subject codes look like "FIC000000" — 3 letters + 6 digits. */
const BISAC_CODE = /^[A-Z]{3}\d{6}$/;

export function isValidBisacCode(code: string): boolean {
  return BISAC_CODE.test(code);
}

export const distributionIdentifierSchema = z.object({
  /** EAN-13 / ISBN-13 of this product manifestation. */
  isbn13: z
    .string()
    .refine((value) => isValidIsbn13(value), { message: "invalid ISBN-13 check digit" })
    .optional(),
  /** Publisher-assigned SKU when no ISBN exists (KDP ASIN-bound drafts). */
  sku: z.string().min(1).max(64).optional(),
});
export type DistributionIdentifier = z.infer<typeof distributionIdentifierSchema>;

/** XML-escape the five predefined entities for text content. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdata(value: string): string {
  return `<![CDATA[${value.replace(/\]\]>/g, "]]><![CDATA]>")}]]>`;
}

export interface OnixInput {
  readonly meta: BookMeta;
  readonly product?: ProductMetadata | undefined;
  readonly identifier?: DistributionIdentifier | undefined;
}

/**
 * Build a minimal ONIX 3.0 <Product> record: descriptive (title, contributor,
 * language, subject BISAC, extent) + collateral (description) + supply (price)
 * blocks. Stable element order and CDATA text keep the output byte-stable for
 * a given input.
 */
export function buildOnix30(input: OnixInput): string {
  const { meta, identifier } = input;
  const product = productMetadataSchema.parse(input.product ?? {});
  const isbn = identifier?.isbn13 ?? undefined;
  const recordId = isbn ?? identifier?.sku ?? "";
  if (recordId.length === 0) {
    throw new Error("ONIX needs an isbn13 or sku identifier");
  }
  const language = meta.language.slice(0, 2).toLowerCase();
  const subjects = product.categories.length > 0 ? product.categories : ["FIC000000"];

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="utf-8"?>`);
  lines.push(`<ONIXMessage release="3.0" xmlns="http://www.editeur.org/onix/3.0/reference">`);
  lines.push(`  <Header>`);
  lines.push(`    <Sender><SenderName>${esc(meta.author)}</SenderName></Sender>`);
  lines.push(`    <SentDateTime>${new Date(0).toISOString()}</SentDateTime>`);
  lines.push(`  </Header>`);
  lines.push(`  <Product>`);
  lines.push(`    <RecordReference>${esc(recordId)}</RecordReference>`);
  lines.push(`    <NotificationType>03</NotificationType>`);
  lines.push(`    <ProductIdentifier>`);
  lines.push(`      <ProductIDType>15</ProductIDType>`);
  lines.push(`      <IDValue>${esc(recordId)}</IDValue>`);
  lines.push(`    </ProductIdentifier>`);
  lines.push(`    <DescriptiveDetail>`);
  lines.push(`      <TitleDetail>`);
  lines.push(`        <TitleElement>`);
  lines.push(`          <TitleElementText>${cdata(meta.title)}</TitleElementText>`);
  lines.push(`        </TitleElement>`);
  lines.push(`      </TitleDetail>`);
  lines.push(`      <Contributor>`);
  lines.push(`        <SequenceNumber>1</SequenceNumber>`);
  lines.push(`        <ContributorRole>01</ContributorRole>`);
  lines.push(`        <PersonName>${cdata(meta.author)}</PersonName>`);
  lines.push(`      </Contributor>`);
  lines.push(`      <Language>`);
  lines.push(`        <LanguageRole>01</LanguageRole>`);
  lines.push(`        <LanguageCode>${esc(language)}</LanguageCode>`);
  lines.push(`      </Language>`);
  for (const subject of subjects.slice(0, 12)) {
    lines.push(`      <Subject>`);
    lines.push(`        <SubjectSchemeIdentifier>12</SubjectSchemeIdentifier>`);
    lines.push(`        <SubjectCode>${esc(subject.replace(/\s+/g, ""))}</SubjectCode>`);
    lines.push(`      </Subject>`);
  }
  lines.push(`    </DescriptiveDetail>`);
  lines.push(`    <CollateralDetail>`);
  lines.push(`      <TextContent>`);
  lines.push(`        <TextType>03</TextType>`);
  lines.push(`        <Text format="text">${cdata(meta.description)}</Text>`);
  lines.push(`      </TextContent>`);
  lines.push(`    </CollateralDetail>`);
  lines.push(`    <PublishingDetail>`);
  lines.push(`      <PublishingStatus>04</PublishingStatus>`);
  lines.push(`    </PublishingDetail>`);
  if (product.priceCents > 0) {
    lines.push(`    <ProductSupply>`);
    lines.push(`      <SupplyDetail>`);
    lines.push(`        <SupplierName>INFK</SupplierName>`);
    lines.push(`        <Price>`);
    lines.push(`          <PriceType>02</PriceType>`);
    lines.push(`          <CurrencyCode>${esc(product.currency)}</CurrencyCode>`);
    lines.push(`          <PriceAmount>${(product.priceCents / 100).toFixed(2)}</PriceAmount>`);
    lines.push(`        </Price>`);
    lines.push(`      </SupplyDetail>`);
    lines.push(`    </ProductSupply>`);
  }
  lines.push(`  </Product>`);
  lines.push(`</ONIXMessage>`);
  return `${lines.join("\n")}\n`;
}
