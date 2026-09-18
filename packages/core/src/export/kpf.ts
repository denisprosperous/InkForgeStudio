/**
 * @inkforge/core/export/kpf — Kindle Create container (G-11, additive).
 *
 * Amazon does not publish the KPF (Kindle Create project) schema, so this
 * builder produces a *container* rather than claiming byte-compatibility: a
 * ZIP holding the reflowable XHTML, the stylesheet, the metadata manifest and
 * unique identifiers. Kindle Create imports the XHTML; the portability bundle
 * (G-24) ships the same tree. The manifest names the schema so nothing
 * downstream assumes Amazon's.
 */
import { slugify } from "../book/index";
import { EPUB_CSS, markdownToXhtml } from "../formatting/index";
import { planDisclosure, type DisclosureOptions } from "./disclosure";
import { createZip, type ZipEntry } from "./zip";
import { manuscriptWords, type AdapterRequest, type AdapterResult } from "./adapters";


// ── KPF container ───────────────────────────────────────────────────────

/**
 * Amazon does not publish the KPF (Kindle Create project) schema, so this
 * builder produces a *container* rather than claiming byte-compatibility:
 * a ZIP holding the reflowable XHTML, the stylesheet, the metadata manifest
 * and unique identifiers. Kindle Create imports the XHTML; the portability
 * bundle (G-24) ships the same tree. Marked SPECULATIVE by design — the
 * manifest names the schema so nothing downstream assumes Amazon's.
 */
export const KPF_SCHEMA = "inkforge-kpf-container/1";

export function buildKpf(
  request: AdapterRequest,
  options: DisclosureOptions = {},
): AdapterResult {
  if (request.chapters.length === 0) {
    throw new Error("Cannot build a KPF container with zero chapters");
  }
  const plan = planDisclosure({ meta: request.meta, chapters: request.chapters }, options);
  const slug = `${slugify(request.meta.title, 8)}-${slugify(request.meta.author, 3)}`;
  const content = request.chapters.map((chapter, index) => ({
    id: `chapter-${String(index + 1).padStart(4, "0")}`,
    idx: chapter.idx,
    title: chapter.title,
    file: `content/chapter-${String(index + 1).padStart(4, "0")}.xhtml`,
    xhtml: markdownToXhtml(chapter.markdown),
  }));
  const manifest = {
    schema: KPF_SCHEMA,
    note: "Amazon does not publish the KPF schema; this container carries the reflowable content and metadata for Kindle Create workflows.",
    title: request.meta.title,
    ...(request.meta.subtitle !== undefined ? { subtitle: request.meta.subtitle } : {}),
    author: request.meta.author,
    language: request.meta.language,
    genre: request.meta.genre,
    keywords: request.meta.keywords,
    description: plan.meta.description,
    aiDisclosure: plan.disclosureText !== null,
    ...(plan.disclosureText !== null ? { disclosureText: plan.disclosureText } : {}),
    chapters: content.map(({ xhtml, ...rest }) => ({ ...rest, bytes: Buffer.byteLength(xhtml) })),
    // No generatedAt here on purpose: the container must stay byte-deterministic
    // (the AdapterManifest returned to the caller carries the timestamp).
  };
  const entries: ZipEntry[] = [
    { path: "manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: "content/style.css", data: EPUB_CSS },
    ...content.map((entry, index) => ({
      path: `content/chapter-${String(index + 1).padStart(4, "0")}.xhtml`,
      data: entry.xhtml,
    })),
    {
      path: "metadata/book.json",
      data: `${JSON.stringify(
        {
          title: plan.meta.title,
          author: plan.meta.author,
          language: plan.meta.language,
          genre: plan.meta.genre,
          keywords: plan.meta.keywords,
          publisher: plan.meta.author,
        },
        null,
        2,
      )}\n`,
    },
  ];
  const buffer = createZip(entries);
  const filename = `${slug}.kpf`;
  return {
    buffer,
    filename,
    mimeType: "application/x-kpf",
    manifest: {
      format: "kpf",
      filename,
      title: request.meta.title,
      author: request.meta.author,
      chapters: request.chapters.length,
      words: manuscriptWords(request.chapters),
      bytes: buffer.byteLength,
      aiDisclosure: plan.disclosureText !== null,
      generatedAt: new Date().toISOString(),
      detail: { schema: KPF_SCHEMA, entries: entries.map((entry) => entry.path) },
    },
  };
}

