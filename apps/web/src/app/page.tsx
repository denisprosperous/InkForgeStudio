const FORGE_BASE_URL = process.env.FORGE_BASE_URL ?? "http://localhost:4000";

interface ForgeHealth {
  readonly online: boolean;
  readonly detail: string;
}

async function forgeHealth(): Promise<ForgeHealth> {
  try {
    const response = await fetch(`${FORGE_BASE_URL}/healthz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) {
      return { online: false, detail: `forge responded ${response.status}` };
    }
    return { online: true, detail: "forge online" };
  } catch {
    return { online: false, detail: "forge unreachable — run `npm run dev` to start it" };
  }
}

const PIPELINE = [
  { step: "Draft", note: "outline-first chapters, never prose-only" },
  { step: "Humanize", note: "deterministic rule engine + optional LLM polish" },
  { step: "Format", note: "print-grade EPUB XHTML, drop caps, scene breaks" },
  { step: "Validate", note: "EPUBCheck — the gate KDP effectively enforces" },
  { step: "Export", note: "deterministic filenames + manifest lineage" },
] as const;

export default async function StudioHome() {
  const health = await forgeHealth();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col items-center justify-center gap-10 px-6 py-16 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-500">
        KDP-first publishing studio
      </p>
      <h1 className="text-5xl font-bold tracking-tight">Forge books. Not prompts.</h1>
      <p className="max-w-xl text-lg text-neutral-600">
        Inkforge drafts, humanizes, formats and validates KDP-compliant EPUB — with an audit trail
        for every automated run.
      </p>

      <div
        data-testid="forge-status"
        className={
          health.online
            ? "rounded-full border border-emerald-300 bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-700"
            : "rounded-full border border-amber-300 bg-amber-50 px-4 py-1.5 text-sm font-medium text-amber-700"
        }
      >
        {health.detail}
      </div>

      <a
        href="/studio"
        data-testid="open-studio"
        className="bg-ink-600 hover:bg-ink-700 rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
      >
        Open the studio →
      </a>

      <ol className="grid w-full gap-3 text-left">
        {PIPELINE.map((item) => (
          <li
            key={item.step}
            className="flex items-baseline gap-4 rounded-xl border border-neutral-200 bg-white px-5 py-4"
          >
            <span className="w-24 shrink-0 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              {item.step}
            </span>
            <span className="text-neutral-700">{item.note}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
