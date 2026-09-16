/**
 * @inkforge/covers — cover domain model.
 *
 * This module owns the cover *contract*: the spec every generator (typographic
 * renderer, image-model pipeline, human designer upload) must produce and the
 * KDP trim constants the export pipeline relies on. Rendering backends plug in
 * behind `validateCoverSpec` — the spec is the stable surface, the renderer is
 * swappable (Master Directive §3.3, module contracts).
 */

/** KDP's recommended full-bleed ebook cover raster: 1:1.6, 1600×2560. */
export const COVER_WIDTH_PX = 1600;
export const COVER_HEIGHT_PX = 2560;

export const COVER_STYLES = ["typographic", "minimal", "genre-art"] as const;
export type CoverStyle = (typeof COVER_STYLES)[number];

export interface CoverPalette {
  readonly background: string;
  readonly primary: string;
  readonly accent: string;
}

export interface CoverSpec {
  readonly title: string;
  readonly author: string;
  readonly subtitle?: string;
  readonly seriesLabel?: string;
  readonly style: CoverStyle;
  readonly palette: CoverPalette;
}

export interface CoverSpecIssue {
  readonly field: string;
  readonly message: string;
}

export type CoverSpecResult =
  | { readonly ok: true; readonly spec: CoverSpec }
  | { readonly ok: false; readonly issues: readonly CoverSpecIssue[] };

const HEX = /^#[0-9a-fA-F]{6}$/u;

function checkText(
  value: unknown,
  field: string,
  max: number,
  required: boolean,
  issues: CoverSpecIssue[],
): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    if (required) issues.push({ field, message: "must be a non-empty string" });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    issues.push({ field, message: `must be at most ${max} characters` });
    return undefined;
  }
  return trimmed;
}

function checkHex(value: unknown, field: string, issues: CoverSpecIssue[]): string | undefined {
  if (typeof value !== "string" || !HEX.test(value)) {
    issues.push({ field, message: "must be a #rrggbb hex color" });
    return undefined;
  }
  return value.toLowerCase();
}

/**
 * Validate an unknown payload into a CoverSpec. Deterministic and dependency
 * free on purpose: the spec gate must run identically in workers, browsers and
 * tests without dragging a rendering backend along.
 */
export function validateCoverSpec(value: unknown): CoverSpecResult {
  const issues: CoverSpecIssue[] = [];
  if (typeof value !== "object" || value === null) {
    return { ok: false, issues: [{ field: "(root)", message: "cover spec must be an object" }] };
  }
  const raw = value as Record<string, unknown>;

  const title = checkText(raw.title, "title", 300, true, issues);
  const author = checkText(raw.author, "author", 200, true, issues);
  const subtitle = checkText(raw.subtitle, "subtitle", 300, false, issues);
  const seriesLabel = checkText(raw.seriesLabel, "seriesLabel", 160, false, issues);

  const style = raw.style as CoverStyle | undefined;
  if (style === undefined || !COVER_STYLES.includes(style)) {
    issues.push({ field: "style", message: `must be one of ${COVER_STYLES.join(", ")}` });
  }

  if (typeof raw.palette !== "object" || raw.palette === null) {
    issues.push({ field: "palette", message: "must be an object with background/primary/accent" });
  } else {
    const palette = raw.palette as Record<string, unknown>;
    const background = checkHex(palette.background, "palette.background", issues);
    const primary = checkHex(palette.primary, "palette.primary", issues);
    const accent = checkHex(palette.accent, "palette.accent", issues);
    if (issues.length === 0 && title && author && style) {
      return {
        ok: true,
        spec: {
          title,
          author,
          style,
          palette: {
            background: background ?? "#111111",
            primary: primary ?? "#f5f0e6",
            accent: accent ?? "#b3541e",
          },
          ...(subtitle === undefined ? {} : { subtitle }),
          ...(seriesLabel === undefined ? {} : { seriesLabel }),
        },
      };
    }
  }

  return { ok: false, issues };
}

/** Deterministic per-style palette so generated covers stay brand-consistent. */
export function defaultPalette(style: CoverStyle): CoverPalette {
  switch (style) {
    case "typographic":
      return { background: "#101418", primary: "#f5f0e6", accent: "#c8a24b" };
    case "minimal":
      return { background: "#faf7f2", primary: "#14181d", accent: "#3a6ea5" };
    case "genre-art":
      return { background: "#1a0f1f", primary: "#f2e9dc", accent: "#a53c6e" };
  }
}
