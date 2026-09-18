/**
 * G-08 — provider precedence + cost capture.
 *
 * The selection helper is pure, so the whole precedence matrix is asserted
 * here without a network or a database. The cost estimator is checked against
 * hand-computed micro-USD, and usage passthrough is proven with a fake
 * transport (the same seam the adapters already use in tests).
 */
import { describe, expect, it } from "vitest";
import {
  addUsage,
  clientForPlan,
  estimateCostMicros,
  makeLocalClient,
  makeOpenAiClient,
  NoProviderError,
  selectProviderPlan,
} from "../src/index";

const USER = { id: "openai" as const, model: "gpt-user", apiKey: "sk-user", keyId: "key-1" };
const PLATFORM = { id: "deepseek" as const, model: "deepseek-chat", apiKey: "sk-platform" };

describe("provider selection precedence (G-08)", () => {
  it("prefers the author's own key over the platform key", () => {
    const plan = selectProviderPlan({ userKeys: [USER], platformProviders: [PLATFORM] });
    expect(plan).toMatchObject({ source: "user", provider: "openai", keyId: "key-1" });
  });

  it("falls back to the platform key when the author has none", () => {
    expect(selectProviderPlan({ platformProviders: [PLATFORM] })).toEqual({
      source: "platform",
      provider: "deepseek",
      model: "deepseek-chat",
    });
  });

  it("ignores candidates without credentials inside a tier", () => {
    const plan = selectProviderPlan({
      userKeys: [{ id: "gemini", model: "gemini-2.5-pro" }],
      platformProviders: [PLATFORM],
    });
    expect(plan?.source).toBe("platform");
  });

  it("honours the pin within a tier and falls through when the pin is unusable", () => {
    const platform = [
      { id: "openai" as const, model: "gpt-4o", apiKey: "a" },
      { id: "gemini" as const, model: "gemini-2.5-pro", apiKey: "b" },
    ];
    expect(selectProviderPlan({ platformProviders: platform, pin: "gemini" })?.provider).toBe(
      "gemini",
    );
    expect(selectProviderPlan({ platformProviders: platform, pin: "deepseek" })?.provider).toBe(
      "openai",
    );
  });

  it("offers the local fallback only when the flag is on", () => {
    expect(selectProviderPlan({ allowLocalFallback: false })).toBeUndefined();
    expect(selectProviderPlan({ allowLocalFallback: true })).toEqual({
      source: "local",
      provider: "local",
      model: "local-deterministic",
    });
  });
});

describe("local fallback client (G-08)", () => {
  it("is deterministic and answers JSON prompts with parseable JSON", async () => {
    const client = makeLocalClient();
    const first = await client.complete("Return JSON about the lighthouse premise");
    const second = await client.complete("Return JSON about the lighthouse premise");
    expect(first.text).toBe(second.text);
    expect(() => JSON.parse(first.text) as unknown).not.toThrow();
    expect(client.provider).toBe("local");
  });

  it("meters itself so cost capture never sees undefined usage", async () => {
    const client = makeLocalClient();
    const result = await client.complete("A quiet room and a machine");
    expect(result.usage?.promptTokens).toBeGreaterThan(0);
    expect(estimateCostMicros("local", result.usage)).toBe(0);
  });
});

describe("cost capture (G-08)", () => {
  it("converts token usage to integer micro-USD per provider price list", () => {
    // 1M input @ $2.5 + 1M output @ $10 = $12.5 = 12_500_000 micros
    expect(
      estimateCostMicros("openai", { promptTokens: 1_000_000, completionTokens: 1_000_000 }),
    ).toBe(12_500_000);
    expect(estimateCostMicros("deepseek", { promptTokens: 0, completionTokens: 0 })).toBe(0);
    expect(estimateCostMicros("gemini", undefined)).toBe(0);
  });

  it("sums usage across calls without inventing values", () => {
    expect(addUsage(undefined, { promptTokens: 3, completionTokens: 4 })).toEqual({
      promptTokens: 3,
      completionTokens: 4,
    });
    expect(
      addUsage({ promptTokens: 1, completionTokens: 2 }, { promptTokens: 10, completionTokens: 20 }),
    ).toEqual({ promptTokens: 11, completionTokens: 22 });
  });

  it("passes vendor-reported usage through the adapter", async () => {
    const client = makeOpenAiClient({
      model: "gpt-4o",
      apiKey: "sk-test",
      transport: {
        create: async () => ({
          choices: [{ message: { content: "A scene." } }],
          usage: { prompt_tokens: 120, completion_tokens: 340 },
        }),
      },
    });
    const result = await client.complete("draft a scene");
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 340 });
    expect(estimateCostMicros(result.provider, result.usage)).toBe(
      120 * 2.5 + 340 * 10, // micros: 300 + 3400
    );
  });

  it("refuses to build a keyed client for a plan without a key", () => {
    expect(() =>
      clientForPlan(
        { source: "user", provider: "openai", model: "gpt-4o" },
        {
          openai: () => makeLocalClient(),
          gemini: () => makeLocalClient(),
          deepseek: () => makeLocalClient(),
        },
      ),
    ).toThrow(NoProviderError);
  });
});