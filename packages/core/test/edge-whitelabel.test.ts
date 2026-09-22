/**
 * G-30f — white-label branding: imprint/legal-line overrides applied to the
 * export surface, validated before use.
 */
import { describe, expect, it } from "vitest";
import { applyBrandKit, type BookMeta } from "@inkforge/core";

const META: BookMeta = {
  title: "A Study in Ember",
  author: "Dana Pryce",
  description: "A smith wakes the old fire.",
  genre: "Fantasy",
  keywords: [],
  language: "en",
  publishTarget: "kdp",
  extra: {},
};

describe("G-30f brand kit", () => {
  it("applies imprint, url and accent into the export front matter", () => {
    const applied = applyBrandKit(META, {
      imprint: "Pryce Press",
      url: "https://pryce.example",
      accentColor: "#c2410c",
    });
    expect(applied.copyrightLine).toContain("Pryce Press");
    expect(applied.copyrightLine).toContain("https://pryce.example");
    expect(applied.accentColor).toBe("#c2410c");
    expect(applied.manifest.brand.imprint).toBe("Pryce Press");
  });

  it("rejects malformed brands instead of emitting them", () => {
    expect(() => applyBrandKit(META, { imprint: "", url: "https://x.example" })).toThrow();
    expect(() =>
      applyBrandKit(META, { imprint: "P", url: "https://x.example", accentColor: "orange" }),
    ).toThrow();
  });

  it("defaults the year-free legal line when no url is given", () => {
    const applied = applyBrandKit(META, { imprint: "Pryce Press" });
    expect(applied.copyrightLine).toContain("Pryce Press");
    expect(applied.copyrightLine).not.toContain("undefined");
  });

  it("is deterministic", () => {
    const brand = { imprint: "Pryce Press", url: "https://pryce.example" };
    expect(applyBrandKit(META, brand)).toEqual(applyBrandKit(META, brand));
  });
});
