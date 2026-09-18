/** G-11 (slice b) — the DOCX adapter, read back with a real ZIP reader. */
import { describe, expect, it } from "vitest";
import { buildDocx } from "../src/index";
import { chapters, meta, readZip } from "./helpers/fixtures";

describe("docx adapter (G-11)", () => {
  it("writes a valid WordprocessingML package with the disclosure page", async () => {
    const docx = buildDocx({ meta, chapters });
    expect(docx.buffer.subarray(0, 2).toString("binary")).toBe("PK");
    const zip = await readZip(docx.buffer);
    const paths = Object.keys(zip.files).sort();
    expect(paths).toContain("[Content_Types].xml");
    expect(paths).toContain("word/document.xml");
    const document = await zip.file("word/document.xml")!.async("string");
    expect(document).toContain("<w:document");
    expect(document).toContain("Quiet Machines");
    expect(document).toContain("1. The Lamp");
    expect(document).toContain("AI-Generated Content Disclosure");
    expect(docx.manifest.aiDisclosure).toBe(true);
    expect(docx.filename).toBe("quiet-machines-mara-vane.docx");
  });

  it("omits the disclosure page when disabled and stays deterministic", () => {
    const first = buildDocx({ meta, chapters }, { enabled: false });
    const second = buildDocx({ meta, chapters }, { enabled: false });
    expect(first.manifest.aiDisclosure).toBe(false);
    expect(first.buffer.equals(second.buffer)).toBe(true);
  });

  it("escapes XML-unsafe chapter prose instead of producing invalid XML", async () => {
    const sharp = [
      { ...chapters[0]!, markdown: "# Sharp\n\nBen & <the> \"machine\" said: keep <this> & that." },
    ];
    const docx = buildDocx({ meta, chapters: sharp });
    const zip = await readZip(docx.buffer);
    const document = await zip.file("word/document.xml")!.async("string");
    expect(document).toContain("Ben &amp; &lt;the&gt;");
    expect(document).not.toContain("Ben & <the>");
  });
});
