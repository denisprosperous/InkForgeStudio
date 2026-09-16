/**
 * @inkforge/core/formatting — turn chapter markdown into print-grade EPUB XHTML.
 *
 * KDP's reflowable pipeline is picky: it wants clean semantic HTML, no inline
 * styles, no scripts, proper front matter and a Table of Contents that maps to
 * real headings. This module owns all of that so exports come out compliant
 * rather than "mostly fine".
 */
import MarkdownIt from "markdown-it";
import type { BookMeta, Chapter } from "../book/index";
import { slugify } from "../book/index";

export interface FormattingOptions {
  /** Rich print styling: drop caps, ornament scene breaks, small-caps titles. */
  readonly lavish?: boolean;
  readonly includeToc?: boolean;
  readonly includeCopyright?: boolean;
}

/** An EPUB content document ready to hand to the epub generator. */
export interface ContentDocument {
  readonly id: string;
  readonly title: string;
  readonly data: string;
  readonly url?: string;
}

/** The EPUB spec's built-in style support is thin; this sheet targets KDP. */
export const EPUB_CSS = `
body { font-family: Georgia, "Times New Roman", serif; line-height: 1.6; margin: 5% 6%; color: #111; }
h1.chapter-title { font-size: 1.7em; font-weight: bold; text-align: center; margin: 3em 0 2.5em 0; page-break-before: always; }
h1.chapter-title .chapter-number { display: block; font-size: 0.55em; letter-spacing: 0.35em; text-transform: uppercase; color: #555; margin-bottom: 0.8em; }
h2, h3 { font-weight: bold; page-break-after: avoid; }
p { margin: 0; text-indent: 1.4em; }
p.first, p.dropcap { text-indent: 0; }
p.dropcap::first-letter { font-size: 3.1em; float: left; line-height: 0.85; padding-right: 0.08em; font-weight: bold; }
hr.scene-break { border: none; text-align: center; margin: 1.4em auto; width: 40%; page-break-after: avoid; }
hr.scene-break::before { content: "❦"; font-size: 1.15em; color: #444; }
blockquote { margin: 1.2em 1.6em; font-style: italic; color: #333; }
.title-page { text-align: center; margin-top: 18%; page-break-after: always; }
.title-page .book-title { font-size: 2.2em; font-weight: bold; letter-spacing: 0.04em; }
.title-page .book-subtitle { font-size: 1.1em; font-style: italic; margin-top: 1em; color: #333; }
.title-page .book-author { font-size: 1.25em; margin-top: 3em; }
.title-page .book-series { margin-top: 1em; font-size: 0.9em; color: #555; }
.copyright-page { font-size: 0.85em; color: #333; margin-top: 40%; page-break-after: always; }
.toc-page { page-break-after: always; }
.toc-page ol { list-style: none; padding-left: 0; }
.toc-page li { margin-bottom: 0.6em; }
.back-matter { text-align: center; margin-top: 20%; }
`.trim();

function createMarkdownIt(): MarkdownIt {
  const md: MarkdownIt = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: true,
    breaks: false,
  });
  md.enable(["smartquotes", "replacements"]);
  return md;
}

const MD = createMarkdownIt();

/** Strip characters that are illegal or risky inside XML 1.0 documents. */
function xmlSafe(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "");
}

/** Convert chapter markdown to a styled XHTML fragment for EPUB. */
export function markdownToXhtml(markdown: string, options: FormattingOptions = {}): string {
  const lavish = options.lavish ?? true;
  const normalized = markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^(-{3,}|\*{3,}|_{3,})$/gm, "\n@@SCENE_BREAK@@\n");

  let html = MD.render(normalized);

  html = html.replace(/<p>@@SCENE_BREAK@@<\/p>/g, '<hr class="scene-break"/>');
  html = html.replace(/@@SCENE_BREAK@@/g, '<hr class="scene-break"/>');

  if (lavish) {
    let firstParagraphMarked = false;
    html = html.replace(/<p>/g, (match, offset: number) => {
      if (firstParagraphMarked) return match;
      const rest = html.slice(offset);
      // Only mark real prose paragraphs, not lists/quotes which reuse <p>.
      if (rest.startsWith("<p><")) return match;
      firstParagraphMarked = true;
      return '<p class="dropcap">';
    });
  }

  return xmlSafe(html.trim());
}

export function escapeXml(text: string): string {
  return xmlSafe(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Render the EPUB title page from book metadata. */
export function titlePageXhtml(meta: BookMeta): string {
  const parts = [
    '<div class="title-page">',
    `<div class="book-title">${escapeXml(meta.title)}</div>`,
  ];
  if (meta.subtitle) {
    parts.push(`<div class="book-subtitle">${escapeXml(meta.subtitle)}</div>`);
  }
  parts.push(`<div class="book-author">${escapeXml(meta.author)}</div>`);
  if (meta.seriesLabel) {
    parts.push(`<div class="book-series">${escapeXml(meta.seriesLabel)}</div>`);
  }
  parts.push("</div>");
  return parts.join("\n");
}

/** Render the KDP-friendly copyright page (requires a publication year). */
export function copyrightPageXhtml(meta: BookMeta, year = new Date().getUTCFullYear()): string {
  return [
    '<div class="copyright-page">',
    `<p>Copyright © ${year} ${escapeXml(meta.author)}</p>`,
    "<p>All rights reserved.</p>",
    "<p>No part of this book may be reproduced in any form by any electronic or",
    " mechanical means (except for the use of quotations in a book review)",
    " without written permission from the author, except by a reviewer who may",
    " quote brief passages in a review.</p>",
    meta.keywords.length > 0 ? `<p>Keywords: ${meta.keywords.map(escapeXml).join(", ")}</p>` : "",
    `<p>Language: ${escapeXml(meta.language)}</p>`,
    "</div>",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Build the ordered EPUB content documents for a full manuscript. */
export function assembleContentDocuments(
  meta: BookMeta,
  chapters: readonly Chapter[],
  options: FormattingOptions = {},
): ContentDocument[] {
  const lavish = options.lavish ?? true;
  const docs: ContentDocument[] = [];

  docs.push({ id: "title-page", title: meta.title, data: titlePageXhtml(meta) });
  if (options.includeCopyright ?? true) {
    docs.push({ id: "copyright-page", title: "Copyright", data: copyrightPageXhtml(meta) });
  }

  for (const chapter of [...chapters].sort((a, b) => a.idx - b.idx)) {
    const number = chapter.idx + 1;
    const heading = `<h1 class="chapter-title"><span class="chapter-number">Chapter ${number}</span>${escapeXml(
      chapter.title,
    )}</h1>`;
    const body = markdownToXhtml(chapter.markdown, { lavish });
    docs.push({
      id: `chapter-${slugify(chapter.title, 4)}-${number}`,
      title: chapter.title,
      data: `${heading}\n${body}`,
    });
  }
  return docs;
}
