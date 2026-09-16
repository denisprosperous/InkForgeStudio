/**
 * Export error wrapping, verified against a failing generator. Kept in its own
 * file because vi.mock is file-scoped; the happy-path tests live in
 * export.test.ts against the real epub-gen-memory.
 */
import { describe, expect, it, vi } from "vitest";
import { ExportError } from "../src/export";
import { parseBookMeta, type Chapter } from "../src/book/index";

vi.mock("epub-gen-memory", () => {
  class EPub {
    public constructor() {
      throw new Error("generator exploded");
    }
  }
  return { EPub };
});

describe("buildEpub error wrapping", () => {
  it("wraps generator failures in ExportError with the cause attached", async () => {
    const { buildEpub } = await import("../src/export");
    const meta = parseBookMeta({ title: "T", author: "A" });
    const chapters: Chapter[] = [
      {
        id: "c1",
        idx: 0,
        title: "One",
        markdown: "Body.",
        status: "draft",
        wordCount: 1,
        createdAt: "",
        updatedAt: "",
      },
    ];
    const error = await buildEpub({ meta, chapters }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExportError);
    expect((error as ExportError).message).toContain("generator exploded");
  });
});
