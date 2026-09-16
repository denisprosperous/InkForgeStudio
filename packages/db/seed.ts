/**
 * Seed: a demo author with a two-chapter starter book so `npm run dev` shows a
 * living studio immediately. Idempotent — safe to run on every boot.
 */
import { eq } from "drizzle-orm";
import { loadDotenv } from "@inkforge/config";
import { countWords } from "@inkforge/core/book";
import { createDb, books, chapters, users } from "./src/index";

const DEMO_USER_ID = "preview-user";
const DEMO_EMAIL = "author@inkforge.local";

const DEMO_CHAPTERS = [
  {
    idx: 0,
    title: "The Forge Lights",
    markdown: [
      "The forge woke before dawn, the way it always had.",
      "",
      "Mara pressed her palm to the cold iron door and felt the day's first heat",
      "bleeding through. Something was different tonight — the air tasted of",
      "ozone and endings.",
      "",
      "***",
      "",
      "By seven the apprentices had assembled in the yard, and by seven-fifteen",
      "the first hammer fell.",
    ].join("\n"),
  },
  {
    idx: 1,
    title: "Iron Lessons",
    markdown: [
      "Iron does not negotiate.",
      "",
      "It yields exactly as much as the smith earns, and not one degree more.",
      "Mara had learned that lesson at fourteen, with a burned hand and a broken",
      "apprenticeship, and she had never needed to learn it twice.",
    ].join("\n"),
  },
];

async function main(): Promise<void> {
  await loadDotenv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required — see .env.example");
  }
  const handle = createDb(url, { max: 2 });

  try {
    const existing = await handle.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, DEMO_USER_ID))
      .limit(1);
    if (existing.length > 0) {
      console.info("Seed: demo author already present, nothing to do.");
      return;
    }

    await handle.db
      .insert(users)
      .values({ id: DEMO_USER_ID, email: DEMO_EMAIL, displayName: "Mara Quill (demo)" });

    const book = await handle.db
      .insert(books)
      .values({
        userId: DEMO_USER_ID,
        title: "The Iron Forge",
        subtitle: "Book One of the Quill Logs",
        author: "Mara Quill",
        description: "A founder's log from the last working forge in the city.",
        genre: "Literary Fiction",
        keywords: ["forge", "apprenticeship", "city"],
        seriesLabel: "The Quill Logs",
      })
      .returning();
    const bookRow = book[0];
    if (!bookRow) throw new Error("Seed book insert returned no rows");

    for (const chapter of DEMO_CHAPTERS) {
      await handle.db.insert(chapters).values({
        bookId: bookRow.id,
        userId: DEMO_USER_ID,
        idx: chapter.idx,
        title: chapter.title,
        markdown: chapter.markdown,
        wordCount: countWords(chapter.markdown),
      });
    }

    console.info(
      `Seed: created demo book "${bookRow.title}" with ${DEMO_CHAPTERS.length} chapters.`,
    );
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
