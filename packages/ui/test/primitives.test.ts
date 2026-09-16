import { describe, expect, it } from "vitest";
import { cn, cva } from "../src/primitives/index";

describe("cn", () => {
  it("joins conditional classes", () => {
    expect(cn("flex", false && "hidden", "items-center")).toBe("flex items-center");
  });

  it("resolves tailwind conflicts last-write-wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  it("keeps non-conflicting classes from both sides", () => {
    const merged = cn("p-2", "text-sm", "p-4");
    expect(merged).toContain("p-4");
    expect(merged).toContain("text-sm");
  });

  it("returns an empty string for no input", () => {
    expect(cn()).toBe("");
  });
});

describe("cva re-export", () => {
  it("builds a working variant resolver", () => {
    const button = cva("inline-flex", {
      variants: { intent: { primary: "bg-ink-600", ghost: "bg-transparent" } },
    });
    expect(button({ intent: "primary" })).toContain("bg-ink-600");
    expect(button({ intent: "ghost" })).toContain("bg-transparent");
  });
});
