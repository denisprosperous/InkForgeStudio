/**
 * @inkforge/forge — `chapter.humanize` handler (G-17).
 *
 * The humanize button in the studio enqueues this job. The deterministic rule
 * engine (@inkforge/core humanizeMarkdown) always runs — local rewrites only,
 * never a hallucination. The chapter is updated in place with status
 * "humanized", a humanize_runs audit row records the scores, and the job
 * result carries {before, after} so the UI can render the approve/reject diff
 * (reject = restore `before`).
 */
import { humanizeMarkdown, humanizeWithLlm, scoreText, type HumanizeOptions } from "@inkforge/core";
import type { LlmClient } from "@inkforge/ai";
import { getChapter, recordHumanizeRun, updateChapter } from "@inkforge/db";
import { z } from "zod";
import { HandlerError, type JobContext } from "../registry";

const humanizeRequestSchema = z.object({
  chapterId: z.string().uuid(),
  passes: z.number().int().min(1).max(3).optional(),
  seed: z.number().int().optional(),
});

export interface HumanizeHandlerOptions {
  /** Optional model polish (core guards it: a failed polish keeps the rules). */
  readonly llm?: LlmClient | undefined;
}

export function createHumanizeHandler(options: HumanizeHandlerOptions = {}) {
  return async function handleChapterHumanize(ctx: JobContext): Promise<unknown> {
    const { job, db, logger } = ctx;
    if (job.bookId === null) {
      throw new HandlerError("chapter.humanize: job has no bookId", { retryable: false });
    }
    const parsed = humanizeRequestSchema.safeParse(job.payload ?? {});
    if (!parsed.success) {
      throw new HandlerError(
        `chapter.humanize: invalid payload (${parsed.error.issues[0]?.message ?? "invalid"})`,
        { retryable: false },
      );
    }
    const { chapterId } = parsed.data;
    const chapterRows = await getChapter(db, job.userId, job.bookId, chapterId);
    const chapter = chapterRows[0];
    if (!chapter) {
      throw new HandlerError("chapter.humanize: chapter not found for principal", {
        retryable: false,
      });
    }
    if (chapter.markdown.trim() === "") {
      throw new HandlerError("chapter.humanize: nothing to humanize (empty draft)", {
        retryable: false,
      });
    }

    const opts: HumanizeOptions = {
      ...(parsed.data.passes !== undefined ? { passes: parsed.data.passes } : {}),
      ...(parsed.data.seed !== undefined ? { seed: parsed.data.seed } : {}),
    };
    const before = chapter.markdown;
    const run = options.llm
      ? await humanizeWithLlm(
          before,
          { complete: (prompt) => options.llm!.complete(prompt).then((r) => r.text) },
          opts,
        )
      : humanizeMarkdown(before, opts);

    const updated = await updateChapter(db, job.userId, job.bookId, chapterId, {
      markdown: run.markdown,
      status: "humanized",
      wordCount: run.markdown.split(/\s+/u).filter(Boolean).length,
    });
    if (!updated) {
      throw new HandlerError("chapter.humanize: chapter vanished mid-run", { retryable: false });
    }
    await recordHumanizeRun(db, job.userId, {
      bookId: job.bookId,
      chapterId,
      seed: run.seed,
      passes: run.passes,
      llmRewrites: run.llmRewrites,
      changedSentences: run.changedSentences,
      scoreBefore: run.scoreBefore,
      scoreAfter: run.scoreAfter,
    });
    logger.info(
      {
        jobId: job.id,
        chapterId,
        changed: run.changedSentences,
        ease: `${scoreText(before).fleschEase.toFixed(1)} -> ${run.scoreAfter.fleschEase.toFixed(1)}`,
      },
      "chapter.humanize: rewrite saved",
    );
    return {
      chapterId,
      bookId: job.bookId,
      before,
      after: run.markdown,
      changedSentences: run.changedSentences,
      passes: run.passes,
      llmRewrites: run.llmRewrites,
      seed: run.seed,
      scoreBefore: run.scoreBefore,
      scoreAfter: run.scoreAfter,
    };
  };
}
