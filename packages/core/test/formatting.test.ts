import { describe, expect, it } from "vitest";
import {
  assembleContentDocuments,
  copyrightPageXhtml,
  EPUB_CSS,
  markdownToXhtml,
  titlePageXhtml,
} from "../src/formatting/index";
import type { BookMeta, Chapter } from "../src/book/index";

const meta: BookMeta = {
  title: "Salt & Iron",
  subtitle: "A Founder's Log",
  author: "Mara Quill",
  description: "Notes from the shipyard.",
  genre: "Business",
  keywords: ["shipbuilding", "leadership"],
  language: "en",
  seriesLabel: "The Quill Logs, Book 1",
  publishTarget: "kdp",
  extra: {},
};

function chapter(title: string, markdown: string, idx = 0): Chapter {
  return {
    id: `id-${idx}`,
    idx,
    title,
    markdown,
    status: "final",
    wordCount: 10,
    createdAt: "",
    updatedAt: "",
  };
}

describe("markdownToXhtml", () => {
  it("renders markdown to XHTML paragraphs", () => {
    const html = markdownToXhtml("First **bold** line.\n\nSecond line.", { lavish: false });
    expect(html).toContain("<p>First <strong>bold</strong> line.</p>");
    expect(html).toContain("<p>Second line.</p>");
  });

  it("converts scene break markers to ornamented hr elements", () => {
    const html = markdownToXhtml("Before.\n\n***\n\nAfter.");
    expect(html).toContain('<hr class="scene-break"/>');
    expect(html).not.toContain("@@SCENE_BREAK@@");
    expect(html).not.toContain("<hr>***");
  });

  it("marks the first prose paragraph with a drop cap in lavish mode", () => {
    const html = markdownToXhtml("The harbor froze overnight.\n\nThen came spring.");
    expect(html).toContain('<p class="dropcap">');
    expect(html).toContain("<p>Then came spring.</p>");
  });

  it("never leaks raw HTML into the output (KDP safety)", () => {
    const html = markdownToXhtml("<script>alert(1)</script>", { lavish: false });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes control characters and XML-unsafe runes", () => {
    const html = markdownToXhtml("Text with \u0007 control and \uFFFE runes.", { lavish: false });
    expect(html).not.toContain("\u0007");
    expect(html).not.toContain("\uFFFE");
  });
});

describe("titlePageXhtml / copyrightPageXhtml", () => {
  it("renders title, subtitle, author and series", () => {
    const page = titlePageXhtml(meta);
    expect(page).toContain("Salt &amp; Iron");
    expect(page).toContain("A Founder&#x27;s Log");
    expect(page).toContain("Mara Quill");
    expect(page).toContain("The Quill Logs, Book 1");
  });

  it("renders a KDP-compliant copyright page with the current year", () => {
    const page = copyrightPageXhtml(meta, 2026);
    expect(page).toContain("Copyright © 2026 Mara Quill");
    expect(page).toContain("shipbuilding");
  });
});

describe("assembleContentDocuments", () => {
  it("orders front matter then chapters by idx", () => {
    const docs = assembleContentDocuments(meta, [
      chapter("Late", "Content two.", 1),
      chapter("Early", "Content one.", 0),
    ]);
    expect(docs.map((doc) => doc.id)).toEqual([
      "title-page",
      "copyright-page",
      "chapter-early-1",
      "chapter-late-2",
    ]);
    expect(docs[2]?.data).toContain("Chapter 1</span>Early");
    expect(docs[2]?.data).toContain("Content one.");
  });

  it("respects the lavish flag on chapter bodies", () => {
    const docs = assembleContentDocuments(meta, [chapter("Plain", "Plain text here.")], {
      lavish: false,
    });
    expect(docs[2]?.data).not.toContain("dropcap");
  });
});

describe("EPUB_CSS", () => {
  it("targets KDP reflowable styling primitives", () => {
    expect(EPUB_CSS).toContain("page-break-before: always");
    expect(EPUB_CSS).toContain("scene-break");
    expect(EPUB_CSS).toContain("dropcap");
  });
});
