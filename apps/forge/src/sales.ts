/**
 * @inkforge/forge — sales routes (G-22).
 *
 * Ingest channel sales (upsert per channel+period), read the deterministic
 * summary, and — the point of the loop — refresh the G-21 market gate with a
 * demand signal derived from actual sales (source: "sales-ingest").
 */
import { Router, type Request, type Response } from "express";
import {
  MARKET_GATE_EXTRA_KEY,
  deriveDemandSignal,
  evaluateMarketGate,
  marketSnapshotSchema,
  salesRecordSchema,
  summarizeSales,
} from "@inkforge/core";
import { getBook, listSalesRecords, saveSalesRecords, updateBook } from "@inkforge/db";
import { z } from "zod";
import { bridgeUser } from "./auth";
import { isBookId, type LibraryRouterOptions } from "./library";
import { readStoredGate } from "./market";

const ingestSchema = z.object({ records: z.array(salesRecordSchema).min(1).max(500) });

export function createSalesRouter(options: LibraryRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const { db } = options;

  const requireBook = async (req: Request, res: Response): Promise<string | undefined> => {
    const bookId = String(req.params.bookId);
    if (!isBookId(bookId)) {
      res.status(400).json({ error: "invalid_book_id" });
      return undefined;
    }
    const book = (await getBook(db, bridgeUser(req), bookId))[0];
    if (!book) {
      res.status(404).json({ error: "book_not_found" });
      return undefined;
    }
    return bookId;
  };

  router.post("/", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const parsed = ingestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_sales_ingest", issues: parsed.error.issues });
      return;
    }
    const saved = await saveSalesRecords(
      db,
      bridgeUser(req),
      bookId,
      parsed.data.records.map((record) => ({
        channel: record.channel,
        units: record.units,
        revenueMicros: record.revenueMicros,
        royaltyMicros: record.royaltyMicros,
        currency: record.currency,
        periodStart: new Date(record.periodStart),
        periodEnd: new Date(record.periodEnd),
      })),
    );
    res.status(201).json({ ingested: saved.length });
  });

  router.get("/summary", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const rows = await listSalesRecords(db, bridgeUser(req), bookId);
    const summary = summarizeSales(
      rows.map((row) => ({
        channel: row.channel,
        units: row.units,
        revenueMicros: row.revenueMicros,
        royaltyMicros: row.royaltyMicros,
        currency: row.currency,
        periodStart: row.periodStart.toISOString(),
        periodEnd: row.periodEnd.toISOString(),
      })),
      {
        ...(typeof req.query.from === "string" ? { from: req.query.from } : {}),
        ...(typeof req.query.to === "string" ? { to: req.query.to } : {}),
      },
    );
    res.status(200).json({ summary, signal: deriveDemandSignal(summary) });
  });

  /** The M9 -> M1 loop: sales move the pre-gen gate. */
  router.post("/refresh-gate", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const user = bridgeUser(req);
    const book = (await getBook(db, user, bookId))[0];
    if (!book) {
      res.status(404).json({ error: "book_not_found" });
      return;
    }
    const rows = await listSalesRecords(db, user, bookId);
    if (rows.length === 0) {
      res.status(409).json({ error: "no_sales_ingested" });
      return;
    }
    const summary = summarizeSales(
      rows.map((row) => ({
        channel: row.channel,
        units: row.units,
        revenueMicros: row.revenueMicros,
        royaltyMicros: row.royaltyMicros,
        currency: row.currency,
        periodStart: row.periodStart.toISOString(),
        periodEnd: row.periodEnd.toISOString(),
      })),
    );
    const signal = deriveDemandSignal(summary);
    // Keep the prior snapshot's context (niche/competition/price/trend) and
    // swap in the demand observed from sales — sales are the new evidence.
    const extra = typeof book.extra === "object" && book.extra !== null ? book.extra : {};
    const stored = readStoredGate(extra);
    const prior = (extra as Record<string, unknown>)[MARKET_GATE_EXTRA_KEY];
    const priorSnapshot =
      stored && typeof prior === "object" && prior !== null
        ? marketSnapshotSchema.safeParse((prior as Record<string, unknown>).snapshot)
        : undefined;

    const gate = evaluateMarketGate({
      niche: priorSnapshot?.success
        ? priorSnapshot.data.niche
        : `${book.genre} — ${book.title}`.slice(0, 120),
      demandScore: signal.demandScore,
      competitionScore: priorSnapshot?.success ? priorSnapshot.data.competitionScore : 50,
      pricePower: priorSnapshot?.success ? priorSnapshot.data.pricePower : 50,
      trendScore: priorSnapshot?.success ? priorSnapshot.data.trendScore : 50,
      sampleSize: signal.sampleSize,
      source: "sales-ingest",
      capturedAt: new Date().toISOString(),
    });
    await updateBook(db, user, bookId, { extra: { [MARKET_GATE_EXTRA_KEY]: gate } });
    res.status(200).json({ gate, signal });
  });

  return router;
}
