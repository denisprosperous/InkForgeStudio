import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Panel,
  StatusBadge,
  StatPill,
  EmptyState,
  ErrorState,
  LoadingRow,
  toneForStatus,
  buttonStyles,
} from "../src/studio/index";

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe("studio tone mapping", () => {
  it("maps every job status onto a pill tone", () => {
    expect(toneForStatus("queued")).toBe("queued");
    expect(toneForStatus("running")).toBe("running");
    expect(toneForStatus("succeeded")).toBe("succeeded");
    expect(toneForStatus("failed")).toBe("failed");
    expect(toneForStatus("cancelled")).toBe("cancelled");
    expect(toneForStatus("anything-else")).toBe("cancelled");
  });
});

describe("studio components render server-side", () => {
  it("Panel renders title, actions and body", () => {
    const markup = html(
      h(Panel, { title: "Chapters", actions: h("button", null, "add") }, h("p", null, "body")),
    );
    expect(markup).toContain("Chapters");
    expect(markup).toContain("<p>body</p>");
  });

  it("StatusBadge exposes a stable test id per status", () => {
    expect(html(h(StatusBadge, { status: "running" }))).toContain('data-testid="status-running"');
    expect(html(h(StatusBadge, { status: "succeeded" }))).toContain("border-emerald-300");
  });

  it("StatPill pairs label and value", () => {
    const markup = html(h(StatPill, { label: "Words", value: 1200 }));
    expect(markup).toContain("Words");
    expect(markup).toContain("1200");
  });

  it("EmptyState renders title, hint and stable test id", () => {
    const markup = html(h(EmptyState, { title: "No books yet", hint: "Create one below" }));
    expect(markup).toContain('data-testid="empty-state"');
    expect(markup).toContain("No books yet");
    expect(markup).toContain("Create one below");
  });

  it("ErrorState carries role=alert and the detail line", () => {
    const markup = html(
      h(ErrorState, { title: "Export failed", detail: "EPUBCheck returned 2 errors" }),
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("EPUBCheck returned 2 errors");
  });

  it("LoadingRow marks the loading state for tests", () => {
    expect(html(h(LoadingRow, { label: "Loading chapters" }))).toContain('data-testid="loading"');
  });

  it("buttonStyles compose intents", () => {
    expect(buttonStyles({ intent: "primary" })).toContain("bg-ink-600");
    expect(buttonStyles({ intent: "destructive" })).toContain("bg-red-600");
    expect(buttonStyles({ intent: "secondary" })).toContain("border-neutral-300");
  });
});
