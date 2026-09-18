/**
 * @inkforge/ai — public surface.
 *
 * The AI layer is deliberately tiny: provider adapters behind one LlmClient
 * interface, plus hardened JSON extraction so structured generation never
 * crashes on chatty model output. Higher-level prompt modules live with their
 * owning features (forge worker, web server actions), not here.
 */
export {
  NoProviderError,
  ProviderError,
  type ChatCompletionResult,
  type ChatTransport,
  type CompletionOptions,
  type GeminiTransport,
  type LlmClient,
  type ProviderId,
  type TokenUsage,
} from "./types";
export {
  addUsage,
  clientForPlan,
  estimateCostMicros,
  makeLocalClient,
  selectProviderPlan,
  PROVIDER_PRICING,
  type ProviderCandidate,
  type ProviderPrice,
  type SelectionPlan,
  type SelectionRequest,
  type SelectionSource,
} from "./selection";
export {
  makeDeepseekClient,
  makeGeminiClient,
  makeOpenAiClient,
  type GeminiClientOptions,
  type OpenAiClientOptions,
} from "./providers";
export { extractJson, parseJsonResponse } from "./json";
