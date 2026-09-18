/**
 * apps/web/src/lib/flows.ts — the studio pipeline as pure data (G-17).
 *
 * The book page renders the flow project → outline → draft → humanize →
 * validate → export. Deciding which stage is active and which comes next is
 * pure logic over job/chapter rows, so it is unit-tested without a server:
 * the pages stay declarative and the pipeline contract stays auditable.
 */

export type Stage = "outline" | "draft" | "humanize" | "validate" | "export";

export const STAGE_ORDER: readonly Stage[] = ["outline", "draft", "humanize", "validate", "export"];

export const STAGE_JOB_TYPE: Record<Exclude<Stage, "validate">, string> = {
  outline: "outline.generate",
  draft: "chapter.generate",
  humanize: "chapter.humanize",
  export: "book.export",
};

export interface StageJob {
  readonly type: string;
  readonly status: string;
}

export interface StageFacts {
  /** Outline row exists. */
  readonly hasOutline: boolean;
  /** Chapters drafted (non-empty markdown). */
  readonly drafted: number;
  /** Chapters humanized. */
  readonly humanized: number;
  /** Stored artifacts with a passed/skipped EPUBCheck gate. */
  readonly exportsValidated: number;
}

/** First stage with a queued/running job — "what the author is waiting on". */
export function activeStage(jobs: readonly StageJob[]): Stage | undefined {
  for (const stage of STAGE_ORDER) {
    if (stage === "validate") continue; // validation rides on book.export
    const type = STAGE_JOB_TYPE[stage];
    if (
      jobs.some((job) => job.type === type && (job.status === "queued" || job.status === "running"))
    ) {
      return stage;
    }
  }
  return undefined;
}

/** The stage the author should act on next, given what already exists. */
export function nextActionStage(facts: StageFacts): Stage {
  if (!facts.hasOutline) return "outline";
  if (facts.drafted === 0) return "draft";
  if (facts.humanized === 0) return "humanize";
  if (facts.exportsValidated === 0) return "export";
  return "export";
}

/** One-line human summary for a stage — used by the pipeline board. */
export function stageLabel(stage: Stage): string {
  const labels: Record<Stage, string> = {
    outline: "Plan the outline",
    draft: "Draft chapters",
    humanize: "Humanize prose",
    validate: "Validate EPUB",
    export: "Export for KDP",
  };
  return labels[stage];
}
