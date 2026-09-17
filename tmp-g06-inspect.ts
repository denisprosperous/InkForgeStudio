import { writeFileSync } from "node:fs";
import { parseBookMeta, type Chapter } from "./packages/core/src/book/index";
import { buildDisclosedEpub } from "./packages/core/src/export/disclosure";
const meta = parseBookMeta({
  title: "Quiet Machines",
  author: "Mara Vane",
  description: "A lighthouse keeper teaches a machine to be alone.",
});
const chapters: Chapter[] = [0, 1].map((idx) => ({
  id: `ch-${idx}`,
  idx,
  title: idx === 0 ? "The Lamp" : "The Dark",
  markdown: `Prose ${idx}. The lamp turned twice.`,
  status: "final",
  wordCount: 8,
  createdAt: "",
  updatedAt: "",
}));
const result = await buildDisclosedEpub({ meta, chapters });
writeFileSync("/tmp/disclosed.epub", result.buffer);
console.log("DOCIDS:", result.manifest.documentIds.join(","));
console.log("AI:", result.manifest.aiDisclosure, "BYTES:", result.manifest.bytes);
