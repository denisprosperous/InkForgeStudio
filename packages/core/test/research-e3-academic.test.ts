/**
 * Adapter E-3 — academic citation slots: the platform formats only citations
 * whose identifying fields are supplied; it never invents a reference.
 */
import { describe, expect, it } from "vitest";
import { buildCitationSlot, isValidDoi, renderCitation } from "@inkforge/core";

describe("E-3 academic citation adapter", () => {
  it("accepts a well-formed DOI and rejects malformed ones", () => {
    expect(isValidDoi("10.1000/xyz123")).toBe(true);
    expect(isValidDoi("doi:10.1000/xyz123")).toBe(true);
    expect(isValidDoi("xyz123")).toBe(false);
  });

  it("renders a citation only when the identifying fields exist", () => {
    const slot = buildCitationSlot({
      title: "On Ember Mechanics",
      authors: ["Vane, M."],
      year: 2025,
      venue: "Journal of Craft",
      doi: "10.1000/xyz123",
    });
    const rendered = renderCitation(slot);
    expect(rendered).toContain("Vane, M.");
    expect(rendered).toContain("(2025)");
    expect(rendered).toContain("10.1000/xyz123");
  });

  it("refuses to render when a verifiable identifier is missing", () => {
    const slot = buildCitationSlot({ title: "Unverifiable Paper" });
    expect(slot.verifiable).toBe(false);
    expect(() => renderCitation(slot)).toThrow(/verifiable/);
  });

  it("marks partially supplied slots as unverifiable but keeps the data", () => {
    const slot = buildCitationSlot({ title: "Half Known", authors: ["Doe, J."] });
    expect(slot.verifiable).toBe(false);
    expect(slot.missingFields).toContain("year");
    expect(slot.missingFields).toContain("venue-or-doi");
  });

  it("is deterministic", () => {
    const input = { title: "T", authors: ["A"], year: 2020, venue: "V", doi: "10.1000/x" };
    expect(buildCitationSlot(input)).toEqual(buildCitationSlot(input));
  });
});
