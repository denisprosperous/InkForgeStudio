import Link from "next/link";
import { Panel, StatusBadge } from "@inkforge/ui";
import {
  ForgeError,
  getBook,
  listChapters,
  listJobs,
  listRevisions,
  type ForgeRevision,
} from "@/lib/forge";
import {
  approveHumanizeAction,
  draftChapterAction,
  humanizeChapterAction,
  rejectHumanizeAction,
  restoreRevisionAction,
  saveChapterAction,
} from "@/app/studio/actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Chapter editor" };

const textareaClass =
  "min-h-96 w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm";
const buttonClass =
  "w-fit rounded-lg bg-ink-600 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-700";
const ghostButtonClass =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50";

export default async function ChapterPage({
  params,
}: {
  readonly params: Promise<{ readonly bookId: string; readonly chapterId: string }>;
}) {
  const { bookId, chapterId } = await params;
  try {
    const [book, chapters] = await Promise.all([getBook(bookId), listChapters(bookId)]);
    const chapter = chapters.find((row) => row.id === chapterId);
    if (!chapter) {
      return (
        <main className="mx-auto w-full max-w-3xl px-6 py-16">
          <p className="text-neutral-600">Chapter not found in this project.</p>
          <Link href={`/studio/books/${bookId}`} className="text-ink-700 text-sm underline">
            Back to {book.title}
          </Link>
        </main>
      );
    }
    const [jobs, revisions] = await Promise.all([
      listJobs(bookId),
      listRevisions(bookId, chapterId).catch((): ForgeRevision[] => []),
    ]);
    const lastHumanize = jobs.find(
      (job) =>
        job.type === "chapter.humanize" &&
        job.status === "succeeded" &&
        (job.payload as { chapterId?: string } | null)?.chapterId === chapter.id,
    );
    const humanizeResult = lastHumanize?.result as
      | { before?: string; changedSentences?: number; llmRewrites?: number }
      | undefined;
    const pendingApproval = chapter.status === "humanized" && humanizeResult?.before !== undefined;

    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <Link href={`/studio/books/${bookId}`} className="text-ink-700 text-sm underline">
          ← {book.title}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          {chapter.idx + 1}. {chapter.title}
        </h1>
        <p className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
          {chapter.wordCount} words · <StatusBadge status={chapter.status} />
        </p>

        {pendingApproval && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-semibold">Humanize run pending approval</p>
            <p className="mt-0.5">
              {humanizeResult?.changedSentences ?? 0} sentence(s) changed
              {(humanizeResult?.llmRewrites ?? 0) > 0 ? " · LLM polish applied" : " · rules only"}.
              Reject restores the previous draft.
            </p>
          </div>
        )}

        <Panel title="Editor" className="mb-6">
          <form action={saveChapterAction}>
            <input type="hidden" name="bookId" value={bookId} />
            <input type="hidden" name="chapterId" value={chapter.id} />
            <textarea
              name="markdown"
              defaultValue={chapter.markdown}
              className={textareaClass}
              aria-label="Chapter markdown"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="submit" className={buttonClass}>
                Save
              </button>
              {pendingApproval && (
                <>
                  <button type="submit" form="reject-form" className={ghostButtonClass}>
                    Reject humanize (restore previous)
                  </button>
                  <button type="submit" form="approve-form" className={ghostButtonClass}>
                    Approve humanize
                  </button>
                </>
              )}
            </div>
          </form>
        </Panel>

        <Panel title="Pipeline actions" className="mb-6">
          <div className="flex flex-wrap items-center gap-2">
            <form action={draftChapterAction}>
              <input type="hidden" name="bookId" value={bookId} />
              <input type="hidden" name="chapterId" value={chapter.id} />
              <input type="hidden" name="brief" value={chapter.title} />
              <button type="submit" className={ghostButtonClass}>
                Draft with the planner
              </button>
            </form>
            <form action={humanizeChapterAction}>
              <input type="hidden" name="bookId" value={bookId} />
              <input type="hidden" name="chapterId" value={chapter.id} />
              <button type="submit" className={ghostButtonClass} disabled={chapter.wordCount === 0}>
                Humanize
              </button>
            </form>
          </div>
        </Panel>

        {revisions.length > 0 && (
          <Panel title="Revision history" className="mb-6">
            <ul className="grid gap-2">
              {revisions.slice(0, 8).map((revision) => (
                <li
                  key={revision.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm"
                >
                  <span className="text-neutral-700">
                    r{revision.revision} · {revision.wordCount} words · superseded by{" "}
                    {revision.origin}
                  </span>
                  <form action={restoreRevisionAction}>
                    <input type="hidden" name="bookId" value={bookId} />
                    <input type="hidden" name="chapterId" value={chapter.id} />
                    <input type="hidden" name="revisionId" value={revision.id} />
                    <button type="submit" className={ghostButtonClass}>
                      Restore
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {pendingApproval && humanizeResult?.before !== undefined && (
          <>
            <form id="reject-form" action={rejectHumanizeAction}>
              <input type="hidden" name="bookId" value={bookId} />
              <input type="hidden" name="chapterId" value={chapter.id} />
              <input type="hidden" name="before" value={humanizeResult.before} />
            </form>
            <form id="approve-form" action={approveHumanizeAction}>
              <input type="hidden" name="bookId" value={bookId} />
              <input type="hidden" name="chapterId" value={chapter.id} />
            </form>
          </>
        )}
      </main>
    );
  } catch (error) {
    const status = error instanceof ForgeError ? error.status : 502;
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <p className="text-neutral-600">
          {status === 404 ? "Project not found." : "The forge is out of reach."}
        </p>
        <Link href="/studio" className="text-ink-700 text-sm underline">
          Back to the library
        </Link>
      </main>
    );
  }
}
