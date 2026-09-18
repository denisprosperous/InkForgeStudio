/** Shared fixtures for the export-adapter suites (G-11). */
import JSZip from "jszip";
import type { BookMeta, Chapter } from "../../src/index";

export const meta: BookMeta = {
  title: "Quiet Machines",
  author: "Mara Vane",
  description: "A lighthouse keeper teaches a machine to be alone.",
  genre: "Science Fiction",
  keywords: ["lighthouse", "AI"],
  language: "en",
  publishTarget: "kdp",
};

export function chapter(idx: number, title: string, markdown: string): Chapter {
  return {
    id: `chapter-${idx}`,
    idx,
    title,
    markdown,
    status: "draft",
    wordCount: markdown.split(/\s+/).length,
    createdAt: "",
    updatedAt: "",
  };
}

export const chapters = [
  chapter(
    0,
    "The Lamp",
    "# The Lamp\n\nThe lamp did not answer.\n\nIt kept its light to itself.",
  ),
  chapter(
    1,
    "The Machine",
    "# The Machine\n\nIvo counted the hours the way other people counted money.",
  ),
];

/** Read an archive back with a real ZIP reader (jszip, dev dependency). */
export async function readZip(buffer: Buffer): Promise<JSZip> {
  return JSZip.loadAsync(buffer);
}
