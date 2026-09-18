/**
 * G-17 — studio UI flow contracts.
 *
 * The bridge client is the one place request shaping lives, so its contract is
 * asserted here with a mocked fetch: paths, bridge headers, JSON encoding and
 * typed error mapping. The pipeline-stage logic is pure and unit-tested
 * directly; the route modules are imported to prove the graph resolves.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const BASE = "http://forge.test";
const SECRET = "bridge-secret";

async function withEnv(run: () => Promise<void>): Promise<void> {
  const prevUrl = process.env.FORGE_BASE_URL;
  const prevSecret = process.env.FORGE_SHARED_SECRET;
  process.env.FORGE_BASE_URL = BASE;
  process.env.FORGE_SHARED_SECRET = SECRET;
  try {
    await run();
  } finally {
    if (prevUrl === undefined) delete process.env.FORGE_BASE_URL;
    else process.env.FORGE_BASE_URL = prevUrl;
    if (prevSecret === undefined) delete process.env.FORGE_SHARED_SECRET;
    else process.env.FORGE_SHARED_SECRET = prevSecret;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("forge bridge client (G-17)", () => {
  it("sends the bridge contract: secret + principal headers on every call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ books: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await withEnv(async () => {
      const { listBooks } = await import("../src/lib/forge");
      await listBooks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/books`);
    const headers = init.headers as Record<string, string>;
    expect(headers["x-forge-secret"]).toBe(SECRET);
    expect(headers["x-forge-user"]).toBe("preview-user");
  });

  it("encodes POST bodies as JSON for createBook", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ book: { id: "b1", title: "T", author: "A", status: "drafting" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await withEnv(async () => {
      const { createBook } = await import("../src/lib/forge");
      await createBook({ title: "T", author: "A", genre: "Fiction" });
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ title: "T", author: "A", genre: "Fiction" });
  });

  it("maps forge errors onto ForgeError with the upstream status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "book_not_found" }, 404)),
    );
    await withEnv(async () => {
      const { getBook } = await import("../src/lib/forge");
      await expect(getBook("nope")).rejects.toMatchObject({
        name: "ForgeError",
        status: 404,
        message: "book_not_found",
      });
    });
  });

  it("fails closed when the bridge secret is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await withEnv(async () => {
      const prev = process.env.FORGE_SHARED_SECRET;
      delete process.env.FORGE_SHARED_SECRET;
      const { listBooks } = await import("../src/lib/forge");
      await expect(listBooks()).rejects.toMatchObject({ name: "ForgeError", status: 503 });
      if (prev !== undefined) process.env.FORGE_SHARED_SECRET = prev;
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("pipeline stage logic (G-17)", () => {
  it("points at the stage with an in-flight job", async () => {
    const { activeStage } = await import("../src/lib/flows");
    expect(
      activeStage([
        { type: "outline.generate", status: "succeeded" },
        { type: "chapter.generate", status: "running" },
        { type: "book.export", status: "queued" },
      ]),
    ).toBe("draft");
    expect(activeStage([{ type: "book.export", status: "succeeded" }])).toBeUndefined();
  });

  it("derives the next actionable stage from manuscript facts", async () => {
    const { nextActionStage } = await import("../src/lib/flows");
    const facts = (overrides: Partial<Parameters<typeof nextActionStage>[0]>) => ({
      hasOutline: false,
      drafted: 0,
      humanized: 0,
      exportsValidated: 0,
      ...overrides,
    });
    expect(nextActionStage(facts({}))).toBe("outline");
    expect(nextActionStage(facts({ hasOutline: true }))).toBe("draft");
    expect(nextActionStage(facts({ hasOutline: true, drafted: 3 }))).toBe("humanize");
    expect(nextActionStage(facts({ hasOutline: true, drafted: 3, humanized: 2 }))).toBe("export");
    expect(
      nextActionStage(facts({ hasOutline: true, drafted: 3, humanized: 3, exportsValidated: 1 })),
    ).toBe("export");
  });
});

describe("studio route modules resolve (G-17: no dead links)", () => {
  it("imports every studio page + action module without dead references", async () => {
    const home = await import("../src/app/page");
    const library = await import("../src/app/studio/page");
    const actions = await import("../src/app/studio/actions");
    const bookPage = await import("../src/app/studio/books/[bookId]/page");
    const chapterPage = await import("../src/app/studio/books/[bookId]/chapters/[chapterId]/page");
    const exportRoute = await import("../src/app/studio/books/[bookId]/exports/[exportId]/route");
    expect(typeof home.default).toBe("function");
    expect(typeof library.default).toBe("function");
    expect(typeof bookPage.default).toBe("function");
    expect(typeof chapterPage.default).toBe("function");
    expect(typeof exportRoute.GET).toBe("function");
    for (const action of [
      actions.createBookAction,
      actions.addChapterAction,
      actions.generateOutlineAction,
      actions.draftChapterAction,
      actions.humanizeChapterAction,
      actions.saveChapterAction,
      actions.approveHumanizeAction,
      actions.rejectHumanizeAction,
      actions.exportBookAction,
    ]) {
      expect(typeof action).toBe("function");
    }
  });
});
