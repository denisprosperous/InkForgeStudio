/**
 * G-11 (slice a) — the deterministic ZIP writer and the audio-script adapter.
 * Archives are read back with jszip so the tests assert real ZIP structure
 * rather than trusting the writer; determinism is asserted byte-for-byte.
 */
import { describe, expect, it } from "vitest";
import { buildAudioScript, createZip, crc32 } from "../src/index";
import { chapters, meta, readZip } from "./helpers/fixtures";

describe("zip writer (G-11)", () => {
  it("computes the standard CRC-32 for known input", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("round-trips entries through a real ZIP reader", async () => {
    const zip = await readZip(
      createZip([
        { path: "a.txt", data: "hello" },
        { path: "nested/b.xml", data: "<b/>", compress: false },
      ]),
    );
    expect(Object.keys(zip.files).sort()).toEqual(["a.txt", "nested/b.xml"]);
    await expect(zip.file("a.txt")!.async("string")).resolves.toBe("hello");
    await expect(zip.file("nested/b.xml")!.async("string")).resolves.toBe("<b/>");
  });

  it("is byte-deterministic for identical input", () => {
    const entries = [{ path: "x.txt", data: "same bytes" }];
    expect(createZip(entries).equals(createZip(entries))).toBe(true);
  });
});

describe("audio-script adapter (G-11)", () => {
  it("produces a narration script with markers, segments and a duration estimate", () => {
    const script = buildAudioScript({ meta, chapters });
    expect(script.text).toContain("AUDIO NARRATION SCRIPT — Quiet Machines");
    expect(script.text).toContain("CHAPTER 1: The Lamp");
    expect(script.text).toContain("[[chapter-break]]");
    expect(script.text).toContain("[[pause]]");
    expect(script.text).toContain("[segment 1]");
    expect(script.text).not.toContain("# The Lamp"); // markdown stripped
    expect(script.manifest.segments).toBeGreaterThanOrEqual(4);
    expect(script.manifest.wordsPerMinute).toBe(150);
    expect(script.manifest.estimatedMinutes).toBeGreaterThanOrEqual(1);
    expect(script.filename).toBe("quiet-machines-mara-vane-audio-script.txt");
  });

  it("refuses an empty manuscript", () => {
    expect(() => buildAudioScript({ meta, chapters: [] })).toThrow(/zero chapters/);
  });
});
