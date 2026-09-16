/**
 * @inkforge/ui/studio — presentational components for the author studio.
 *
 * Server-component-safe by design: no hooks, no browser APIs, no event
 * wiring — states arrive as props so pages stay composable in RSC and in
 * tests. Styling composes through ./primitives (cn + cva) only.
 */
import type { ReactNode } from "react";
import { cva, cn } from "../primitives/index";

/** Surface panel that frames every studio section. */
const panelStyles = cva("rounded-2xl border bg-white shadow-sm", {
  variants: {
    tone: {
      default: "border-neutral-200",
      highlight: "border-ink-300 bg-ink-50",
      danger: "border-red-200 bg-red-50",
    },
    padding: {
      none: "",
      compact: "p-4",
      roomy: "p-6",
    },
  },
  defaultVariants: { tone: "default", padding: "roomy" },
});

export interface PanelProps {
  readonly title?: string;
  readonly actions?: ReactNode;
  readonly tone?: "default" | "highlight" | "danger";
  readonly padding?: "none" | "compact" | "roomy";
  readonly className?: string;
  readonly children: ReactNode;
}

export function Panel({ title, actions, tone, padding, className, children }: PanelProps) {
  return (
    <section className={cn(panelStyles({ tone, padding }), className)}>
      {(title !== undefined || actions !== undefined) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title !== undefined && (
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              {title}
            </h2>
          )}
          {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Compact status pill used for pipeline + job states. */
const statusStyles = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "border-neutral-300 bg-neutral-50 text-neutral-600",
        info: "border-sky-300 bg-sky-50 text-sky-700",
        success: "border-emerald-300 bg-emerald-50 text-emerald-700",
        warning: "border-amber-300 bg-amber-50 text-amber-700",
        danger: "border-red-300 bg-red-50 text-red-700",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type JobPillTone = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "neutral";

/** Map a job status onto the pill tone the studio expects. */
export function toneForStatus(status: string): Exclude<JobPillTone, "neutral"> {
  switch (status) {
    case "queued":
      return "queued" as const;
    case "running":
      return "running" as const;
    case "succeeded":
      return "succeeded" as const;
    case "failed":
      return "failed" as const;
    default:
      return "cancelled" as const;
  }
}

const TONE_CLASS: Record<Exclude<JobPillTone, "neutral">, string> = {
  queued: "border-amber-300 bg-amber-50 text-amber-700",
  running: "border-sky-300 bg-sky-50 text-sky-700",
  succeeded: "border-emerald-300 bg-emerald-50 text-emerald-700",
  failed: "border-red-300 bg-red-50 text-red-700",
  cancelled: "border-neutral-300 bg-neutral-50 text-neutral-600",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = toneForStatus(status);
  return (
    <span
      data-testid={`status-${status}`}
      className={cn(statusStyles(), TONE_CLASS[tone], className)}
    >
      {status}
    </span>
  );
}
/** Small stat chip (word counts, chapter counts, job usage). */
export function StatPill({
  label,
  value,
  className,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-24 flex-col rounded-xl border border-neutral-200 bg-white px-3 py-2",
        className,
      )}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      <span className="text-lg font-semibold text-neutral-800">{value}</span>
    </div>
  );
}

/** Empty state with an actionable hint. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly action?: ReactNode;
}) {
  return (
    <div
      data-testid="empty-state"
      className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-6 py-10 text-center"
    >
      <p className="font-medium text-neutral-700">{title}</p>
      {hint !== undefined && <p className="text-sm text-neutral-500">{hint}</p>}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Error state — never a raw stack trace in the author's face. */
export function ErrorState({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail?: string;
}) {
  return (
    <div
      data-testid="error-state"
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      <p className="font-semibold">{title}</p>
      {detail !== undefined && <p className="mt-0.5 text-red-600">{detail}</p>}
    </div>
  );
}

/** Deterministic loading skeleton (test-friendly, no animation flake). */
export function LoadingRow({ label }: { readonly label: string }) {
  return (
    <div
      data-testid="loading"
      className="animate-pulse rounded-xl border border-neutral-200 bg-neutral-100 px-4 py-3 text-sm text-neutral-500"
    >
      {label}…
    </div>
  );
}

/** Primary studio button styles shared by client controls. */
export const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      intent: {
        primary: "bg-ink-600 text-white hover:bg-ink-700",
        secondary: "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
        destructive: "bg-red-600 text-white hover:bg-red-700",
      },
    },
    defaultVariants: { intent: "primary" },
  },
);
