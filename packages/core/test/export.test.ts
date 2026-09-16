import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildEpub, exportFilename } from "../src/export";
import { parseBookMeta, type Chapter } from "../src/book/index";

const META = parseBookMeta({
  title: "The Iron Forge",
  subtitle: "Book One of the Quill Logs",
  author: "Mara Quill",
  description: "A founder's log from the last working forge in the city.",
  keywords: ["forge", "apprenticeship"],
});

function chapter(idx: number, title: string, body: string): Chapter {
  return {
    id: `c${idx}`,
    idx,
    title,
    markdown: body,
    status: "final",
    wordCount: 0,
    createdAt: "",
    updatedAt: "",
  };
}

const CHAPTERS = [
  chapter(
    0,
    "The Forge Lights",
    "The forge woke before dawn, the way it always had.\n\n***\n\nBy seven the first hammer fell.",
  ),
  chapter(
    1,
    "Iron Lessons",
    "Iron does not negotiate. It yields exactly as much as the smith earns.",
  ),
];

describe("exportFilename", () => {
  it("derives a deterministic filesystem-safe name", () => {
    expect(exportFilename(META)).toBe("the-iron-forge-mara-quill.epub");
  });
});

describe("buildEpub", () => {
  it("produces a valid zip-shaped EPUB with real chapter content", async () => {
    const result = await buildEpub({ meta: META, chapters: CHAPTERS });

    expect(result.buffer.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(result.buffer.byteLength).toBeGreaterThan(1_000);
    expect(result.manifest.filename).toBe("the-iron-forge-mara-quill.epub");
    expect(result.manifest.chapters).toBe(2);
    expect(result.manifest.hasCover).toBe(false);

    const zip = await JSZip.loadAsync(result.buffer);
    const names = Object.keys(zip.files);

    const opfName = names.find((name) => name.endsWith(".opf"));
    expect(opfName).toBeDefined();
    const opf = await zip.files[opfName as string].async("string");
    expect(opf).toContain("The Iron Forge");
    expect(opf).toContain("Mara Quill");

    const chapterFiles = names.filter((name) => name.endsWith(".xhtml"));
    expect(chapterFiles.length).toBeGreaterThanOrEqual(2);
    const allHtml = (
      await Promise.all(chapterFiles.map((name) => zip.files[name].async("string")))
    ).join("\n");
    expect(allHtml).toContain("Iron does not negotiate");
    expect(allHtml).toContain("scene-break");
    expect(allHtml).toContain("The Forge Lights");
  });

  it("rejects manuscripts with zero chapters", async () => {
    await expect(buildEpub({ meta: META, chapters: [] })).rejects.toThrow(/zero chapters/i);
  });
});
