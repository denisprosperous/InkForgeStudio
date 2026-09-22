/**
 * Adapter E-4 — professional / B2B case studies.
 *
 * Outcome claims must be backed by a measured metric with a named source;
 * confidentiality is stated explicitly so anonymization is never implicit.
 */

export interface CaseStudyMetric {
  readonly name: string;
  readonly before?: string;
  readonly after?: string;
  readonly value?: string;
  readonly source: string;
}

export interface CaseStudyClaim {
  readonly text: string;
  readonly metric: { readonly name: string; readonly value: string; readonly source: string } | null;
}

export interface CaseStudyOutline {
  readonly clientLabel: string;
  readonly confidential: boolean;
  readonly disclosure: string;
  readonly sections: readonly {
    readonly id: "situation" | "intervention" | "metrics" | "lessons";
    readonly title: string;
    readonly items: readonly string[];
  }[];
}

export function buildCaseStudyOutline(input: {
  readonly clientLabel: string;
  readonly confidential: boolean;
  readonly metrics: readonly CaseStudyMetric[];
}): CaseStudyOutline {
  if (input.metrics.length === 0) {
    throw new Error("a case study needs at least one metric before it can be outlined");
  }
  if (input.confidential && input.clientLabel.trim().length === 0) {
    throw new Error("confidential case studies still need a client label for anonymization");
  }
  return {
    clientLabel: input.clientLabel,
    confidential: input.confidential,
    disclosure: input.confidential
      ? "Client identity anonymized at their request; numbers verified against their exports."
      : "Client named with permission.",
    sections: [
      {
        id: "situation",
        title: "Situation",
        items: [`Where ${input.clientLabel} started`],
      },
      { id: "intervention", title: "Intervention", items: ["What we changed and why"] },
      {
        id: "metrics",
        title: "Measured outcome",
        items: input.metrics.map((metric) => {
          const delta =
            metric.before !== undefined && metric.after !== undefined
              ? `${metric.before} → ${metric.after}`
              : (metric.value ?? "measured");
          return `${metric.name}: ${delta} (source: ${metric.source})`;
        }),
      },
      { id: "lessons", title: "What transfers", items: ["Conditions another team needs"] },
    ],
  };
}

export interface CaseStudyReport {
  readonly ok: boolean;
  readonly unsupported: readonly CaseStudyClaim[];
}

/** Claims need a metric with a named source; anything else is unsupported. */
export function verifyCaseStudyClaims(claims: readonly CaseStudyClaim[]): CaseStudyReport {
  const unsupported = claims.filter(
    (claim) =>
      claim.metric === null ||
      claim.metric.source.trim().length === 0 ||
      claim.metric.value.trim().length === 0,
  );
  return { ok: unsupported.length === 0, unsupported };
}
