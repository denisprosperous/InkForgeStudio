/**
 * Adapter E-3 — academic citation slots.
 *
 * The platform formats citations; it never invents them. A slot without the
 * identifying fields is stored but marked unverifiable, and rendering refuses
 * until the record could be found in a real index.
 */

const DOI_PATTERN = /^(?:doi:)?10\.\d{4,9}\/\S+$/i;

export function isValidDoi(value: string): boolean {
  return DOI_PATTERN.test(value.trim());
}

export interface CitationInput {
  readonly title: string;
  readonly authors?: readonly string[];
  readonly year?: number;
  readonly venue?: string;
  readonly doi?: string;
}

export interface CitationSlot {
  readonly title: string;
  readonly authors: readonly string[];
  readonly year: number | null;
  readonly venue: string | null;
  readonly doi: string | null;
  readonly verifiable: boolean;
  readonly missingFields: readonly string[];
}

export function buildCitationSlot(input: CitationInput): CitationSlot {
  const missingFields: string[] = [];
  const authors = input.authors ?? [];
  if (authors.length === 0) missingFields.push("authors");
  if (input.year === undefined) missingFields.push("year");
  const venue = input.venue?.trim() ?? null;
  const doi = input.doi?.trim() ?? null;
  if (doi !== null && !isValidDoi(doi)) throw new Error(`invalid DOI: ${doi}`);
  if ((venue === null || venue.length === 0) && doi === null) missingFields.push("venue-or-doi");
  const verifiable = missingFields.length === 0;
  return {
    title: input.title,
    authors,
    year: input.year ?? null,
    venue,
    doi,
    verifiable,
    missingFields,
  };
}

/** Render a reference only when the slot is verifiable. */
export function renderCitation(slot: CitationSlot): string {
  if (!slot.verifiable) {
    throw new Error(
      `citation is not verifiable — missing ${slot.missingFields.join(", ")}; supply them before citing`,
    );
  }
  const year = slot.year === null ? "" : ` (${slot.year})`;
  const identifier = slot.doi !== null ? ` doi:${slot.doi}` : ` ${slot.venue ?? ""}`.trimEnd();
  return `${slot.authors.join("; ")}${year}. ${slot.title}.${identifier ? ` ${identifier}.` : ""}`;
}
