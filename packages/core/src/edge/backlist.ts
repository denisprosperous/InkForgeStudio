/**
 * G-30b — backlist resurrection (C6): deterministic dormancy assessment and
 * a revival plan derived strictly from the book's own signals.
 *
 * Anti-fabrication: no market claims, no projected revenue. Every planned
 * action carries the observation that triggered it.
 */

export interface BacklistItem {
  readonly bookId: string;
  readonly title: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly chapters: number;
  readonly words: number;
  readonly hasCover: boolean;
  readonly keywords: readonly string[];
  readonly seriesLabel: string;
  readonly lastSaleAt?: string;
}

export type BacklistBucket = "active" | "dormant" | "neglected";

export interface AssessedItem extends BacklistItem {
  readonly bucket: BacklistBucket;
  readonly daysDormant: number;
}

export interface BacklistReport {
  readonly items: readonly AssessedItem[];
  readonly stats: { readonly active: number; readonly dormant: number; readonly neglected: number };
}

const DAY_MS = 86_400_000;

function daysBetween(fromIso: string, nowIso: string): number {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(from) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.floor((now - from) / DAY_MS));
}

/**
 * Bucket every book: `neglected` (never sold and older than the window),
 * `dormant` (sold before, quiet longer than the window) or `active`.
 * Ordered by days dormant descending, then title — the biggest opportunity
 * first, deterministically.
 */
export function assessBacklist(
  items: readonly BacklistItem[],
  options: { readonly now: string; readonly dormantDays?: number },
): BacklistReport {
  const dormantDays = options.dormantDays ?? 180;
  const assessed: AssessedItem[] = items.map((item) => {
    const reference = item.lastSaleAt ?? item.updatedAt;
    const daysDormant = daysBetween(reference, options.now);
    let bucket: BacklistBucket;
    if (item.lastSaleAt === undefined) {
      bucket = daysDormant >= dormantDays ? "neglected" : "active";
    } else {
      bucket = daysDormant >= dormantDays ? "dormant" : "active";
    }
    return { ...item, bucket, daysDormant };
  });
  assessed.sort(
    (a, b) =>
      Number(b.bucket !== "active") - Number(a.bucket !== "active") ||
      b.daysDormant - a.daysDormant ||
      a.title.localeCompare(b.title),
  );
  return {
    items: assessed,
    stats: {
      active: assessed.filter((item) => item.bucket === "active").length,
      dormant: assessed.filter((item) => item.bucket === "dormant").length,
      neglected: assessed.filter((item) => item.bucket === "neglected").length,
    },
  };
}

export interface RevivalAction {
  readonly action: string;
  readonly priority: number;
  readonly reason: string;
}

export interface RevivalPlan {
  readonly bookId: string;
  readonly actions: readonly RevivalAction[];
}

/** Keywords below this count starve discovery metadata. */
const MIN_KEYWORDS = 5;
/** Audiobooks need enough words to be worth the production run. */
const AUDIOBOOK_MIN_WORDS = 40_000;
/** A price review is due after this long without a sale. */
const PRICE_REVIEW_DAYS = 180;

/**
 * Deterministic revival checklist. Each action exists only when its signal
 * is present, and every action states the observation behind it.
 */
export function buildRevivalPlan(
  item: BacklistItem,
  options: { readonly now?: string } = {},
): RevivalPlan {
  const now = options.now ?? new Date(0).toISOString();
  const actions: RevivalAction[] = [];
  if (!item.hasCover) {
    actions.push({
      action: "new-cover",
      priority: 1,
      reason: "no cover stored — a cover is required for every retailer slot",
    });
  }
  if (item.keywords.length < MIN_KEYWORDS) {
    actions.push({
      action: "expand-keywords",
      priority: 2,
      reason: `only ${item.keywords.length} keywords (minimum useful set is ${MIN_KEYWORDS})`,
    });
  }
  if (item.seriesLabel.trim().length === 0) {
    actions.push({
      action: "series-link",
      priority: 3,
      reason: "no series label — linking siblings lifts discovery on retailers",
    });
  }
  if (
    item.lastSaleAt === undefined ||
    daysBetween(item.lastSaleAt, now) >= PRICE_REVIEW_DAYS
  ) {
    actions.push({
      action: "price-review",
      priority: 4,
      reason:
        item.lastSaleAt === undefined
          ? "no sales recorded — review listing price against current metadata"
          : `last sale ${daysBetween(item.lastSaleAt, now)} days ago (>= ${PRICE_REVIEW_DAYS})`,
    });
  }
  if (item.words >= AUDIOBOOK_MIN_WORDS) {
    actions.push({
      action: "audiobook-candidate",
      priority: 5,
      reason: `${item.words} words clears the ${AUDIOBOOK_MIN_WORDS}-word audio threshold`,
    });
  }
  return { bookId: item.bookId, actions };
}
