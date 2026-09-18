/** G-11 (slice b) — the KPF container, read back with a real ZIP reader. */
import { describe, expect, it } from "vitest";
import { buildKpf, KPF_SCHEMA } from "../src/index";
import { chapters, meta, readZip } from "./helpers/fixtures";

describe("kpf container (G-11)", () => {
  it("packages xhtml chapters, metadata and the named container schema", async () => {
    const kpf = buildKpf({ meta, chapters });
    const zip = await readZip(kpf.buffer);
    const paths = Object.keys(zip.files).sort();
    expect(paths).toContain("manifest.json");
    expect(paths).toContain("content/chapter-0001.xhtml");
    expect(paths).toContain("content/chapter-0002.xhtml");
    expect(paths).toContain("metadata/book.json");
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as {
      schema: string;
      chapters: { file: string }[];
      aiDisclosure: boolean;
    };
    expect(manifest.schema).toBe(KPF_SCHEMA);
    expect(manifest.chapters).toHaveLength(2);
    expect(manifest.aiDisclosure).toBe(true);
    const xhtml = await zip.file("content/chapter-0001.xhtml")!.async("string");
    expect(xhtml).toContain("The Lamp");
    expect(kpf.filename).toBe("quiet-machines-mara-vane.kpf");
  });

  it("refuses an empty manuscript and stays deterministic", () => {
    expect(() => buildKpf({ meta, chapters: [] })).toThrow(/zero chapters/);
    const first = buildKpf({ meta, chapters }, { enabled: false });
    const second = buildKpf({ meta, chapters }, { enabled: false });
    expect(first.manifest.aiDisclosure).toBe(false);
    expect(first.buffer.equals(second.buffer)).toBe(true);
  });
});
