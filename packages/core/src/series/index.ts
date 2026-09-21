/**
 * G-26 — series bible / franchise architecture (C3).
 *
 * Deterministic merge of per-book consistency ledgers (G-15) into
 * franchise-level knowledge: entities shared across books, an ordered
 * timeline, single-book threads worth paying off later, and continuity
 * conflicts where the same canonical entity carries different summaries.
 */
import type { ConsistencyFactLike } from "../consistency/index";

export interface SeriesBookInput {
  readonly bookId: string;
  readonly title: string;
  readonly seriesLabel: string;
  readonly facts: readonly ConsistencyFactLike[];
}

export interface SeriesAppearance {
  readonly bookId: string;
  readonly title: string;
  readonly firstChapter: number;
  readonly lastChapter: number;
}

export interface SeriesEntity {
  readonly name: string;
  readonly appearances: readonly SeriesAppearance[];
}

export interface SeriesTimelineEntry {
  readonly bookId: string;
  readonly title: string;
  readonly idx: number;
  readonly name: string;
}

export interface SeriesConflict {
  readonly name: string;
  readonly summaries: readonly string[];
  readonly books: readonly string[];
}

export interface SeriesBible {
  readonly seriesLabel: string;
  readonly sharedEntities: readonly SeriesEntity[];
  readonly timeline: readonly SeriesTimelineEntry[];
  /** Entities known in exactly one book — hooks for future volumes. */
  readonly openThreads: readonly SeriesEntity[];
  readonly conflicts: readonly SeriesConflict[];
  readonly stats: {
    readonly books: number;
    readonly entities: number;
    readonly sharedEntities: number;
  };
}

function canonical(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Build the franchise bible. Books are processed in the given order (callers
 * pass publication order); every collection is deterministically ordered.
 */
export function buildSeriesBible(input: {
  readonly seriesLabel: string;
  readonly books: readonly SeriesBookInput[];
}): SeriesBible {
  interface Aggregate {
    display: string;
    appearances: SeriesAppearance[];
    summaries: Map<string, Set<string>>;
  }
  const byEntity = new Map<string, Aggregate>();
  const timeline: SeriesTimelineEntry[] = [];

  for (const book of input.books) {
    for (const fact of book.facts) {
      const key = canonical(fact.name);
      if (key.length === 0) continue;
      const aggregate: Aggregate = byEntity.get(key) ?? {
        display: fact.name,
        appearances: [],
        summaries: new Map<string, Set<string>>(),
      };
      aggregate.appearances.push({
        bookId: book.bookId,
        title: book.title,
        firstChapter: fact.firstChapter,
        lastChapter: fact.lastChapter,
      });
      if (fact.summary.trim().length > 0) {
        const holder = aggregate.summaries.get(book.title) ?? new Set<string>();
        holder.add(fact.summary);
        aggregate.summaries.set(book.title, holder);
      }
      byEntity.set(key, aggregate);
      timeline.push({
        bookId: book.bookId,
        title: book.title,
        idx: fact.firstChapter,
        name: fact.name,
      });
    }
  }

  const sharedEntities: SeriesEntity[] = [];
  const openThreads: SeriesEntity[] = [];
  const conflicts: SeriesConflict[] = [];
  for (const aggregate of [...byEntity.values()].sort((a, b) =>
    a.display.localeCompare(b.display),
  )) {
    const distinctBooks = [...new Set(aggregate.appearances.map((entry) => entry.bookId))];
    const entity: SeriesEntity = {
      name: aggregate.display,
      appearances: [...aggregate.appearances].sort((a, b) => a.title.localeCompare(b.title)),
    };
    if (distinctBooks.length > 1) sharedEntities.push(entity);
    else openThreads.push(entity);

    const distinctSummaries = [...aggregate.summaries.values()]
      .map((set) => [...set])
      .flat()
      .filter((summary, index, all) => all.indexOf(summary) === index);
    if (distinctSummaries.length > 1) {
      conflicts.push({
        name: aggregate.display,
        summaries: distinctSummaries,
        books: [...aggregate.summaries.keys()],
      });
    }
  }

  return {
    seriesLabel: input.seriesLabel,
    sharedEntities,
    timeline: timeline.sort(
      (a, b) => a.title.localeCompare(b.title) || a.idx - b.idx || a.name.localeCompare(b.name),
    ),
    openThreads,
    conflicts,
    stats: {
      books: input.books.length,
      entities: byEntity.size,
      sharedEntities: sharedEntities.length,
    },
  };
}
