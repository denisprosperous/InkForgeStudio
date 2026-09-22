/**
 * NEGENTROPY-Ω Section 3 — universal niche coverage engine.
 *
 * The engine decides, for any (content category × data availability) cell,
 * whether the platform can honestly produce a plan (PASS) or must refuse
 * (REFUSED with a reason), and which evidence classes the plan requires.
 * Nothing here invents facts: unavailable data becomes a verification
 * requirement, never a synthetic value.
 */
import { describe, expect, it } from "vitest";
import {
  CONTENT_CATEGORIES,
  DATA_AVAILABILITY,
  EVIDENCE_CLASSES,
  planForCell,
  requiredEvidence,
} from "@inkforge/core";

describe("Section 3 axes", () => {
  it("covers the seven declared content categories", () => {
    expect(CONTENT_CATEGORIES).toEqual([
      "fiction",
      "nonfiction",
      "childrens",
      "academic-technical",
      "professional-b2b",
      "international",
      "low-data-emerging",
    ]);
  });

  it("models three availability levels", () => {
    expect(DATA_AVAILABILITY).toEqual(["full", "partial", "none"]);
  });

  it("declares the evidence classes a plan can require", () => {
    expect(EVIDENCE_CLASSES).toContain("primary-source");
    expect(EVIDENCE_CLASSES).toContain("expert-review");
    expect(EVIDENCE_CLASSES).toContain("market-snapshot");
  });
});

describe("Section 3 cell planning", () => {
  it("passes a full-data fiction cell with a stage pipeline", () => {
    const plan = planForCell({ category: "fiction", availability: "full", topic: "oven magic" });
    expect(plan.verdict).toBe("PASS");
    expect(plan.stages.map((stage) => stage.id)).toEqual([
      "research",
      "outline",
      "draft",
      "humanize",
      "validate",
      "export",
    ]);
    expect(plan.adapter).toBe("E-1-fiction-structure");
  });

  it("refuses advice domains that require licensed verification", () => {
    const plan = planForCell({
      category: "nonfiction",
      availability: "full",
      topic: "medical dosage guidance",
    });
    expect(plan.verdict).toBe("REFUSED");
    expect(plan.refusalReason).toContain("licensed");
  });

  it("refuses a no-data cell that cannot be written honestly", () => {
    const plan = planForCell({
      category: "academic-technical",
      availability: "none",
      topic: "2027 benchmark results",
    });
    expect(plan.verdict).toBe("REFUSED");
    expect(plan.refusalReason).toContain("no verifiable data");
  });

  it("passes a partial-data cell but demands verification evidence", () => {
    const plan = planForCell({ category: "nonfiction", availability: "partial", topic: "remote work" });
    expect(plan.verdict).toBe("PASS");
    const evidence = requiredEvidence(plan);
    expect(evidence).toContain("primary-source");
    expect(evidence).toContain("expert-review");
    expect(plan.verificationTasks.length).toBeGreaterThan(0);
  });

  it("routes each category to its structure adapter", () => {
    expect(planForCell({ category: "childrens", availability: "full", topic: "kittens" }).adapter).toBe(
      "E-5-childrens-reading-level",
    );
    expect(
      planForCell({ category: "professional-b2b", availability: "full", topic: "procurement" }).adapter,
    ).toBe("E-4-professional-case-study");
  });

  it("is deterministic", () => {
    const input = { category: "fiction" as const, availability: "partial" as const, topic: "x" };
    expect(planForCell(input)).toEqual(planForCell(input));
  });
});
