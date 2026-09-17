/**
 * @inkforge/forge — `outline.generate` handler (G-14 → G-04d).
 *
 * Model first when a provider is configured, deterministic planner otherwise.
 * Both paths end in the same place: `parseOutline` validates the payload and
 * `saveOutline` persists it against the job's book. A model that returns prose,
 * junk, or an outline that violates the frozen schema is *not* an error — it is
 * a downgrade to the planner, because an author waiting on structure should
 * never get nothing.
 */
import {
  generateOutline,
  outlineSchema,
  parseOutline,
  type Outline,
  type OutlineRequest,
} from "@inkforge/core";
import { getBook, saveOutline, type JobRow } from "@inkforge/db";
import type { LlmClient } from "@inkforge/ai";
import { parseJsonResponse } from "@inkforge/ai";
import { z } from "zod";
import { HandlerError, type JobContext } from "../registry";

const outlineRequestSchema = z.object({
  premise: z.string().min(1).max(4_000),
  genre: z.string().max(120).optional(),
  targetWords: z.number().int().min(600).max(650_000).optional(),
  chapterCount: z.number().int().min(1).max(120).optional(),
  acts: z.number().int().min(1).max(9).optional(),
  seed: z.number().int().optional(),
});

const SYSTEM_PROMPT = [
  "You are a structural editor for commercial books.",
  "Return ONLY a JSON object of this exact shape:",
  '{"premise": string, "genre": string, "acts": string[], "chapters":',
  '[{"idx": number, "title": string, "brief": string, "targetWords": number}]}',
  "Chapters must be indexed from 0 without gaps, at least 1 and at most 120 entries,",
  "each targetWords between 50 and 20000.",
].join(" ");

export interface OutlineHandlerOptions {
  /** Resolved client, or undefined when no provider is configured/flag-enabled. */
  readonly llm?: LlmClient | undefined;
  /** Pulled from the job payload when the UI omits it. */
  readonly defaultTargetWords?: number;
}

/** Read + validate the job payload into an OutlineRequest. */
export function outlineRequestFromJob(job: JobRow, fallbackWords = 40_000): OutlineRequest {
  const parsed = outlineRequestSchema.safeParse(job.payload ?? {});
  if (!parsed.success) {
    throw new HandlerError(
      `outline.generate: invalid payload (${parsed.error.issues[0]?.message ?? "invalid"})`,
      { retryable: false },
    );
  }
  return {
    premise: parsed.data.premise,
    ...(parsed.data.genre !== undefined ? { genre: parsed.data.genre } : {}),
    ...(parsed.data.acts !== undefined ? { acts: parsed.data.acts } : {}),
    ...(parsed.data.seed !== undefined ? { seed: parsed.data.seed } : {}),
    targetWords: parsed.data.targetWords ?? fallbackWords,
    chapterCount: parsed.data.chapterCount ?? 12,
  };
}

/**
 * Plan an outline, preferring the model and falling back to the deterministic
 * planner. Returns the outline plus which path produced it (stored in `result`).
 */
export async function planOutline(
  request: OutlineRequest,
  llm: LlmClient | undefined,
): Promise<{ outline: Outline; source: "model" | "planner"; detail?: string }> {
  if (llm) {
    try {
      const prompt = `${SYSTEM_PROMPT}\n\nPremise: ${request.premise}\nGenre: ${
        request.genre ?? "General"
      }\nTarget words: ${request.targetWords ?? 40_000}\nChapters: ${request.chapterCount ?? 12}\nActs: ${
        request.acts ?? 3
      }`;
      const completion = await llm.complete(prompt, { temperature: 0.7, maxTokens: 4_000 });
      const outline = parseJsonResponse(llm.provider, completion.text, outlineSchema);
      return { outline: parseOutline(outline), source: "model" };
    } catch (error) {
      return {
        outline: generateOutline(request),
        source: "planner",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { outline: generateOutline(request), source: "planner" };
}

/** Build the registered `outline.generate` handler. */
export function createOutlineHandler(options: OutlineHandlerOptions = {}) {
  return async function handleOutline(ctx: JobContext): Promise<unknown> {
    const { job, db, logger } = ctx;
    if (job.bookId === null) {
      throw new HandlerError("outline.generate: job has no bookId", { retryable: false });
    }
    const owned = await getBook(db, job.userId, job.bookId);
    if (owned.length === 0) {
      throw new HandlerError("outline.generate: book not found for principal", {
        retryable: false,
      });
    }
    const request = outlineRequestFromJob(job, options.defaultTargetWords ?? 40_000);
    const { outline, source, detail } = await planOutline(request, options.llm);
    const row = await saveOutline(db, job.userId, job.bookId, outline);
    logger.info(
      { jobId: job.id, outlineId: row.id, source, chapters: outline.chapters.length },
      "outline.generate: outline saved",
    );
    return {
      outlineId: row.id,
      bookId: job.bookId,
      source,
      chapters: outline.chapters.length,
      plannedWords: outline.chapters.reduce((total, beat) => total + beat.targetWords, 0),
      ...(detail !== undefined ? { fallbackDetail: detail } : {}),
    };
  };
}

/** Dropped: handlers take their Database from JobContext. */
