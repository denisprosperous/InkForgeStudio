import { describe, expect, it } from "vitest";
import RootLayout, { metadata } from "../src/app/layout";
import StudioHome from "../src/app/page";

describe("web shell", () => {
  it("exposes the root layout component", () => {
    expect(typeof RootLayout).toBe("function");
  });

  it("declares the studio metadata", () => {
    expect(JSON.stringify(metadata.title)).toContain("Inkforge Studio");
    expect(metadata.description).toContain("KDP-compliant");
  });

  it("exports the home page component", () => {
    expect(typeof StudioHome).toBe("function");
  });
});
