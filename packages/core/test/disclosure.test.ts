/**
 * G-06 — AI-disclosure layer for KDP exports (contract tests).
 *
 * The disclosure is compliance-critical: it must be real language (never a
 * placeholder), land as front matter between the copyright page and chapter 1,
 * be visible in EPUB metadata (dc:description), default ON for KDP-targeted
 * exports, and be switchable without touching the frozen export path.
 */
import { describe, expect, it } from "vitest";
import { parseBookMeta, type Chapter } from "../src/book/index";
import {
  DEFAULT_DISCLOSURE,
  DISCLOSURE_TITLE,
  buildDisclosedEpub,
  disclosureDocument,
  planDisclosure,
} from "../src/export/disclosure";

const META = parseBookMeta({
  title: "Quiet Machines",
  author: "Mara Vane",
  description: "A lighthouse keeper teaches a machine to be alone.",
  genre: "Science Fiction",
});

function chapter(idx: number, title: string): Chapter {
  return {
    id: `ch-${idx}`,
    idx,
    title,
    markdown: `# ${title}\n\nProse for chapter ${idx}. The lamp turned twice.`,
    status: "final",
    wordCount: 12,
    createdAt: "",
    updatedAt: "",
  };
}

const CHAPTERS = [chapter(0, "The Lamp"), chapter(1, "The Dark")];

describe("planDisclosure", () => {
  it("defaults ON for KDP-targeted exports", () => {
    const plan = planDisclosure({ meta: META, chapters: CHAPTERS });
    expect(plan.disclosureText).not.toBeNull();
    expect(plan.disclosureText).toContain("AI");
    // Real language, not a placeholder.
    expect(plan.disclosureText!.length).toBeGreaterThan(200);
    expect(plan.disclosureText).toMatch(/author/i);
  });

  it("leaves the author's description untouched when disabled", () => {
    const plan = planDisclosure({ meta: META, chapters: CHAPTERS }, { enabled: false });
    expect(plan.disclosureText).toBeNull();
    expect(plan.meta.description).toBe(META.description);
  });

  it("augments dc:description exactly once, idempotently", () => {
    const once = planDisclosure({ meta: META, chapters: CHAPTERS });
    const twice = planDisclosure({
      meta: once.meta,
      chapters: CHAPTERS,
    });
    expect(once.meta.description).toContain(DEFAULT_DISCLOSURE.SENTENCE);
    expect(twice.meta.description).toBe(once.meta.description);
    expect(twice.meta.title).toBe(META.title);
  });

  it("honours a custom disclosure text", () => {
    const plan = planDisclosure(
      { meta: META, chapters: CHAPTERS },
      { text: "Drafted with machine help; finished by hand." },
    );
    expect(plan.disclosureText).toBe("Drafted with machine help; finished by hand.");
  });

  it("does not mutate the caller's request", () => {
    const request = { meta: META, chapters: CHAPTERS };
    planDisclosure(request);
    expect(META.description).toBe("A lighthouse keeper teaches a machine to be alone.");
    expect(CHAPTERS.map((c) => c.idx)).toEqual([0, 1]);
  });
});

describe("disclosureDocument", () => {
  it("is front matter: ai-disclosure id, own class, escaped body", () => {
    const doc = disclosureDocument('Fish & <chips> "quoted"');
    expect(doc.id).toBe("ai-disclosure");
    expect(doc.title).toBe(DISCLOSURE_TITLE);
    expect(doc.data).toContain('class="ai-disclosure"');
    expect(doc.data).toContain("Fish &amp; &lt;chips&gt;");
    expect(doc.data).not.toContain("chapter-number");
  });
});

describe("buildDisclosedEpub", () => {
  it("places the disclosure between copyright and chapter one", async () => {
    const result = await buildDisclosedEpub({ meta: META, chapters: CHAPTERS });
    expect(result.manifest.aiDisclosure).toBe(true);
    const ids = result.manifest.documentIds;
    expect(ids).toContain("ai-disclosure");
    expect(ids.indexOf("ai-disclosure")).toBeGreaterThan(ids.indexOf("copyright-page"));
    expect(ids.indexOf("ai-disclosure")).toBeLessThan(
      ids.findIndex((id) => id.startsWith("chapter-")),
    );
    // The book's own chapter numbering is NOT shifted by front matter.
    expect(ids.filter((id) => id.startsWith("chapter-"))).toHaveLength(2);
    expect(result.buffer.subarray(0, 2).toString("binary")).toBe("PK");
  });

  it("exports byte-identically to buildEpub when disabled", async () => {
    const { buildEpub } = await import("../src/export/index");
    const plain = await buildEpub({ meta: META, chapters: CHAPTERS });
    const off = await buildDisclosedEpub({ meta: META, chapters: CHAPTERS }, { enabled: false });
    expect(off.manifest.aiDisclosure).toBe(false);
    expect(off.manifest.documentIds).toEqual(plain.manifest.documentIds);
    expect(off.manifest.words).toBe(plain.manifest.words);
  });

  it("still refuses a zero-chapter manuscript", async () => {
    await expect(buildDisclosedEpub({ meta: META, chapters: [] })).rejects.toThrow(
      /zero chapters/i,
    );
  });
});
