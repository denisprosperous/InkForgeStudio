/**
 * @inkforge/ai — vendor-agnostic LLM access for the studio.
 *
 * Providers are OpenAI-compatible (OpenAI, DeepSeek) or Gemini, selected per
 * request with an explicit precedence: the author's own stored key first, then
 * the platform key, then (flag-gated) the deterministic local fallback so the
 * whole studio pipeline stays operable without any API keys at all.
 */

export type ProviderId = "openai" | "gemini" | "deepseek" | "local";

export interface CompletionOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
}

/** Minimal OpenAI-compatible wire shape; providers adapt their SDKs to this. */
export interface ChatCompletionResult {
  readonly text: string;
  readonly provider: ProviderId;
  readonly model: string;
}

export interface ChatTransport {
  create(request: {
    model: string;
    messages: ReadonlyArray<{ role: string; content: string }>;
    temperature?: number;
    max_tokens?: number;
    response_format?: { type: "json_object" };
    signal?: AbortSignal;
  }): Promise<{ choices?: ReadonlyArray<{ message?: { content?: string | null } }> }>;
}

export interface GeminiTransport {
  generate(request: {
    model: string;
    prompt: string;
    temperature?: number;
    maxOutputTokens?: number;
    json: boolean;
    signal?: AbortSignal;
  }): Promise<{ text?: string }>;
}

export interface LlmClient {
  readonly provider: ProviderId;
  readonly model: string;
  complete(prompt: string, options?: CompletionOptions): Promise<ChatCompletionResult>;
}

export class ProviderError extends Error {
  public readonly provider: ProviderId;
  public constructor(provider: ProviderId, message: string, cause?: unknown) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
    this.provider = provider;
    if (cause !== undefined) this.cause = cause;
  }
}

export class NoProviderError extends Error {
  public constructor() {
    super("No AI provider is configured — add an API key or enable the public fallback.");
    this.name = "NoProviderError";
  }
}
