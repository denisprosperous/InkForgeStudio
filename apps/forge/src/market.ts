/**
 * @inkforge/forge — market gate routes (G-21): the pre-gen go/no-go gate.
 *
 * POST evaluates a snapshot deterministically (core engine) and stores the
 * verdict under meta.extra.marketGate (G-13 namespacing, repo-level merge);
 * GET returns the stored verdict. The jobs router refuses generation jobs
 * for books whose verdict is no-go — that is the "before spend" guarantee.
 */
import { Router, type Request, type Response } from "express";
import { MARKET_GATE_EXTRA_KEY, evaluateMarketGate, marketSnapshotSchema } from "@inkforge/core";
import { getBook, updateBook } from "@inkforge/db";
import { bridgeUser } from "./auth";
import { isBookId, type LibraryRouterOptions } from "./library";

/** Shape of the stored verdict (subset used by the jobs gate). */
export interface StoredMarketGate {
  readonly verdict: string;
  readonly reasons: readonly string[];
}

export function readStoredGate(extra: unknown): StoredMarketGate | undefined {
  if (typeof extra !== "object" || extra === null) return undefined;
  const gate = (extra as Record<string, unknown>)[MARKET_GATE_EXTRA_KEY];
  if (typeof gate !== "object" || gate === null) return undefined;
  const record = gate as Record<string, unknown>;
  if (typeof record.verdict !== "string") return undefined;
  return {
    verdict: record.verdict,
    reasons: Array.isArray(record.reasons) ? record.reasons.map(String) : [],
  };
}

export function createMarketRouter(options: LibraryRouterOptions): Router {
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

  router.post("/gate", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const user = bridgeUser(req);
    const book = (await getBook(db, user, bookId))[0];
    if (!book) {
      res.status(404).json({ error: "book_not_found" });
      return;
    }
    const parsed = marketSnapshotSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_market_snapshot", issues: parsed.error.issues });
      return;
    }
    const gate = evaluateMarketGate(parsed.data);
    const updated = await updateBook(db, user, bookId, {
      extra: { [MARKET_GATE_EXTRA_KEY]: gate },
    });
    res.status(200).json({ gate: updated ? gate : gate });
  });

  router.get("/gate", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const book = (await getBook(db, bridgeUser(req), bookId))[0];
    if (!book) {
      res.status(404).json({ error: "book_not_found" });
      return;
    }
    // Return the full stored verdict (snapshot, composite, reasons) — the
    // narrow readStoredGate helper stays internal to the jobs gate.
    const stored =
      typeof book.extra === "object" && book.extra !== null
        ? (book.extra as Record<string, unknown>)[MARKET_GATE_EXTRA_KEY]
        : undefined;
    res.status(200).json({ gate: stored ?? null });
  });

  return router;
}
