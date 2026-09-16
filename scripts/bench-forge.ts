/**
 * bench:forge — throughput baseline for the core manuscript pipeline.
 *
 * Benchmarks the hot, deterministic paths (word counting, humanization,
 * markdown→XHTML formatting, document assembly) so regressions in the frozen
 * core are visible before they reach exports. Run after `npm run build`.
 * Forge HTTP benchmarks join this file once the job routes land (Phase 3).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import {
  buildContentDocuments,
  countWords,
  humanizeMarkdown,
  markdownToXhtml,
  parseBookMeta,
  statsFor,
  type Chapter,
  type BookMeta,
} from "@inkforge/core";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const CORE_ENTRY = path.join(ROOT, "packages/core/dist/index.js");

if (!existsSync(CORE_ENTRY)) {
  console.error("bench:forge — @inkforge/core is not built. Run `npm run build` first.");
  process.exit(1);
}

function paragraph(seed: number): string {
  const stock = [
    "It is important to note that the journey was breathtaking.",
    "Furthermore, the vibrant tapestry of the city captivated everyone.",
    "In today's fast-paced world, we must delve into the data.",
    "The results were very quite basically final.",
  ];
  return stock[seed % stock.length] + " The smith worked the iron until the light changed.";
}

function sampleText(paragraphs: number): string {
  const lines: string[] = [];
  for (let i = 0; i < paragraphs; i += 1) {
    if (i % 25 === 0) lines.push(`## Section ${Math.floor(i / 25) + 1}`, "");
    lines.push(paragraph(i), "");
  }
  return lines.join("\n");
}

function bench(label: string, iterations: number, fn: () => void): void {
  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) fn();
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  const perOp = elapsedMs / iterations;
  console.info(
    `${label.padEnd(42)} ${iterations} ops in ${elapsedMs.toFixed(1)}ms → ${perOp.toFixed(3)} ms/op (${(1_000 / perOp).toFixed(1)} ops/s)`,
  );
}

const META: BookMeta = parseBookMeta({
  title: "Bench Forge",
  author: "Mara Quill",
  description: "Throughput baseline fixture.",
});

const TEXT = sampleText(200); // ~800 words
const CHAPTER: Chapter = {
  id: "bench-1",
  idx: 0,
  title: "Bench Chapter",
  markdown: TEXT,
  status: "draft",
  wordCount: countWords(TEXT),
  createdAt: "",
  updatedAt: "",
};

console.info(`bench:forge — fixture: ${CHAPTER.wordCount} words / chapter`);
console.info("");

bench("countWords (800 words)", 2_000, () => {
  countWords(TEXT);
});
bench("humanizeMarkdown (800 words, 1 pass)", 300, () => {
  humanizeMarkdown(TEXT);
});
bench("markdownToXhtml (800 words, lavish)", 500, () => {
  markdownToXhtml(TEXT);
});
bench("statsFor (30 chapters)", 5_000, () => {
  statsFor(Array.from({ length: 30 }, (_, i) => ({ ...CHAPTER, idx: i })));
});
bench("buildContentDocuments (12 chapters)", 50, () => {
  buildContentDocuments(
    META,
    Array.from({ length: 12 }, (_, i) => ({ ...CHAPTER, idx: i, id: `c${i}` })),
    true,
  );
});

console.info("");
console.info("bench:forge — baseline recorded. Compare against this output after core changes.");
