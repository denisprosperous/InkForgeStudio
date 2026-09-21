/**
 * @inkforge/forge — series bible route (G-26).
 *
 * GET /books/:bookId/series-bible merges every book the tenant owns under the
 * same seriesLabel into a franchise bible (shared entities, ordered timeline,
 * open threads, cross-book continuity conflicts). Books without a series
 * label get a 400 — a one-book series is a book, not a franchise.
 */
import { Router, type Request, type Response } from "express";
import { buildSeriesBible, type SeriesBookInput } from "@inkforge/core";
import { getBook, listBooksBySeries, listConsistencyFacts } from "@inkforge/db";
import { bridgeUser } from "./auth";
import { isBookId, type LibraryRouterOptions } from "./library";

export function createSeriesRouter(options: LibraryRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const { db } = options;

  router.get("/", async (req: Request, res: Response) => {
    const bookId = String(req.params.bookId);
    if (!isBookId(bookId)) {
      res.status(400).json({ error: "invalid_book_id" });
      return;
    }
    const user = bridgeUser(req);
    const book = (await getBook(db, user, bookId))[0];
    if (!book) {
      res.status(404).json({ error: "book_not_found" });
      return;
    }
    if (!book.seriesLabel || book.seriesLabel.trim().length === 0) {
      res.status(400).json({ error: "no_series_label" });
      return;
    }
    const seriesBooks = await listBooksBySeries(db, user, book.seriesLabel);
    const inputs: SeriesBookInput[] = [];
    for (const sibling of seriesBooks) {
      const facts = await listConsistencyFacts(db, user, sibling.id);
      inputs.push({
        bookId: sibling.id,
        title: sibling.title,
        seriesLabel: sibling.seriesLabel ?? book.seriesLabel,
        facts: facts.map((fact) => ({
          kind: fact.kind,
          name: fact.name,
          aliases: Array.isArray(fact.aliases) ? fact.aliases.map(String) : [],
          summary: fact.summary,
          firstChapter: fact.firstChapter,
          lastChapter: fact.lastChapter,
        })),
      });
    }
    res
      .status(200)
      .json({ bible: buildSeriesBible({ seriesLabel: book.seriesLabel, books: inputs }) });
  });

  return router;
}
