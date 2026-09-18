/**
 * @inkforge/ai/selection — provider precedence + cost capture (G-08, additive).
 *
 * One place decides "which client, if any, may serve this request", in the
 * documented order (Master Directive §M11):
 *   1. the author's own stored key (their spend, their quota),
 *   2. the platform key (config order, or the DEFAULT_AI_PROVIDER pin),
 *   3. the deterministic local fallback — flag-gated, never silent.
 *
 * Cost capture rides along: token usage from the wire is converted to integer
 * micro-USD here so every caller (worker, web actions) meters identically.
 */
import { NoProviderError, type LlmClient, type ProviderId, type TokenUsage } from "./types";

export interface ProviderCandidate {
  readonly id: ProviderId;
  readonly model: string;
  /** Absent for the local fallback, which needs no credential. */
  readonly apiKey?: string;
  /** Row id when the candidate came from the author's key store. */
  readonly keyId?: string;
}

export interface SelectionRequest {
  /** The author's own keys, newest first (from the encrypted key store). */
  readonly userKeys?: readonly ProviderCandidate[];
  /** Platform-configured providers in config order. */
  readonly platformProviders?: readonly ProviderCandidate[];
  /** `DEFAULT_AI_PROVIDER` — a preference, not a requirement. */
  readonly pin?: string;
  /** LOCAL_LLM_ENABLED / PUBLIC_FALLBACK_ENABLED. */
  readonly allowLocalFallback?: boolean;
  /** Model for the local fallback (for metering/telemetry only). */
  readonly localModel?: string;
}

export type SelectionSource = "user" | "platform" | "local";

export interface SelectionPlan {
  readonly source: SelectionSource;
  readonly provider: ProviderId;
  readonly model: string;
  /** Present when source === "user". */
  readonly keyId?: string;
}

function usable(candidate: ProviderCandidate): boolean {
  if (candidate.id === "local") return true;
  return candidate.apiKey !== undefined && candidate.apiKey.trim() !== "";
}

/** Pin first (when it names a usable candidate), then declared order. */
function order(candidates: readonly ProviderCandidate[], pin: string): ProviderCandidate[] {
  const wanted = pin.trim().toLowerCase();
  const usableOnes = candidates.filter(usable);
  if (wanted === "") return [...usableOnes];
  return [...usableOnes].sort((a, b) => Number(b.id === wanted) - Number(a.id === wanted));
}

/**
 * Resolve the precedence chain without touching the network. Returns
 * `undefined` only when nothing is configured AND the fallback is off — which
 * is a legitimate keyless deployment, not an error.
 */
export function selectProviderPlan(request: SelectionRequest = {}): SelectionPlan | undefined {
  const pin = request.pin ?? "";
  const fromUser = order(request.userKeys ?? [], pin)[0];
  if (fromUser) {
    return {
      source: "user",
      provider: fromUser.id,
      model: fromUser.model,
      ...(fromUser.keyId !== undefined ? { keyId: fromUser.keyId } : {}),
    };
  }
  const fromPlatform = order(request.platformProviders ?? [], pin)[0];
  if (fromPlatform) {
    return { source: "platform", provider: fromPlatform.id, model: fromPlatform.model };
  }
  if (request.allowLocalFallback === true) {
    return {
      source: "local",
      provider: "local",
      model: request.localModel ?? "local-deterministic",
    };
  }
  return undefined;
}

// ── Cost capture ────────────────────────────────────────────────────────

export interface ProviderPrice {
  /** USD per 1M prompt tokens. */
  readonly inputPerMillion: number;
  /** USD per 1M completion tokens. */
  readonly outputPerMillion: number;
}

/**
 * List prices captured 2026-09 (USD per 1M tokens). They are an ESTIMATE for
 * metering and budgets, not billing: a price change upstream does not require
 * a code change to keep the studio working, only to keep the numbers exact.
 */
export const PROVIDER_PRICING: Record<ProviderId, ProviderPrice> = {
  openai: { inputPerMillion: 2.5, outputPerMillion: 10 },
  gemini: { inputPerMillion: 1.25, outputPerMillion: 10 },
  deepseek: { inputPerMillion: 0.27, outputPerMillion: 1.1 },
  local: { inputPerMillion: 0, outputPerMillion: 0 },
};

/** Integer micro-USD (1e-6 USD) so money never rides on float drift. */
export function estimateCostMicros(provider: ProviderId, usage: TokenUsage | undefined): number {
  if (!usage) return 0;
  const price = PROVIDER_PRICING[provider];
  const input = (usage.promptTokens / 1_000_000) * price.inputPerMillion;
  const output = (usage.completionTokens / 1_000_000) * price.outputPerMillion;
  return Math.round((input + output) * 1_000_000);
}

/** Sum usage across several completions (multi-pass humanize, retries). */
export function addUsage(
  left: TokenUsage | undefined,
  right: TokenUsage | undefined,
): TokenUsage | undefined {
  if (!left) return right;
  if (!right) return left;
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
  };
}

// ── Deterministic local fallback (flag-gated) ────────────────────────────

function keyPhrases(prompt: string, limit = 6): string[] {
  const seen = new Set<string>();
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 4);
  for (const word of words) {
    if (seen.size >= limit) break;
    seen.add(word);
  }
  return [...seen];
}

/**
 * The offline floor as a *provider*: deterministic, instant, free. It exists so
 * a keyless or rate-limited deployment still completes the pipeline; handlers
 * keep their own deterministic paths, so this is a convenience, not a crutch.
 */
export function makeLocalClient(model = "local-deterministic"): LlmClient {
  return {
    provider: "local",
    model,
    async complete(prompt) {
      const text = prompt.toLowerCase().includes("json")
        ? JSON.stringify({
            note: "local-fallback",
            premise: keyPhrases(prompt).slice(0, 4).join(" "),
            chapters: [],
          })
        : `${keyPhrases(prompt, 3).join(", ") || "the scene"} — drafted offline by the local fallback.`;
      return {
        text,
        provider: "local",
        model,
        usage: {
          promptTokens: Math.ceil(prompt.length / 4),
          completionTokens: Math.ceil(text.length / 4),
        },
      };
    },
  };
}

/** Build the client for a resolved plan; throws when a plan needs a key we lack. */
export function clientForPlan(
  plan: SelectionPlan,
  factories: {
    openai: (model: string, apiKey: string) => LlmClient;
    gemini: (model: string, apiKey: string) => LlmClient;
    deepseek: (model: string, apiKey: string) => LlmClient;
    local?: (model: string) => LlmClient;
  },
  apiKey?: string,
): LlmClient {
  if (plan.provider === "local") {
    return (factories.local ?? makeLocalClient)(plan.model);
  }
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new NoProviderError();
  }
  return factories[plan.provider](plan.model, apiKey);
}

