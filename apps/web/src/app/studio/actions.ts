"use server";
/**
 * apps/web/src/app/studio/actions.ts — studio server actions (G-17).
 *
 * Every author gesture lands here first: validate the form, call the forge
 * bridge, then redirect back to the page that shows the result. Actions never
 * touch the database directly — the queue is the contract, and the bridge
 * secret never reaches the browser.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createBook, createChapter, enqueueJob, updateChapter } from "../../lib/forge";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function createBookAction(form: FormData): Promise<void> {
  const title = field(form, "title");
  const author = field(form, "author");
  if (title === "" || author === "") redirect("/studio?error=missing_fields");
  const { book } = await createBook({
    title,
    author,
    ...(field(form, "description") !== "" ? { description: field(form, "description") } : {}),
    ...(field(form, "genre") !== "" ? { genre: field(form, "genre") } : {}),
  });
  revalidatePath("/studio");
  redirect(`/studio/books/${book.id}`);
}

export async function addChapterAction(form: FormData): Promise<void> {
  const bookId = field(form, "bookId");
  const title = field(form, "title");
  if (bookId === "" || title === "") redirect(`/studio/books/${bookId}?error=missing_fields`);
  await createChapter(bookId, { title });
  revalidatePath(`/studio/books/${bookId}`);
  redirect(`/studio/books/${bookId}`);
}

export async function generateOutlineAction(form: FormData): Promise<void> {
  const bookId = field(form, "bookId");
  const premise = field(form, "premise");
  if (bookId === "" || premise === "") redirect(`/studio/books/${bookId}?error=missing_premise`);
  const chapters = Number.parseInt(field(form, "chapters"), 10);
  await enqueueJob({
    bookId,
    type: "outline.generate",
    payload: {
      premise,
      ...(Number.isFinite(chapters) && chapters >= 1 && chapters <= 120
        ? { chapterCount: chapters }
        : {}),
    },
  });
  revalidatePath(`/studio/books/${bookId}`);
  redirect(`/studio/books/${bookId}`);
}

export async function draftChapterAction(form: FormData): Promise<void> {
  const bookId = field(form, "bookId");
  const chapterId = field(form, "chapterId");
  const brief = field(form, "brief");
  if (bookId === "" || chapterId === "") redirect("/studio?error=missing_fields");
  await enqueueJob({
    bookId,
    type: "chapter.generate",
    payload: {
      chapterId,
      ...(brief !== "" ? { brief } : {}),
    },
  });
  revalidatePath(`/studio/books/${bookId}/chapters/${chapterId}`);
  redirect(`/studio/books/${bookId}/chapters/${chapterId}`);
}

export async function humanizeChapterAction(form: FormData): Promise<void> {
  const bookId = field(form, "bookId");
  const chapterId = field(form, "chapterId");
  if (bookId === "" || chapterId === "") redirect("/studio?error=missing_fields");
  await enqueueJob({ bookId, type: "chapter.humanize", payload: { chapterId } });
  revalidatePath(`/studio/books/${bookId}/chapters/${chapterId}`);
  redirect(`/studio/books/${bookId}/chapters/${chapterId}`);
}

export async function saveChapterAction(form: FormData): Promise<void> {
  const bookId = field(form, "bookId");
  const chapterId = field(form, "chapterId");
  const markdown = form.get("markdown");
  if (bookId === "" || chapterId === "" || typeof markdown !== "string") {
    redirect("/studio?error=missing_fields");
  }
  await updateChapter(bookId, chapterId, { markdown });
  revalidatePath(`/studio/books/${bookId}/chapters/${chapterId}`);
  redirect(`/studio/books/${bookId}/chapters/${chapterId}`);
}

/**
 * Approve/reject for the humanize diff (B7): reject restores the pre-humanize
 * text (carried in the succeeded job result) and flips the chapter back to
 * draft; approve marks it humanized for good.
 */
export async function rejectHumanizeAction(form: FormData): Promise<void> {
  const bookId = field(form, "bookId");
  const chapterId = field(form, "chapterId");
  const before = form.get("before");
  if (bookId === "" || chapterId === "" || typeof before !== "string") {
    redirect("/studio?error=missing_fields");
  }
  await updateChapter(bookId, chapterId, { markdown: before, status: "draft" });
  revalidatePath(`/studio/books/${bookId}/chapters/${chapterId}`);
  redirect(`/studio/books/${bookId}/chapters/${chapterId}`);
}

export async function approveHumanizeAction(form: FormData): Promise<void> {
  const bookId = field(form, "bookId");
  const chapterId = field(form, "chapterId");
  if (bookId === "" || chapterId === "") redirect("/studio?error=missing_fields");
  await updateChapter(bookId, chapterId, { status: "humanized" });
  revalidatePath(`/studio/books/${bookId}/chapters/${chapterId}`);
  redirect(`/studio/books/${bookId}/chapters/${chapterId}`);
}

export async function exportBookAction(form: FormData): Promise<void> {
  const bookId = field(form, "bookId");
  if (bookId === "") redirect("/studio?error=missing_fields");
  await enqueueJob({ bookId, type: "book.export", payload: { format: "epub" } });
  revalidatePath(`/studio/books/${bookId}`);
  redirect(`/studio/books/${bookId}`);
}
