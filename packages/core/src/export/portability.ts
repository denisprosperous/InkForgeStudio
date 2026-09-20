/**
 * G-24 — bulk portability export (B17): a single zip of everything the user
 * owns. No-lock-in promise, honored literally: books (meta + chapters as
 * markdown), outlines, covers, assets and the export manifest as JSON —
 * re-importable without the platform.
 *
 * Core stays storage-agnostic: the caller hands in plain rows/bytes, the
 * builder returns deterministic archive bytes (G-11 zip writer).
 */
import { createZip, type ZipEntry } from "./zip";
import { countWords } from "../book/index";

export interface PortabilityBook {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string | null;
  readonly author: string;
  readonly description: string;
  readonly genre: string;
  readonly keywords: readonly string[];
  readonly language: string;
  readonly seriesLabel?: string | null;
  readonly publishTarget: string;
  readonly status: string;
  readonly extra?: unknown;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface PortabilityChapter {
  readonly id: string;
  readonly bookId: string;
  readonly idx: number;
  readonly title: string;
  readonly markdown: string;
  readonly status: string;
  readonly wordCount?: number;
}

export interface PortabilityOutline {
  readonly bookId: string;
  readonly payload: unknown;
}

export interface PortabilityBlob {
  readonly bookId: string;
  readonly filename: string;
  readonly data: Buffer | Uint8Array;
}

export interface PortabilityInput {
  readonly user: string;
  readonly books: readonly PortabilityBook[];
  readonly chapters: readonly PortabilityChapter[];
  readonly outlines?: readonly PortabilityOutline[];
  readonly covers?: readonly PortabilityBlob[];
  readonly assets?: readonly PortabilityBlob[];
  /** ISO timestamp baked into the manifest (defaults: caller-supplied for determinism). */
  readonly exportedAt?: string;
}

export interface PortabilityManifest {
  readonly format: "inkforge-portability";
  readonly version: 1;
  readonly user: string;
  readonly exportedAt: string;
  readonly counts: {
    readonly books: number;
    readonly chapters: number;
    readonly outlines: number;
    readonly covers: number;
    readonly assets: number;
  };
  readonly words: number;
}

function slug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "book"
  );
}

function safeName(filename: string): string {
  return filename.replace(/[/\\]/g, "_");
}

/**
 * Build the deterministic portability zip. Entry order and JSON key order are
 * stable, so the same data always yields the same archive bytes.
 */
export function buildPortabilityBundle(input: PortabilityInput): {
  archive: Buffer;
  manifest: PortabilityManifest;
} {
  const exportedAt = input.exportedAt ?? new Date(0).toISOString();
  const entries: ZipEntry[] = [];

  const words = input.chapters.reduce(
    (total, chapter) => total + (chapter.wordCount ?? countWords(chapter.markdown)),
    0,
  );
  const manifest: PortabilityManifest = {
    format: "inkforge-portability",
    version: 1,
    user: input.user,
    exportedAt,
    counts: {
      books: input.books.length,
      chapters: input.chapters.length,
      outlines: input.outlines?.length ?? 0,
      covers: input.covers?.length ?? 0,
      assets: input.assets?.length ?? 0,
    },
    words,
  };

  entries.push({ path: "manifest.json", data: JSON.stringify(manifest, null, 2) });

  for (const book of input.books) {
    const dir = slug(book.title);
    const metaJson = {
      ...book,
      keywords: [...book.keywords],
      extra: book.extra ?? {},
    };
    entries.push({
      path: `books/${dir}/metadata.json`,
      data: JSON.stringify(metaJson, null, 2),
    });

    const chapters = input.chapters
      .filter((chapter) => chapter.bookId === book.id)
      .sort((a, b) => a.idx - b.idx);
    for (const chapter of chapters) {
      const frontMatter = [
        "---",
        `id: ${chapter.id}`,
        `idx: ${chapter.idx}`,
        `title: ${chapter.title}`,
        `status: ${chapter.status}`,
        "---",
        "",
      ].join("\n");
      entries.push({
        path: `books/${dir}/chapters/${String(chapter.idx).padStart(3, "0")}-${slug(chapter.title)}.md`,
        data: frontMatter + chapter.markdown,
      });
    }

    for (const outline of input.outlines ?? []) {
      if (outline.bookId !== book.id) continue;
      entries.push({
        path: `books/${dir}/outline.json`,
        data: JSON.stringify(outline.payload, null, 2),
      });
    }
    for (const cover of input.covers ?? []) {
      if (cover.bookId !== book.id) continue;
      entries.push({
        path: `books/${dir}/covers/${safeName(cover.filename)}`,
        data: Buffer.from(cover.data),
      });
    }
    for (const asset of input.assets ?? []) {
      if (asset.bookId !== book.id) continue;
      entries.push({
        path: `books/${dir}/assets/${safeName(asset.filename)}`,
        data: Buffer.from(asset.data),
      });
    }
  }

  return { archive: createZip(entries), manifest };
}
