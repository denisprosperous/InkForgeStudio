/**
 * @inkforge/forge — reader simulation panel routes (G-25).
 *
 * POST runs the deterministic panel (or caller-supplied personas) over the
 * stored manuscript and returns per-chapter engagement, drop-off points and
 * consensus weak chapters. LLM judging is deliberately not part of v1.
 */
import { Router, type Request, type Response } from "express";
import { readerPersonaSchema, simulatePanel } from "@inkforge/core";
import { listChapters } from "@inkforge/db";
import { z } from "zod";
import { bridgeUser } from "./auth";
import { isBookId, type LibraryRouterOptions } from "./library";

const panelRequestSchema = z.object({
  personas: z.array(readerPersonaSchema).min(1).max(12).optional(),
});

export function createPanelRouter(options: LibraryRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const { db } = options;

  router.post("/reader-panel", async (req: Request, res: Response) => {
    const bookId = String(req.params.bookId);
    if (!isBookId(bookId)) {
      res.status(400).json({ error: "invalid_book_id" });
      return;
    }
    const parsed = panelRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_panel_request", issues: parsed.error.issues });
      return;
    }
    const user = bridgeUser(req);
    const chapters = await listChapters(db, user, bookId);
    const report = simulatePanel(
      chapters
        .sort((a, b) => a.idx - b.idx)
        .map((chapter) => ({
          idx: chapter.idx,
          title: chapter.title,
          markdown: chapter.markdown,
        })),
      parsed.data.personas,
    );
    res.status(200).json({ report });
  });

  return router;
}
