/**
 * G-09 — chapter revision history against a real database.
 *
 * The repository layer is the contract: every chapter rewrite snapshots the
 * previous content (revision = max+1 per chapter, origin tells you who wrote
 * it), restore is itself reversible, and revisions never leak across tenants.
 * Live Postgres required (INKFORGE_PG_TEST=1).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  createBook,
  insertChapter,
  listChapters,
  listRevisions,
  restoreRevision,
  updateChapter,
} from "@inkforge/db";
import { createFreshDb, type FreshDb } from "./helpers/fresh-db";

const ENABLED = process.env.INKFORGE_PG_TEST === "1";
const d = describe.skipIf(!ENABLED);

d("chapter revision history (G-09)", () => {
  let handle: FreshDb;
  const user = `user-${randomUUID()}`;
  let bookId = "";

  beforeAll(async () => {
    // The migration set ships chapter_revisions (0002); this suite runs against
    // the committed migrations, so no DDL is issued here.
    handle = await createFreshDb("revhistory");
    const book = await createBook(handle.db, user, {
      title: "Quiet Machines",
      author: "Mara Vane",
    });
    bookId = book.id;
  }, 60_000);

  afterAll(async () => {
    await handle.destroy();
  }, 30_000);

  it("snapshots the previous content on every rewrite, with origins", async () => {
    const chapter = await insertChapter(handle.db, user, bookId, {
      idx: 0,
      title: "The Lamp",
      markdown: "First draft.",
    });
    await updateChapter(handle.db, user, bookId, chapter.id, { markdown: "Author edit." });
    await updateChapter(
      handle.db,
      user,
      bookId,
      chapter.id,
      { markdown: "Worker redraft." },
      { origin: "worker" },
    );
    await updateChapter(
      handle.db,
      user,
      bookId,
      chapter.id,
      { markdown: "Humanized prose." },
      { origin: "humanize" },
    );

    const revisions = await listRevisions(handle.db, user, bookId, chapter.id);
    // Revision 3 = "Worker redraft." superseded by the humanize run; revision 2
    // = "Author edit." superseded by the worker; revision 1 = the first draft.
    expect(revisions.map((row) => row.revision)).toEqual([3, 2, 1]);
    expect(revisions.map((row) => row.origin)).toEqual(["humanize", "worker", "author"]);
    expect(revisions[2]!.markdown).toBe("First draft.");
    expect(revisions[1]!.markdown).toBe("Author edit.");
    expect(revisions[0]!.markdown).toBe("Worker redraft.");
  });

  it("restores a snapshot and keeps the undo chain intact", async () => {
    const chapter = (await listChapters(handle.db, user, bookId))[0]!;
    const revisions = await listRevisions(handle.db, user, bookId, chapter.id);
    const oldest = revisions.find((row) => row.revision === 1)!;
    const restored = await restoreRevision(handle.db, user, bookId, chapter.id, oldest.id);
    expect(restored?.markdown).toBe("First draft.");
    expect(restored?.status).toBe("draft");
    const after = await listRevisions(handle.db, user, bookId, chapter.id);
    expect(after[0]!.origin).toBe("restore");
    expect(after[0]!.markdown).toBe("Humanized prose."); // what was live before undo
    expect(after).toHaveLength(4);
  });

  it("never leaks another tenant's revisions", async () => {
    const other = `user-${randomUUID()}`;
    const chapter = (await listChapters(handle.db, user, bookId))[0]!;
    expect(await listRevisions(handle.db, other, bookId, chapter.id)).toHaveLength(0);
    // Unknown revision id (a valid uuid the tenant cannot see) → undefined;
    // non-uuid input is rejected by the route layer before it reaches here.
    expect(
      await restoreRevision(handle.db, other, bookId, chapter.id, randomUUID()),
    ).toBeUndefined();
  });
});