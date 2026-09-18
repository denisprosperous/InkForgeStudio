/**
 * @inkforge/forge — provider resolution for the worker (G-14 + G-04d + G-08).
 *
 * The worker asks one question: "which client, if any, may I use?" The order is
 * the documented three-tier chain (@inkforge/ai selectProviderPlan): the
 * author's own key first, the platform keys in config order second, and the
 * deterministic local fallback last (flag-gated). `undefined` remains valid —
 * every handler runs deterministically without a model, so a keyless
 * deployment still produces outlines, drafts and exports.
 */
import {
  makeDeepseekClient,
  makeGeminiClient,
  makeLocalClient,
  makeOpenAiClient,
  selectProviderPlan,
  type LlmClient,
  type ProviderCandidate,
  type ProviderId,
  type SelectionPlan,
} from "@inkforge/ai";
import type { AppConfig, AiProviderConfig } from "@inkforge/config";
import type { Database } from "@inkforge/db";
import { loadUserKeyCandidates } from "./keys";

/** Default model per provider for author-supplied keys (the store has no model column yet). */
export const DEFAULT_MODELS: Record<Exclude<ProviderId, "local">, string> = {
  openai: "gpt-4o",
  gemini: "gemini-2.5-pro",
  deepseek: "deepseek-chat",
};

/** Resolved client plus where it came from (telemetry: whose quota this run spends). */
export interface ResolvedLlm {
  readonly client: LlmClient;
  readonly provider: ProviderId;
  readonly model: string;
  readonly source: "user" | "platform" | "local";
  readonly keyId?: string;
}

function platformCandidates(providers: readonly AiProviderConfig[]): ProviderCandidate[] {
  return providers.map((provider) => ({
    id: provider.id,
    model: provider.model,
    ...(provider.apiKey !== undefined ? { apiKey: provider.apiKey } : {}),
  }));
}

/** Platform client for a provider entry, honouring its baseUrl override. */
function platformClient(provider: AiProviderConfig): LlmClient {
  const apiKey = provider.apiKey ?? "";
  if (provider.id === "openai") return makeOpenAiClient({ model: provider.model, apiKey });
  if (provider.id === "gemini") return makeGeminiClient({ model: provider.model, apiKey });
  return makeDeepseekClient({
    model: provider.model,
    apiKey,
    ...(provider.baseUrl !== undefined ? { baseUrl: provider.baseUrl } : {}),
  });
}

function localResolved(model: string): ResolvedLlm {
  const client = makeLocalClient(model);
  return { client, provider: "local", model: client.model, source: "local" };
}

/** Turn a plan into a concrete client, using the tier that produced it. */
function materialize(
  plan: SelectionPlan,
  config: AppConfig,
  userKey: string | undefined,
): ResolvedLlm | undefined {
  if (plan.provider === "local") return localResolved(plan.model);
  if (plan.source === "user") {
    if (userKey === undefined || userKey.trim() === "") return undefined;
    const client =
      plan.provider === "openai"
        ? makeOpenAiClient({ model: plan.model, apiKey: userKey })
        : plan.provider === "gemini"
          ? makeGeminiClient({ model: plan.model, apiKey: userKey })
          : makeDeepseekClient({ model: plan.model, apiKey: userKey });
    return {
      client,
      provider: plan.provider,
      model: plan.model,
      source: "user",
      ...(plan.keyId !== undefined ? { keyId: plan.keyId } : {}),
    };
  }
  const provider = config.ai.providers.find((entry) => entry.id === plan.provider);
  if (!provider || provider.apiKey === undefined || provider.apiKey.trim() === "") {
    return undefined;
  }
  return {
    client: platformClient(provider),
    provider: provider.id,
    model: provider.model,
    source: "platform",
  };
}

/**
 * Platform-tier resolution (callers with no tenant context): platform keys in
 * config order, `DEFAULT_AI_PROVIDER` honoured as a preference, then the local
 * fallback when either fallback flag is on.
 */
export function resolveLlm(config: AppConfig, preferred?: string): ResolvedLlm | undefined {
  const plan = selectProviderPlan({
    platformProviders: platformCandidates(config.ai.providers),
    pin: preferred ?? config.env.DEFAULT_AI_PROVIDER,
    allowLocalFallback: config.ai.localLlmEnabled || config.ai.publicFallbackEnabled,
  });
  return plan ? materialize(plan, config, undefined) : undefined;
}

/**
 * Author-tier resolution: the author's own stored key wins when present, then
 * the platform chain, then the flag-gated fallback. Undecryptable or unknown
 * key rows are skipped (loadUserKeyCandidates logs and continues).
 */
export async function resolveLlmForUser(options: {
  readonly db: Database;
  readonly config: AppConfig;
  readonly userId: string;
  readonly preferred?: string;
  readonly logger?: { warn(obj: Record<string, unknown>, msg?: string): void };
}): Promise<ResolvedLlm | undefined> {
  const stored = await loadUserKeyCandidates(
    options.db,
    options.userId,
    options.config.encryption.keySecret,
    options.logger,
  );
  const userKeys: ProviderCandidate[] = stored.map((entry) => ({
    id: entry.provider,
    model: DEFAULT_MODELS[entry.provider as Exclude<ProviderId, "local">],
    apiKey: entry.apiKey,
    keyId: entry.keyId,
  }));
  const plan = selectProviderPlan({
    userKeys,
    platformProviders: platformCandidates(options.config.ai.providers),
    pin: options.preferred ?? options.config.env.DEFAULT_AI_PROVIDER,
    allowLocalFallback:
      options.config.ai.localLlmEnabled || options.config.ai.publicFallbackEnabled,
  });
  if (!plan) return undefined;
  const userKey =
    plan.source === "user"
      ? stored.find((entry) => entry.keyId === plan.keyId)?.apiKey
      : undefined;
  return materialize(plan, options.config, userKey);
}
