/**
 * @inkforge/forge — `chapter.generate` handler (G-17a).
 *
 * Turns an outline beat into chapter prose. Model first when a provider is
 * configured; the deterministic composer (@inkforge/core composeDraft) is both
 * the fallback and the offline floor. Either way the draft lands in the
 * chapter row with a wordCount derived from the frozen core, never from the
 * wire. A model that fails or returns junk is a downgrade to the planner, not
 * an error — an author waiting on a draft should never get nothing.
 */
import { composeDraft, countWords } from "@inkforge/core";
import { getBook, getChapter, updateChapter, type JobRow } from "@inkforge/db";
import { estimateCostMicros, type LlmClient, type TokenUsage } from "@inkforge/ai";
import { z } from "zod";
import { HandlerError, type JobContext } from "../registry";

const chapterRequestSchema = z.object({
  chapterId: z.string().uuid(),
  brief: z.string().max(2_000).optional(),
  targetWords: z.number().int().min(100).max(8_000).optional(),
});

/** Deterministic per-chapter seed so replays are byte-identical. */
function seedFor(chapterId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < chapterId.length; i += 1) {
    hash ^= chapterId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const SYSTEM_PROMPT = [
  "You are a novelist drafting one scene of a commercial book.",
  "Return ONLY the scene as markdown: a `# <chapter title>` heading followed by prose paragraphs.",
  "No preamble, no commentary, no HTML comments. 300-800 words unless told otherwise.",
].join(" ");

function sanitizeModelMarkdown(text: string): string | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:markdown|md)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  return cleaned.length >= 100 ? cleaned : null;
}

export interface ChapterHandlerOptions {
  /** Resolved client, or undefined to run fully deterministic. */
  readonly llm?: LlmClient | undefined;
}

/** Build the registered `chapter.generate` handler. */
export function createChapterHandler(options: ChapterHandlerOptions = {}) {
  return async function handleChapterGenerate(ctx: JobContext): Promise<unknown> {
    const { job, db, logger } = ctx;
    if (job.bookId === null) {
      throw new HandlerError("chapter.generate: job has no bookId", { retryable: false });
    }
    const parsed = chapterRequestSchema.safeParse(job.payload ?? {});
    if (!parsed.success) {
      throw new HandlerError(
        `chapter.generate: invalid payload (${parsed.error.issues[0]?.message ?? "invalid"})`,
        { retryable: false },
      );
    }
    const { chapterId } = parsed.data;
    const bookRows = await getBook(db, job.userId, job.bookId);
    if (bookRows.length === 0) {
      throw new HandlerError("chapter.generate: book not found for principal", {
        retryable: false,
      });
    }
    const chapterRows = await getChapter(db, job.userId, job.bookId, chapterId);
    const chapter = chapterRows[0];
    if (!chapter) {
      throw new HandlerError("chapter.generate: chapter not found for principal", {
        retryable: false,
      });
    }

    const targetWords = parsed.data.targetWords ?? 1_200;
    const brief = parsed.data.brief?.trim() || chapter.title;
    let markdown: string | null = null;
    let source: "model" | "planner" = "planner";
    let fallbackDetail: string | undefined;
    let usage: TokenUsage | undefined;

    if (options.llm) {
      try {
        const prompt = [
          SYSTEM_PROMPT,
          `Book: ${bookRows[0]!.title} (${bookRows[0]!.genre})`,
          `Chapter: ${chapter.title}`,
          `Scene brief: ${brief}`,
          `Target length: ~${targetWords} words.`,
        ].join("\n");
        const completion = await options.llm.complete(prompt, {
          temperature: 0.8,
          maxTokens: 3_000,
        });
        markdown = sanitizeModelMarkdown(completion.text);
        if (markdown !== null) {
          source = "model";
          usage = completion.usage;
        }
      } catch (error) {
        fallbackDetail = error instanceof Error ? error.message : String(error);
      }
    }

    if (markdown === null) {
      const draft = composeDraft({
        title: chapter.title,
        brief,
        targetWords,
        seed: seedFor(chapterId),
      });
      markdown = draft.markdown;
      source = "planner";
    }

    const updated = await updateChapter(
      db,
      job.userId,
      job.bookId,
      chapterId,
      {
        markdown,
        wordCount: countWords(markdown),
        status: "draft",
      },
      { origin: "worker" },
    );
    if (!updated) {
      throw new HandlerError("chapter.generate: chapter vanished mid-run", { retryable: false });
    }
    logger.info(
      { jobId: job.id, chapterId, source, words: updated.wordCount },
      "chapter.generate: draft saved",
    );
    return {
      chapterId,
      bookId: job.bookId,
      source,
      words: updated.wordCount,
      ...(options.llm !== undefined ? { provider: options.llm.provider } : {}),
      ...(usage !== undefined ? { usage } : {}),
      ...(usage !== undefined && options.llm !== undefined
        ? { costMicros: estimateCostMicros(options.llm.provider, usage) }
        : {}),
      ...(fallbackDetail !== undefined ? { fallbackDetail } : {}),
    };
  };
}

/** Exported for tests that need the exact seed derivation. */
export function chapterSeed(job: Pick<JobRow, "id">): number {
  return seedFor(job.id);
}
