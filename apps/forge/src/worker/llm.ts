/**
 * @inkforge/forge — provider resolution for the worker (G-14 + G-04d).
 *
 * The worker asks one question: "which client, if any, may I use?" The order is
 * deliberate — platform keys in config order, and `undefined` when nothing is
 * configured. Returning `undefined` is not a failure: every handler is written
 * to run deterministically without a model, so a keyless deployment still
 * produces outlines, drafts and exports.
 */
import {
  makeDeepseekClient,
  makeGeminiClient,
  makeOpenAiClient,
  type LlmClient,
  type ProviderId,
} from "@inkforge/ai";
import type { AppConfig, AiProviderConfig } from "@inkforge/config";

/** Resolved client plus the provider it points at. */
export interface ResolvedLlm {
  readonly client: LlmClient;
  readonly provider: ProviderId;
  readonly model: string;
}

function build(provider: AiProviderConfig): LlmClient | undefined {
  if (provider.apiKey === undefined || provider.apiKey.trim() === "") return undefined;
  if (provider.id === "openai") {
    return makeOpenAiClient({ model: provider.model, apiKey: provider.apiKey });
  }
  if (provider.id === "gemini") {
    return makeGeminiClient({ model: provider.model, apiKey: provider.apiKey });
  }
  return makeDeepseekClient({
    model: provider.model,
    apiKey: provider.apiKey,
    ...(provider.baseUrl !== undefined ? { baseUrl: provider.baseUrl } : {}),
  });
}

/**
 * First configured platform provider, or undefined. `DEFAULT_AI_PROVIDER`
 * (when set) pins the choice; an unknown or unconfigured pin falls through to
 * config order rather than hard-failing, so a stale env value cannot stop the
 * worker from booting.
 */
export function resolveLlm(config: AppConfig, preferred?: string): ResolvedLlm | undefined {
  const wanted = (preferred ?? "").trim().toLowerCase();
  const candidates = config.ai.providers;
  const ordered =
    wanted === ""
      ? candidates
      : [...candidates].sort((a, b) => Number(b.id === wanted) - Number(a.id === wanted));
  for (const provider of ordered) {
    const client = build(provider);
    if (client) return { client, provider: provider.id, model: provider.model };
  }
  return undefined;
}
