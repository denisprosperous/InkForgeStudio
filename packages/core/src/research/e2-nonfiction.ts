/**
 * Adapter E-2 — nonfiction evidence: promise-first architecture whose every
 * claim carries an evidence slot, plus the claim checker that powers the
 * anti-fabrication guardrail.
 */

export interface EvidenceSlot {
  readonly claim: string;
  readonly source: string;
}

export interface Claim {
  readonly text: string;
  readonly source: string | null;
}

export interface ClaimReport {
  readonly ok: boolean;
  readonly unsourced: readonly Claim[];
  readonly weakSources: readonly Claim[];
}

export interface NonfictionSection {
  readonly id: "promise" | "evidence" | "steps" | "objections" | "close";
  readonly title: string;
  readonly items: readonly string[];
}

export interface NonfictionOutline {
  readonly promise: string;
  readonly sections: readonly NonfictionSection[];
}

/** Sources that are too vague to support a factual or numeric claim. */
const WEAK_SOURCES = /^(vibes|common knowledge|everyone knows|trust me|unsourced)\b/i;
const NUMERIC_CLAIM = /\b\d+([.,]\d+)?\s*(%|x|percent)?\b/;

export function buildNonfictionOutline(input: {
  readonly promise: string;
  readonly steps: readonly string[];
  readonly objections: readonly string[];
  readonly evidenceSlots: readonly EvidenceSlot[];
}): NonfictionOutline {
  if (input.promise.trim().length === 0) {
    throw new Error("a nonfiction outline needs an explicit promise");
  }
  if (input.evidenceSlots.length === 0) {
    throw new Error("a nonfiction outline needs at least one evidence slot");
  }
  if (input.steps.length === 0) throw new Error("a nonfiction outline needs at least one step");
  return {
    promise: input.promise,
    sections: [
      { id: "promise", title: "The promise", items: [input.promise] },
      {
        id: "evidence",
        title: "Why this works",
        items: input.evidenceSlots.map((slot) => `${slot.claim} — ${slot.source}`),
      },
      { id: "steps", title: "The method", items: input.steps },
      { id: "objections", title: "Honest objections", items: input.objections },
      { id: "close", title: "What to do next", items: ["First step within 24 hours"] },
    ],
  };
}

/** Flags unsourced claims and numeric claims resting on weak sources. */
export function checkClaims(claims: readonly Claim[]): ClaimReport {
  const unsourced: Claim[] = [];
  const weakSources: Claim[] = [];
  for (const claim of claims) {
    if (claim.source === null || claim.source.trim().length === 0) {
      unsourced.push(claim);
      continue;
    }
    if (NUMERIC_CLAIM.test(claim.text) && WEAK_SOURCES.test(claim.source.trim())) {
      weakSources.push(claim);
    }
  }
  return { ok: unsourced.length === 0 && weakSources.length === 0, unsourced, weakSources };
}
