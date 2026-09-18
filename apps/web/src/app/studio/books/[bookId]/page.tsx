import Link from "next/link";
import { EmptyState, ErrorState, Panel, StatPill, StatusBadge } from "@inkforge/ui";
import { ForgeError, getBook, getOutline, listChapters, listExports, listJobs } from "@/lib/forge";
import { activeStage, nextActionStage, stageLabel, type StageFacts } from "@/lib/flows";
import {
  addChapterAction,
  draftChapterAction,
  exportBookAction,
  generateOutlineAction,
} from "../../actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Project" };

const inputClass = "rounded-lg border border-neutral-300 px-3 py-2 text-sm";
const buttonClass =
  "w-fit rounded-lg bg-ink-600 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-700";

function BookShell({ children }: { readonly children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-3xl px-6 py-16">{children}</main>;
}

export default async function BookPage({
  params,
}: {
  readonly params: Promise<{ readonly bookId: string }>;
}) {
  const { bookId } = await params;
  let book, chapters, outline, jobs, exports;
  try {
    [book, chapters, outline, jobs, exports] = await Promise.all([
      getBook(bookId),
      listChapters(bookId),
      getOutline(bookId),
      listJobs(bookId),
      listExports(bookId),
    ]);
  } catch (error) {
    const status = error instanceof ForgeError ? error.status : 502;
    const detail = error instanceof Error ? error.message : undefined;
    return (
      <BookShell>
        <ErrorState
          title={status === 404 ? "Project not found" : "The forge is out of reach"}
          {...(detail !== undefined ? { detail } : {})}
        />
        <Link href="/studio" className="text-ink-700 mt-4 inline-block text-sm underline">
          Back to the library
        </Link>
      </BookShell>
    );
  }

  const facts: StageFacts = {
    hasOutline: outline !== null,
    drafted: chapters.filter((chapter) => chapter.wordCount > 0).length,
    humanized: chapters.filter((chapter) => chapter.status === "humanized").length,
    exportsValidated: exports.filter(
      (artifact) => artifact.kind === "epub" && artifact.validation?.epubcheck !== "failed",
    ).length,
  };
  const waiting = activeStage(jobs);
  const next = nextActionStage(facts);
  const beats = outline?.payload.chapters ?? [];

  return (
    <BookShell>
      <Link href="/studio" className="text-ink-700 text-sm underline">
        ← Library
      </Link>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">{book.title}</h1>
      <p className="mb-6 text-neutral-500">
        {book.author} · {book.genre} · {book.status}
      </p>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatPill label="Outline" value={outline ? "ready" : "none"} />
        <StatPill label="Chapters" value={chapters.length} />
        <StatPill label="Words" value={chapters.reduce((total, c) => total + c.wordCount, 0)} />
        <StatPill label="Exports" value={exports.length} />
      </div>

      {waiting !== undefined && (
        <div
          className="mb-8 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800"
          data-testid="pipeline-waiting"
        >
          Working on <strong>{stageLabel(waiting)}</strong> — the queue is running. Reload to
          refresh.
        </div>
      )}

      <Panel title={`Pipeline · next: ${stageLabel(next)}`} className="mb-8">
        {outline === null ? (
          <form action={generateOutlineAction} className="grid gap-3">
            <input type="hidden" name="bookId" value={book.id} />
            <textarea
              name="premise"
              required
              rows={3}
              placeholder="Premise: a lighthouse keeper teaches a machine to be alone."
              className={inputClass}
            />
            <input
              name="chapters"
              type="number"
              min={1}
              max={120}
              placeholder="Chapters (default 12)"
              className={inputClass}
            />
            <button type="submit" className={buttonClass}>
              Generate outline
            </button>
          </form>
        ) : (
          <ol className="grid gap-2">
            {beats.map((beat) => {
              const chapter = chapters.find((row) => row.idx === beat.idx);
              return (
                <li
                  key={beat.idx}
                  className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-800">
                      {beat.idx + 1}. {beat.title}
                    </p>
                    <p className="truncate text-xs text-neutral-500">
                      ~{beat.targetWords} words{chapter ? ` · drafted ${chapter.wordCount}` : ""}
                    </p>
                  </div>
                  {chapter === undefined ? (
                    <form action={addChapterAction}>
                      <input type="hidden" name="bookId" value={book.id} />
                      <input type="hidden" name="title" value={beat.title} />
                      <button
                        type="submit"
                        className="text-ink-700 text-xs font-semibold underline"
                      >
                        Add chapter
                      </button>
                    </form>
                  ) : (
                    <StatusBadge status={chapter.status} />
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      <Panel title="Chapters" className="mb-8">
        {chapters.length === 0 ? (
          <EmptyState
            title="No chapters yet"
            hint="Generate the outline first — its beats become your chapters."
          />
        ) : (
          <ul className="grid gap-3">
            {chapters.map((chapter) => {
              const beat = beats.find((row) => row.idx === chapter.idx);
              return (
                <li
                  key={chapter.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/studio/books/${book.id}/chapters/${chapter.id}`}
                      className="font-medium text-neutral-900 underline-offset-2 hover:underline"
                    >
                      {chapter.idx + 1}. {chapter.title}
                    </Link>
                    <p className="text-xs text-neutral-500">
                      {chapter.wordCount} words · {chapter.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <form action={draftChapterAction}>
                      <input type="hidden" name="bookId" value={book.id} />
                      <input type="hidden" name="chapterId" value={chapter.id} />
                      <input type="hidden" name="brief" value={beat?.brief ?? chapter.title} />
                      <button
                        type="submit"
                        className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                      >
                        {chapter.wordCount > 0 ? "Redraft" : "Draft"}
                      </button>
                    </form>
                    <Link
                      href={`/studio/books/${book.id}/chapters/${chapter.id}`}
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                    >
                      Open
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <form action={addChapterAction} className="mt-4 flex flex-wrap gap-2">
          <input type="hidden" name="bookId" value={book.id} />
          <input name="title" required placeholder="New chapter title" className={inputClass} />
          <button type="submit" className={buttonClass}>
            Add chapter
          </button>
        </form>
      </Panel>

      <Panel title="Jobs" className="mb-8">
        {jobs.length === 0 ? (
          <EmptyState
            title="Queue is empty"
            hint="Outline, draft, humanize and export jobs land here."
          />
        ) : (
          <ul className="grid gap-2">
            {jobs.slice(0, 8).map((job) => (
              <li
                key={job.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm"
              >
                <span className="font-mono text-xs text-neutral-600">{job.type}</span>
                <span className="flex items-center gap-2">
                  {job.error !== null && (
                    <span className="max-w-64 truncate text-xs text-red-600">{job.error}</span>
                  )}
                  <StatusBadge status={job.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Exports">
        {exports.length === 0 ? (
          <EmptyState
            title="No artifacts yet"
            hint="Export runs the KDP gate: disclosure layer + EPUBCheck, then stores the EPUB."
          />
        ) : (
          <ul className="grid gap-2">
            {exports.map((artifact) => (
              <li
                key={artifact.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm"
              >
                <a
                  href={`/studio/books/${book.id}/exports/${artifact.id}`}
                  className="text-ink-700 font-medium underline"
                >
                  {artifact.filename}
                </a>
                <span className="flex items-center gap-2 text-xs text-neutral-500">
                  {artifact.validation?.epubcheck !== undefined && (
                    <span>epubcheck: {artifact.validation.epubcheck}</span>
                  )}
                  <span>{Math.max(1, Math.round(artifact.sizeBytes / 1024))} KB</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form action={exportBookAction} className="mt-4">
          <input type="hidden" name="bookId" value={book.id} />
          <button type="submit" className={buttonClass} disabled={chapters.length === 0}>
            Export EPUB
          </button>
        </form>
      </Panel>
    </BookShell>
  );
}
