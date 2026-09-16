import { describe, expect, it } from "vitest";
import { COVER_HEIGHT_PX, COVER_WIDTH_PX, defaultPalette, validateCoverSpec } from "../src/index";

const VALID = {
  title: "The Iron Forge",
  author: "Mara Quill",
  subtitle: "Book One of the Quill Logs",
  style: "typographic",
  palette: { background: "#101418", primary: "#f5f0e6", accent: "#C8A24B" },
};

describe("validateCoverSpec", () => {
  it("accepts a well-formed spec and normalizes hex casing", () => {
    const result = validateCoverSpec(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.palette.accent).toBe("#c8a24b");
      expect(result.spec.title).toBe("The Iron Forge");
    }
  });

  it("rejects a non-object payload", () => {
    expect(validateCoverSpec("nope").ok).toBe(false);
    expect(validateCoverSpec(null).ok).toBe(false);
  });

  it("collects field-level issues for empty title and bad palette", () => {
    const result = validateCoverSpec({
      title: "  ",
      author: "A. Author",
      style: "minimal",
      palette: { background: "white", primary: "#fff", accent: 12 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.issues.map((issue) => issue.field);
      expect(fields).toContain("title");
      expect(fields).toContain("palette.background");
      expect(fields).toContain("palette.primary");
      expect(fields).toContain("palette.accent");
    }
  });

  it("rejects unknown styles", () => {
    const result = validateCoverSpec({ ...VALID, style: "holographic" });
    expect(result.ok).toBe(false);
  });

  it("enforces length limits", () => {
    const result = validateCoverSpec({ ...VALID, author: "a".repeat(201) });
    expect(result.ok).toBe(false);
  });
});

describe("defaultPalette", () => {
  it("is deterministic per style and hex-legal", () => {
    for (const style of ["typographic", "minimal", "genre-art"] as const) {
      const palette = defaultPalette(style);
      expect(palette.background).toMatch(/^#[0-9a-f]{6}$/u);
      expect(defaultPalette(style)).toEqual(palette);
    }
  });
});

describe("KDP trim constants", () => {
  it("pins the 1600×2560 recommended raster", () => {
    expect(COVER_WIDTH_PX).toBe(1600);
    expect(COVER_HEIGHT_PX).toBe(2560);
  });
});
