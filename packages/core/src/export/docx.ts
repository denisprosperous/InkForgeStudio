/**
 * @inkforge/core/export/docx — WordprocessingML export (G-11, additive).
 *
 * A minimal, valid .docx: [Content_Types].xml, relationships, document.xml
 * (title page, optional AI-disclosure page, chapters with Heading1 + prose
 * paragraphs) and a small style set. Pure and deterministic: same manuscript,
 * same bytes. Shares the ZIP writer with the KPF container.
 */
import { slugify } from "../book/index";
import { escapeXml } from "../formatting/index";
import { planDisclosure, type DisclosureOptions } from "./disclosure";
import { createZip, type ZipEntry } from "./zip";
import {
  manuscriptWords,
  narrationSegments,
  narrationText,
  type AdapterRequest,
  type AdapterResult,
} from "./adapters";

// ── DOCX (WordprocessingML) ─────────────────────────────────────────────

function docxParagraph(text: string, style?: string): string {
  const properties = style !== undefined ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

/** Minimal, valid WordprocessingML: parts that Word/Pages/LibreOffice accept. */
export function docxDocumentXml(request: AdapterRequest, disclosureText: string | null): string {
  const body: string[] = [];
  body.push(docxParagraph(request.meta.title, "Title"));
  if (request.meta.subtitle !== undefined) body.push(docxParagraph(request.meta.subtitle, "Subtitle"));
  body.push(docxParagraph(`by ${request.meta.author}`));
  if (disclosureText !== null) {
    body.push(docxParagraph("AI-Generated Content Disclosure", "Heading1"));
    for (const paragraph of disclosureText.split(/\n{2,}/)) {
      body.push(docxParagraph(paragraph.trim()));
    }
  }
  for (const chapter of request.chapters) {
    body.push(docxParagraph(`${chapter.idx + 1}. ${chapter.title}`, "Heading1"));
    for (const paragraph of narrationSegments(narrationText(chapter.markdown))) {
      body.push(docxParagraph(paragraph));
    }
  }
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    `<w:body>${body.join("")}</w:body>`,
    "</w:document>",
  ].join("");
}

const DOCX_STYLES = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="360" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:rPr><w:i/><w:sz w:val="32"/></w:rPr></w:style>',
  "</w:styles>",
].join("");

function docxEntries(request: AdapterRequest, disclosureText: string | null): ZipEntry[] {
  return [
    {
      path: "[Content_Types].xml",
      data: [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
        "</Types>",
      ].join(""),
    },
    {
      path: "_rels/.rels",
      data: [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
        "</Relationships>",
      ].join(""),
    },
    {
      path: "word/_rels/document.xml.rels",
      data: [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
        "</Relationships>",
      ].join(""),
    },
    { path: "word/document.xml", data: docxDocumentXml(request, disclosureText) },
    { path: "word/styles.xml", data: DOCX_STYLES },
  ];
}

/** Build a real .docx (WordprocessingML in a ZIP) for editors and beta readers. */
export function buildDocx(
  request: AdapterRequest,
  options: DisclosureOptions = {},
): AdapterResult {
  if (request.chapters.length === 0) {
    throw new Error("Cannot build a DOCX with zero chapters");
  }
  const plan = planDisclosure({ meta: request.meta, chapters: request.chapters }, options);
  const buffer = createZip(docxEntries(request, plan.disclosureText));
  const filename = `${slugify(request.meta.title, 8)}-${slugify(request.meta.author, 3)}.docx`;
  return {
    buffer,
    filename,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    manifest: {
      format: "docx",
      filename,
      title: request.meta.title,
      author: request.meta.author,
      chapters: request.chapters.length,
      words: manuscriptWords(request.chapters),
      bytes: buffer.byteLength,
      aiDisclosure: plan.disclosureText !== null,
      generatedAt: new Date().toISOString(),
      detail: { parts: docxEntries(request, plan.disclosureText).map((entry) => entry.path) },
    },
  };
}

