/**
 * @inkforge/forge — rights & corpus routes (G-09b).
 *
 * Rights: create/list records and revoke them (status flips, nothing is
 * deleted — licensing history is evidence). Corpus: ingest a source (chunked
 * deterministically) and search it with the core scorer.
 */
import { Router, type Request, type Response } from "express";
import { chunkText, corpusSearch, rightsRecordSchema } from "@inkforge/core";
import {
  getBook,
  listCorpusChunks,
  listRightsRecords,
  replaceCorpusSource,
  saveRightsRecord,
  setRightsStatus,
} from "@inkforge/db";
import { z } from "zod";
import { bridgeUser } from "./auth";
import { isBookId, type LibraryRouterOptions } from "./library";

const ingestBodySchema = z.object({
  source: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(2_000_000),
});

export function createRightsRouter(options: LibraryRouterOptions): Router {
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
    const parsed = rightsRecordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_rights_record", issues: parsed.error.issues });
      return;
    }
    const record = await saveRightsRecord(db, bridgeUser(req), bookId, {
      kind: parsed.data.kind,
      title: parsed.data.title,
      holder: parsed.data.holder,
      terms: parsed.data.terms,
      territory: parsed.data.territory,
      exclusive: parsed.data.exclusive,
      status: parsed.data.status,
      ...(parsed.data.startsAt !== undefined ? { startsAt: new Date(parsed.data.startsAt) } : {}),
      ...(parsed.data.expiresAt !== undefined
        ? { expiresAt: new Date(parsed.data.expiresAt) }
        : {}),
    });
    res.status(201).json({ record });
  });

  router.get("/", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const records = await listRightsRecords(db, bridgeUser(req), bookId);
    res.status(200).json({ records });
  });

  router.post("/:recordId/status", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const recordId = String(req.params.recordId);
    if (!isBookId(recordId)) {
      res.status(400).json({ error: "invalid_record_id" });
      return;
    }
    const parsed = z
      .object({ status: z.enum(["active", "expired", "revoked"]) })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_status", issues: parsed.error.issues });
      return;
    }
    const record = await setRightsStatus(db, bridgeUser(req), bookId, recordId, parsed.data.status);
    if (!record) {
      res.status(404).json({ error: "rights_record_not_found" });
      return;
    }
    res.status(200).json({ record });
  });

  router.post("/corpus", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const parsed = ingestBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_corpus_ingest", issues: parsed.error.issues });
      return;
    }
    const chunks = chunkText(parsed.data.text);
    const stored = await replaceCorpusSource(
      db,
      bridgeUser(req),
      bookId,
      parsed.data.source,
      chunks,
    );
    res.status(201).json({ source: parsed.data.source, chunks: stored.length });
  });

  router.get("/corpus/search", async (req: Request, res: Response) => {
    const bookId = await requireBook(req, res);
    if (bookId === undefined) return;
    const query = String(req.query.q ?? "");
    const limit = Number.parseInt(String(req.query.limit ?? "5"), 10);
    const rows = await listCorpusChunks(db, bridgeUser(req), bookId);
    const hits = corpusSearch(
      rows.map((row) => ({ idx: row.idx, source: row.source, text: row.text })),
      query,
      { limit: Number.isFinite(limit) ? limit : 5 },
    );
    res.status(200).json({ query, hits });
  });

  return router;
}
