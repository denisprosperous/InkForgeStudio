/**
 * Robust JSON extraction for model responses. Models wrap JSON in prose or
 * fenced code blocks; this finds the payload anyway, then validates it with a
 * zod schema so malformed output becomes a typed error, never a crash.
 */
import type { ZodType } from "zod";
import { ProviderError, type ProviderId } from "./types";

/** Strip markdown fences and prose around a JSON object/array. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], trimmed].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    const sliced = sliceBalanced(candidate);
    if (sliced === null) continue;
    try {
      return JSON.parse(sliced);
    } catch {
      // try the next candidate
    }
  }
  throw new Error("Response contained no parsable JSON payload");
}

/** Slice from the first balanced {...} or [...] block in the text. */
function sliceBalanced(text: string): string | null {
  const openChar = text.match(/[{[]/u);
  if (!openChar || openChar.index === undefined) return null;
  const open = openChar[0];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openChar.index; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(openChar.index, i + 1);
    }
  }
  return null;
}

/** Parse + validate, converting any failure into a ProviderError. */
export function parseJsonResponse<T>(provider: ProviderId, text: string, schema: ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = extractJson(text);
  } catch (error) {
    throw new ProviderError(provider, error instanceof Error ? error.message : "bad JSON", error);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ProviderError(
      provider,
      `Schema mismatch at ${issue?.path.join(".") ?? "(root)"}: ${issue?.message ?? "invalid"}`,
    );
  }
  return result.data;
}
