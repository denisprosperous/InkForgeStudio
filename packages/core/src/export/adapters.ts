/**
 * @inkforge/core/export/adapters — narration script + shared adapter types
 * (G-11, additive). The DOCX and KPF builders live in ./docx and ./kpf; the
 * EPUB path itself is untouched: `buildEpub` stays the only producer of the
 * validated ebook.
 */
import type { BookMeta, Chapter } from "../book/index";
import { countWords, slugify } from "../book/index";

export interface AdapterRequest {
  readonly meta: BookMeta;
  readonly chapters: readonly Chapter[];
}

export interface AdapterResult {
  readonly buffer: Buffer;
  readonly filename: string;
  readonly mimeType: string;
  readonly manifest: AdapterManifest;
}

export interface AdapterManifest {
  readonly format: "audio-script" | "docx" | "kpf";
  readonly filename: string;
  readonly title: string;
  readonly author: string;
  readonly chapters: number;
  readonly words: number;
  readonly bytes: number;
  readonly aiDisclosure: boolean;
  readonly generatedAt: string;
  /** Format-specific extras (segments, parts, container notes). */
  readonly detail: Record<string, unknown>;
}

/** Aggregate word count across chapters (used by every adapter manifest). */
export function manuscriptWords(chapters: readonly Chapter[]): number {
  return chapters.reduce(
    (total, chapter) => total + (chapter.wordCount || countWords(chapter.markdown)),
    0,
  );
}

/** Markdown → narration-ready plain text: no syntax, real punctuation kept. */
export function narrationText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split narration into paragraph-sized segments (one breath each). */
export function narrationSegments(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export interface AudioScriptManifest {
  readonly filename: string;
  readonly chapters: number;
  readonly words: number;
  readonly segments: number;
  readonly estimatedMinutes: number;
  /** Words per minute used for the estimate (audiobook narration pace). */
  readonly wordsPerMinute: number;
}

export interface AudioScriptResult {
  readonly text: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly manifest: AudioScriptManifest;
}

const NARRATION_WPM = 150;

/**
 * Build the audiobook narration script: chapter headers, one segment per
 * paragraph, explicit pause and chapter-break markers, and a duration estimate
 * at 150 wpm (a normal narration pace). This is what a narrator or a TTS
 * pipeline actually reads — not the EPUB XHTML.
 */
export function buildAudioScript(request: AdapterRequest): AudioScriptResult {
  if (request.chapters.length === 0) {
    throw new Error("Cannot build an audio script with zero chapters");
  }
  const lines: string[] = [
    `AUDIO NARRATION SCRIPT — ${request.meta.title}`,
    request.meta.subtitle !== undefined ? `Subtitle: ${request.meta.subtitle}` : "",
    `Author: ${request.meta.author}`,
    `Language: ${request.meta.language}`,
    "Markers: [[pause]] = short beat, [[chapter-break]] = new chapter file",
    "",
  ].filter((line) => line !== "");

  let segments = 0;
  for (const chapter of request.chapters) {
    lines.push(`[[chapter-break]]`, `CHAPTER ${chapter.idx + 1}: ${chapter.title}`, "");
    const text = narrationText(chapter.markdown);
    if (text === "") continue;
    for (const segment of narrationSegments(text)) {
      segments += 1;
      lines.push(`[segment ${segments}] ${segment}`, "[[pause]]", "");
    }
  }

  const words = manuscriptWords(request.chapters);
  const text = `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
  return {
    text,
    filename: `${slugify(request.meta.title, 8)}-${slugify(request.meta.author, 3)}-audio-script.txt`,
    mimeType: "text/plain; charset=utf-8",
    manifest: {
      filename: `${slugify(request.meta.title, 8)}-${slugify(request.meta.author, 3)}-audio-script.txt`,
      chapters: request.chapters.length,
      words,
      segments,
      estimatedMinutes: Math.max(1, Math.round(words / NARRATION_WPM)),
      wordsPerMinute: NARRATION_WPM,
    },
  };
}

