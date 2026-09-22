/**
 * @inkforge/forge — edge playbook route (G-30i).
 *
 * One authenticated endpoint exposes the deterministic edge calculators
 * (cover A/B, backlist, bundles, D2C, marketplace, white-label,
 * localization, arbitrage). Book context (meta + chapters) is loaded from the
 * owned book; everything else comes from the validated request payload, so no
 * calculator can invent data it was not given.
 */
import { Router, type Request, type Response } from "express";
import {
  applyBrandKit,
  assessBacklist,
  assignCoverVariant,
  buildDirectProductPage,
  buildLocalizationPackage,
  buildMarketplaceListing,
  buildRevivalPlan,
  findPriceArbitrage,
  pickCoverWinner,
  priceBundle,
  productMetadataSchema,
  recommendBundleDiscount,
  type BookMeta,
  type CoverSample,
  type CoverVariant,
  type MarketplaceTarget,
  type MarketPricePoint,
} from "@inkforge/core";
import { getBook, listChapters } from "@inkforge/db";
import { z } from "zod";
import { bridgeUser } from "./auth";
import { isBookId, type LibraryRouterOptions } from "./library";

const EDGE_ACTIONS = [
  "cover-variant",
  "cover-winner",
  "backlist-report",
  "backlist-plan",
  "bundle-price",
  "bundle-discount",
  "d2c-page",
  "marketplace-listing",
  "brand-kit",
  "localization-package",
  "price-arbitrage",
] as const;

const payloadSchema = z.object({ action: z.string().min(1).max(40) }).passthrough();

export function createEdgeRouter(options: LibraryRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const { db } = options;

  router.post("/playbook", async (req: Request, res: Response) => {
    const bookId = String(req.params.bookId);
    if (!isBookId(bookId)) {
      res.status(400).json({ error: "invalid_book_id" });
      return;
    }
    const parsed = payloadSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_playbook_request", issues: parsed.error.issues });
      return;
    }
    const action = parsed.data.action;
    if (!(EDGE_ACTIONS as readonly string[]).includes(action)) {
      res.status(400).json({ error: "unknown_action", known: EDGE_ACTIONS });
      return;
    }
    const user = bridgeUser(req);
    const book = (await getBook(db, user, bookId))[0];
    if (!book) {
      res.status(404).json({ error: "book_not_found" });
      return;
    }
    const chapters = await listChapters(db, user, bookId);
    const body = parsed.data as Record<string, unknown>;
    const meta: BookMeta = {
      title: book.title,
      subtitle: book.subtitle ?? undefined,
      author: book.author,
      description: book.description,
      genre: book.genre,
      keywords: Array.isArray(book.keywords) ? book.keywords.map(String) : [],
      language: book.language,
      seriesLabel: book.seriesLabel ?? undefined,
      publishTarget: "kdp",
      extra: {},
    };
    const chapterInputs = chapters
      .sort((a, b) => a.idx - b.idx)
      .map((chapter) => ({ title: chapter.title, markdown: chapter.markdown }));
    const words = chapterInputs.reduce(
      (total, chapter) => total + chapter.markdown.split(/\s+/).filter(Boolean).length,
      0,
    );
    const bookContext = {
      bookId,
      title: book.title,
      status: book.status,
      updatedAt: book.updatedAt.toISOString(),
      chapters: chapters.length,
      words,
      keywords: meta.keywords,
      seriesLabel: book.seriesLabel ?? "",
    };

    try {
      const result = runAction(action, body, meta, chapterInputs, bookContext);
      res.status(200).json({ action, result });
    } catch (error) {
      res.status(400).json({
        error: "invalid_playbook_payload",
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  });

  return router;
}

interface PlaybookBookContext {
  readonly bookId: string;
  readonly title: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly chapters: number;
  readonly words: number;
  readonly keywords: readonly string[];
  readonly seriesLabel: string;
}

/** Dispatch one validated action onto its deterministic calculator. */
function runAction(
  action: string,
  body: Record<string, unknown>,
  meta: BookMeta,
  chapters: readonly { readonly title: string; readonly markdown: string }[],
  book: PlaybookBookContext,
): unknown {
  switch (action) {
    case "cover-variant": {
      const variants = z
        .array(z.object({ variant: z.string().min(1), label: z.string().min(1) }))
        .min(1)
        .max(8)
        .parse(body.variants);
      return assignCoverVariant({ bookId: book.bookId, variants: variants as CoverVariant[] });
    }
    case "cover-winner": {
      const samples = z
        .array(
          z.object({
            variant: z.string().min(1),
            impressions: z.number().int().min(0),
            clicks: z.number().int().min(0),
          }),
        )
        .parse(body.samples);
      return pickCoverWinner(samples as CoverSample[], {
        minImpressions: Number(body.minImpressions ?? 500),
      });
    }
    case "backlist-report": {
      return assessBacklist(
        [
          {
            ...book,
            hasCover: Boolean(body.hasCover),
            ...(typeof body.lastSaleAt === "string" ? { lastSaleAt: body.lastSaleAt } : {}),
          },
        ],
        { now: new Date().toISOString(), dormantDays: Number(body.dormantDays ?? 180) },
      );
    }
    case "backlist-plan": {
      return buildRevivalPlan({
        ...book,
        hasCover: Boolean(body.hasCover),
        ...(typeof body.lastSaleAt === "string" ? { lastSaleAt: body.lastSaleAt } : {}),
      });
    }
    case "bundle-price": {
      const members = z
        .array(z.object({ title: z.string().min(1), priceCents: z.number().int().min(0) }))
        .min(1)
        .parse(body.members);
      return priceBundle(members, { discountPercent: Number(body.discountPercent ?? 0) });
    }
    case "bundle-discount":
      return recommendBundleDiscount(Number(body.memberCount ?? 2));
    case "d2c-page": {
      const product = productMetadataSchema.parse(body.product ?? {});
      return buildDirectProductPage(meta, product, {
        checkoutUrl: String(body.checkoutUrl ?? ""),
        storeName: String(body.storeName ?? "Inkforge"),
      });
    }
    case "marketplace-listing": {
      const product = productMetadataSchema.parse(body.product ?? {});
      return buildMarketplaceListing(meta, product, String(body.target ?? "kdp") as MarketplaceTarget);
    }
    case "brand-kit":
      return applyBrandKit(meta, {
        imprint: String(body.imprint ?? ""),
        ...(typeof body.url === "string" ? { url: body.url } : {}),
        ...(typeof body.accentColor === "string" ? { accentColor: body.accentColor } : {}),
      });
    case "localization-package": {
      const target = z
        .object({
          language: z.string().length(2),
          territory: z.string().length(2),
          currency: z.string().length(3),
        })
        .parse(body.target);
      return buildLocalizationPackage(meta, chapters, target);
    }
    case "price-arbitrage": {
      const points = z
        .array(
          z.object({
            market: z.string().min(1),
            currency: z.string().length(3),
            priceCents: z.number().int().min(0),
            demandIndex: z.number().min(0).max(100),
          }),
        )
        .parse(body.points);
      return findPriceArbitrage(points as MarketPricePoint[], {
        minMarkets: Number(body.minMarkets ?? 3),
        gapPercent: Number(body.gapPercent ?? 20),
      });
    }
    default:
      throw new Error(`unknown action: ${action}`);
  }
}
