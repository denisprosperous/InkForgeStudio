import Link from "next/link";
import { EmptyState, ErrorState, Panel, StatPill } from "@inkforge/ui";
import { listBooks, ForgeError, type ForgeBook } from "@/lib/forge";
import { createBookAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Your library" };

function BookCard({ book }: { readonly book: ForgeBook }) {
  return (
    <Link
      href={`/studio/books/${book.id}`}
      className="hover:border-ink-400 flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-5 py-4 transition-colors"
    >
      <div>
        <p className="font-semibold text-neutral-900">{book.title}</p>
        <p className="text-sm text-neutral-500">
          {book.author} · {book.genre}
        </p>
      </div>
      <span className="rounded-full border border-neutral-300 bg-neutral-50 px-2.5 py-0.5 text-xs font-medium text-neutral-600">
        {book.status}
      </span>
    </Link>
  );
}

export default async function StudioPage() {
  let books: ForgeBook[];
  try {
    books = await listBooks();
  } catch (error) {
    const detail =
      error instanceof ForgeError ? `forge ${error.status}: ${error.message}` : undefined;
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <ErrorState
          title="The forge is out of reach"
          {...(detail !== undefined ? { detail } : {})}
        />
        <p className="mt-4 text-sm text-neutral-500">
          Start it with <code>npm run dev</code>, then reload this page.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">Your library</h1>
      <p className="mb-8 text-neutral-600">
        One project per book. Outline first, draft second, export KDP-ready EPUB.
      </p>

      <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatPill label="Projects" value={books.length} />
        <StatPill
          label="Drafting"
          value={books.filter((book) => book.status === "drafting").length}
        />
        <StatPill label="Ready" value={books.filter((book) => book.status !== "drafting").length} />
      </div>

      {books.length === 0 ? (
        <EmptyState
          title="No projects yet"
          hint="Name your book below — the outline planner takes it from there."
        />
      ) : (
        <div className="mb-10 grid gap-3">
          {books.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      )}

      <Panel title="Start a new project">
        <form action={createBookAction} className="grid gap-3">
          <input
            name="title"
            required
            placeholder="Book title"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <input
            name="author"
            required
            placeholder="Author name"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <input
            name="genre"
            placeholder="Genre (default: General)"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <textarea
            name="description"
            placeholder="One-line premise (optional here; the outline planner asks for it next)"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            rows={2}
          />
          <button
            type="submit"
            className="bg-ink-600 hover:bg-ink-700 w-fit rounded-lg px-4 py-2 text-sm font-semibold text-white"
          >
            Create project
          </button>
        </form>
      </Panel>
    </main>
  );
}
