/**
 * NEGENTROPY-Ω Section 3 — universal niche coverage engine.
 *
 * For any (content category × data availability) cell the engine returns
 * either a stage pipeline (PASS) or an explicit refusal with a reason
 * (REFUSED). Unavailable data becomes a verification task, never a synthetic
 * value, and advice domains that legally need licensed verification are
 * refused outright — the anti-fabrication guardrail expressed as code.
 */

export const CONTENT_CATEGORIES = [
  "fiction",
  "nonfiction",
  "childrens",
  "academic-technical",
  "professional-b2b",
  "international",
  "low-data-emerging",
] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export const DATA_AVAILABILITY = ["full", "partial", "none"] as const;
export type DataAvailability = (typeof DATA_AVAILABILITY)[number];

export const EVIDENCE_CLASSES = [
  "primary-source",
  "expert-review",
  "market-snapshot",
  "public-dataset",
  "author-experience",
  "licensed-verification",
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export const PIPELINE_STAGES = [
  "research",
  "outline",
  "draft",
  "humanize",
  "validate",
  "export",
] as const;

export interface CoveragePlanStage {
  readonly id: (typeof PIPELINE_STAGES)[number];
  readonly output: string;
}

export interface CoveragePlan {
  readonly category: ContentCategory;
  readonly availability: DataAvailability;
  readonly topic: string;
  readonly verdict: "PASS" | "REFUSED";
  readonly adapter: string;
  readonly stages: readonly CoveragePlanStage[];
  readonly evidenceRequired: readonly EvidenceClass[];
  readonly verificationTasks: readonly string[];
  readonly refusalReason: string | null;
}

/** Domain keywords whose guidance legally requires licensed verification. */
const LICENSED_DOMAINS: readonly { readonly pattern: RegExp; readonly domain: string }[] = [
  { pattern: /\b(medical|dosage|diagnos|prescription|clinical treatment)\b/i, domain: "medical" },
  { pattern: /\b(legal advice|litigation strategy|statutory interpretation)\b/i, domain: "legal" },
  { pattern: /\b(investment advice|tax filing|securities)\b/i, domain: "financial" },
  { pattern: /\b(self-harm|suicide method|explosive|weapon construction)\b/i, domain: "harmful" },
];

const ADAPTERS: Readonly<Record<ContentCategory, string>> = {
  fiction: "E-1-fiction-structure",
  nonfiction: "E-2-nonfiction-evidence",
  childrens: "E-5-childrens-reading-level",
  "academic-technical": "E-3-academic-citation",
  "professional-b2b": "E-4-professional-case-study",
  international: "E-6-international-market",
  "low-data-emerging": "E-2-nonfiction-evidence",
};

const BASE_EVIDENCE: Readonly<Record<ContentCategory, readonly EvidenceClass[]>> = {
  fiction: [],
  nonfiction: ["primary-source"],
  childrens: ["expert-review"],
  "academic-technical": ["primary-source", "public-dataset"],
  "professional-b2b": ["author-experience", "market-snapshot"],
  international: ["market-snapshot"],
  "low-data-emerging": ["primary-source", "expert-review"],
};

const STAGE_OUTPUTS: Readonly<Record<(typeof PIPELINE_STAGES)[number], string>> = {
  research: "evidence ledger with per-claim sources",
  outline: "beat/chapter architecture from the category adapter",
  draft: "chapter drafts grounded in the evidence ledger",
  humanize: "voice-normalized prose with disclosure metadata",
  validate: "EPUBCheck + consistency + accessibility report",
  export: "EPUB, print PDF, and distribution metadata",
};

function licensedDomain(topic: string): string | null {
  for (const entry of LICENSED_DOMAINS) if (entry.pattern.test(topic)) return entry.domain;
  return null;
}


/**
 * Plan (or refuse) a coverage cell. `availability` describes the data the
 * author actually has; "none" on an evidence-hungry category cannot be
 * written honestly and is refused rather than fabricated.
 */
export function planForCell(input: {
  readonly category: ContentCategory;
  readonly availability: DataAvailability;
  readonly topic: string;
}): CoveragePlan {
  const { category, availability, topic } = input;
  const adapter = ADAPTERS[category];
  const domain = licensedDomain(topic);
  const base = {
    category,
    availability,
    topic,
    adapter,
    stages: PIPELINE_STAGES.map((id) => ({ id, output: STAGE_OUTPUTS[id] })),
  };

  if (domain !== null) {
    return {
      ...base,
      verdict: "REFUSED",
      evidenceRequired: ["licensed-verification"],
      verificationTasks: [
        `route ${domain} topics to a licensed professional for review before drafting`,
      ],
      refusalReason:
        domain === "harmful"
          ? "topic is in the prohibited class — the platform will not draft harmful instructions"
          : `${domain} guidance requires licensed verification; the platform refuses to synthesize it`,
    };
  }

  const evidence: EvidenceClass[] = [...BASE_EVIDENCE[category]];
  const verificationTasks: string[] = [];

  if (availability === "none") {
    const needsExternalEvidence =
      category !== "fiction" && category !== "childrens" && category !== "international";
    if (needsExternalEvidence) {
      return {
        ...base,
        verdict: "REFUSED",
        evidenceRequired: evidence.length > 0 ? evidence : ["primary-source"],
        verificationTasks: [
          "supply source material before drafting (no verifiable data for this category)",
        ],
        refusalReason:
          "no verifiable data — refusing rather than generating unsourced claims for this category",
      };
    }
    verificationTasks.push("author-supplied experience is the evidence base; label it as such");
  }

  if (availability === "partial") {
    if (!evidence.includes("expert-review")) evidence.push("expert-review");
    verificationTasks.push("mark every numeric or factual claim with a source slot before export");
    verificationTasks.push("run the claim-reality check over the drafted manuscript");
  }

  return {
    ...base,
    verdict: "PASS",
    evidenceRequired: evidence,
    verificationTasks,
    refusalReason: null,
  };
}

/** Evidence classes a plan requires (used by the report and the guardrail). */
export function requiredEvidence(plan: CoveragePlan): readonly EvidenceClass[] {
  return plan.evidenceRequired;
}
