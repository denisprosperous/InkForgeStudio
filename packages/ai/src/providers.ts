/**
 * Concrete provider adapters. Each wraps its SDK behind the same LlmClient
 * interface and accepts an injectable transport so unit tests run offline.
 */
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import {
  ProviderError,
  type ChatTransport,
  type CompletionOptions,
  type GeminiTransport,
  type LlmClient,
  type ProviderId,
} from "./types";

interface ChatClientShape {
  chat: {
    completions: ChatTransport;
  };
}

export interface OpenAiClientOptions {
  readonly model: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
  /** Test seam: inject a fake chat transport instead of the real SDK. */
  readonly transport?: ChatTransport;
}

function chatClient(
  provider: ProviderId,
  options: OpenAiClientOptions,
): { transport: ChatTransport; model: string } {
  const transport: ChatTransport =
    options.transport ??
    (new OpenAI({ apiKey: options.apiKey, baseURL: options.baseUrl }) as unknown as ChatClientShape)
      .chat.completions;
  return { transport, model: options.model };
}

/** Shared OpenAI-compatible completion path (OpenAI + DeepSeek). */
function openAiCompatible(provider: ProviderId, options: OpenAiClientOptions): LlmClient {
  const { transport, model } = chatClient(provider, options);
  return {
    provider,
    model,
    async complete(prompt: string, completion: CompletionOptions = {}) {
      try {
        const response = await transport.create({
          model,
          messages: [{ role: "user", content: prompt }],
          ...(completion.temperature !== undefined ? { temperature: completion.temperature } : {}),
          ...(completion.maxTokens !== undefined ? { max_tokens: completion.maxTokens } : {}),
          ...(completion.signal !== undefined ? { signal: completion.signal } : {}),
        });
        const text = response.choices?.[0]?.message?.content ?? "";
        if (text.trim() === "") {
          throw new ProviderError(provider, "Empty completion");
        }
        const usage = response.usage
          ? {
              promptTokens: response.usage.prompt_tokens ?? 0,
              completionTokens: response.usage.completion_tokens ?? 0,
            }
          : undefined;
        return {
          text,
          provider,
          model,
          ...(usage !== undefined ? { usage } : {}),
        };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError(
          provider,
          error instanceof Error ? error.message : String(error),
          error,
        );
      }
    },
  };
}

export function makeOpenAiClient(options: OpenAiClientOptions): LlmClient {
  return openAiCompatible("openai", options);
}

export function makeDeepseekClient(options: OpenAiClientOptions): LlmClient {
  return openAiCompatible("deepseek", {
    ...options,
    baseUrl: options.baseUrl ?? "https://api.deepseek.com",
  });
}

export interface GeminiClientOptions {
  readonly model: string;
  readonly apiKey: string;
  /** Test seam: inject a fake transport instead of the real SDK. */
  readonly transport?: GeminiTransport;
}

/** Minimal structural view of @google/genai's client we rely on at runtime. */
interface GeminiSdkShape {
  models: {
    generateContent(request: {
      model: string;
      contents: string;
      config?: {
        temperature?: number;
        maxOutputTokens?: number;
        abortSignal?: AbortSignal;
        responseMimeType?: string;
      };
    }): Promise<{ text?: string }>;
  };
}

/** Adapt the real SDK client onto our transport seam (keeps tests offline). */
function sdkTransport(client: GeminiSdkShape): GeminiTransport {
  return {
    async generate(request) {
      const response = await client.models.generateContent({
        model: request.model,
        contents: request.prompt,
        config: {
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxOutputTokens !== undefined
            ? { maxOutputTokens: request.maxOutputTokens }
            : {}),
          ...(request.signal !== undefined ? { abortSignal: request.signal } : {}),
          ...(request.json ? { responseMimeType: "application/json" } : {}),
        },
      });
      return response.text === undefined ? {} : { text: response.text };
    },
  };
}

export function makeGeminiClient(options: GeminiClientOptions): LlmClient {
  const transport: GeminiTransport =
    options.transport ??
    sdkTransport(new GoogleGenAI({ apiKey: options.apiKey }) as unknown as GeminiSdkShape);
  return {
    provider: "gemini",
    model: options.model,
    async complete(prompt: string, completion: CompletionOptions = {}) {
      try {
        const response = await transport.generate({
          model: options.model,
          prompt,
          ...(completion.temperature !== undefined ? { temperature: completion.temperature } : {}),
          ...(completion.maxTokens !== undefined ? { maxOutputTokens: completion.maxTokens } : {}),
          json: false,
          ...(completion.signal !== undefined ? { signal: completion.signal } : {}),
        });
        const text = response.text ?? "";
        if (text.trim() === "") {
          throw new ProviderError("gemini", "Empty completion");
        }
        const usage = response.usageMetadata
          ? {
              promptTokens: response.usageMetadata.promptTokenCount ?? 0,
              completionTokens: response.usageMetadata.candidatesTokenCount ?? 0,
            }
          : undefined;
        return {
          text,
          provider: "gemini",
          model: options.model,
          ...(usage !== undefined ? { usage } : {}),
        };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError(
          "gemini",
          error instanceof Error ? error.message : String(error),
          error,
        );
      }
    },
  };
}
