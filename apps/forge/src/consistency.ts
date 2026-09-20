/**
 * @inkforge/forge — consistency routes (G-15): the per-book fact/entity
 * ledger and the deterministic post-generation validation report.
 *
 * PUT swaps the whole ledger atomically (client-side authority over the
 * memory); GET runs the core validator over the stored chapters + ledger and
 * returns the report without mutating anything.
 */
import { Router, type Request, type Response } from "express";
import { consistencyLedgerSchema, validateConsistency } from "@inkforge/core";
import { listChapters, listConsistencyFacts, replaceConsistencyFacts } from "@inkforge/db";
import { bridgeUser } from "./auth";
import { isBookId, type LibraryRouterOptions } from "./library";

export function createConsistencyRouter(options: LibraryRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const { db } = options;

  const requireBook = async (req: Request, res: Response): Promise<string | undefined> => {
    const bookId = String(req.params.bookId);
    if (!isBookId(bookId)) {
      res.status(400).json({ error: "invalid_book_id" });
      return undefined;
    }
    return bookId;
  };

  router.get("/", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const user = bridgeUser(req);
    const [chapters, facts] = await Promise.all([
      listChapters(db, user, bookId),
      listConsistencyFacts(db, user, bookId),
    ]);
    const report = validateConsistency(
      chapters,
      facts.map((fact) => ({
        kind: fact.kind,
        name: fact.name,
        aliases: Array.isArray(fact.aliases) ? fact.aliases.map(String) : [],
        summary: fact.summary,
        firstChapter: fact.firstChapter,
        lastChapter: fact.lastChapter,
      })),
    );
    res.status(200).json({ report });
  });

  router.put("/facts", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const parsed = consistencyLedgerSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_ledger", issues: parsed.error.issues });
      return;
    }
    const saved = await replaceConsistencyFacts(db, bridgeUser(req), bookId, parsed.data.facts);
    res.status(200).json({ facts: saved });
  });

  return router;
}
