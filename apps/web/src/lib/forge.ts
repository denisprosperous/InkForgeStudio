/**
 * apps/web/src/lib/forge.ts — server-side bridge client (G-17).
 *
 * The web tier never talks to Postgres; every studio flow goes through the
 * forge HTTP bridge with the shared secret and the tenant principal in the
 * headers (apps/forge/src/auth.ts is the contract). This module is the ONE
 * place request shaping lives, so the studio pages stay declarative and the
 * bridge contract stays testable (apps/web/test/flows.test.ts).
 */
import type { Outline } from "@inkforge/core";

export const FORGE_BASE_URL = process.env.FORGE_BASE_URL ?? "http://localhost:4000";
/** Preview session principal when Stack Auth is not configured (dev/preview). */
export const FORGE_PRINCIPAL = process.env.FORGE_PRINCIPAL ?? "preview-user";

/** Bridge headers for raw passthrough fetches (export download proxy). */
export function forgeHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-forge-secret": process.env.FORGE_SHARED_SECRET ?? "",
    "x-forge-user": FORGE_PRINCIPAL,
  };
}

export class ForgeError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "ForgeError";
    this.status = status;
  }
}

export interface ForgeBook {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly author: string;
  readonly description: string;
  readonly genre: string;
  readonly keywords: string[];
  readonly language: string;
  readonly seriesLabel: string | null;
  readonly publishTarget: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ForgeChapter {
  readonly id: string;
  readonly bookId: string;
  readonly idx: number;
  readonly title: string;
  readonly markdown: string;
  readonly status: string;
  readonly wordCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ForgeOutlineRow {
  readonly id: string;
  readonly bookId: string;
  readonly payload: Outline;
  readonly createdAt: string;
}

export interface ForgeJob {
  readonly id: string;
  readonly bookId: string | null;
  readonly type: string;
  readonly status: string;
  readonly payload: unknown;
  readonly result: unknown;
  readonly error: string | null;
  readonly attempts: number;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

export interface ForgeExport {
  readonly id: string;
  readonly bookId: string;
  readonly kind: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly validation: { epubcheck?: string } | null;
  readonly createdAt: string;
}

export interface ForgeRequestInit {
  readonly method?: string;
  readonly body?: unknown;
  readonly timeoutMs?: number;
}

/** Shape one bridge request; throws ForgeError with the forge status on failure. */
export async function forgeFetch<T>(path: string, init: ForgeRequestInit = {}): Promise<T> {
  const secret = process.env.FORGE_SHARED_SECRET;
  if (secret === undefined || secret.trim() === "") {
    throw new ForgeError(503, "forge_bridge_not_configured");
  }
  let response: Response;
  try {
    response = await fetch(`${FORGE_BASE_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-forge-secret": secret,
        "x-forge-user": FORGE_PRINCIPAL,
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs ?? 5_000),
    });
  } catch (error) {
    throw new ForgeError(502, error instanceof Error ? error.message : "forge_unreachable");
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new ForgeError(
      response.status,
      typeof detail.error === "string" ? detail.error : `forge_status_${response.status}`,
    );
  }
  return (await response.json()) as T;
}

// ── Library (G-04b surface) ─────────────────────────────────────────────

export const listBooks = () =>
  forgeFetch<{ books: ForgeBook[] }>("/books").then((data) => data.books);

export const getBook = (bookId: string) =>
  forgeFetch<{ book: ForgeBook }>(`/books/${bookId}`).then((data) => data.book);

export const createBook = (input: {
  title: string;
  author: string;
  description?: string;
  genre?: string;
}) => forgeFetch<{ book: ForgeBook }>("/books", { method: "POST", body: input });

export const listChapters = (bookId: string) =>
  forgeFetch<{ chapters: ForgeChapter[] }>(`/books/${bookId}/chapters`).then((d) => d.chapters);

export const createChapter = (bookId: string, input: { title: string; markdown?: string }) =>
  forgeFetch<{ chapter: ForgeChapter }>(`/books/${bookId}/chapters`, {
    method: "POST",
    body: input,
  });

export const updateChapter = (
  bookId: string,
  chapterId: string,
  input: { title?: string; markdown?: string; status?: string },
) =>
  forgeFetch<{ chapter: ForgeChapter }>(`/books/${bookId}/chapters/${chapterId}`, {
    method: "PATCH",
    body: input,
  });

export const getOutline = (bookId: string) =>
  forgeFetch<{ outline: ForgeOutlineRow | null }>(`/books/${bookId}/outline`).then(
    (d) => d.outline,
  );

// ── Jobs + exports ──────────────────────────────────────────────────────

export const enqueueJob = (input: { bookId?: string; type: string; payload?: unknown }) =>
  forgeFetch<{ job: ForgeJob }>("/jobs", { method: "POST", body: input });

export const listJobs = (bookId?: string) =>
  forgeFetch<{ jobs: ForgeJob[] }>(bookId ? `/jobs?bookId=${bookId}` : "/jobs").then((d) => d.jobs);

export const listExports = (bookId: string) =>
  forgeFetch<{ exports: ForgeExport[] }>(`/books/${bookId}/exports`).then((d) => d.exports);
