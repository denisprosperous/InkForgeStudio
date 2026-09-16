import { describe, expect, it } from "vitest";
import { ConfigError, isPreviewAuth, loadConfig } from "../src/index";

const baseEnv = {
  NODE_ENV: "test" as const,
  DATABASE_URL: "postgres://user:pass@localhost:5432/inkforge",
};

describe("loadConfig", () => {
  it("applies documented defaults for an empty environment", () => {
    const config = loadConfig({ ...baseEnv });

    expect(config.port).toBe(4000);
    expect(config.forge.baseUrl).toBe("http://localhost:4000");
    expect(config.logLevel).toBe("info");
    expect(config.limits).toEqual({
      rateLimitPerMinute: 60,
      maxConcurrentJobsPerUser: 5,
      maxUploadMb: 20,
      exportUrlTtlSeconds: 900,
    });
    expect(config.flags).toEqual({
      allowFileUploads: true,
      allowCoverGeneration: true,
      allowLavishFormatting: true,
    });
    expect(config.ai.localLlmEnabled).toBe(false);
    expect(config.ai.publicFallbackEnabled).toBe(false);
  });

  it("resolves all three AI providers with configured models", () => {
    const config = loadConfig({
      ...baseEnv,
      OPENAI_API_KEY: "sk-openai",
      OPENAI_DEFAULT_MODEL: "gpt-4o-mini",
      DEEPSEEK_BASE_URL: "https://api.deepseek.example",
      DEEPSEEK_DEFAULT_MODEL: "deepseek-reasoner",
    });

    expect(config.ai.providers.map((provider) => provider.id)).toEqual([
      "openai",
      "gemini",
      "deepseek",
    ]);
    const openai = config.ai.providers.find((provider) => provider.id === "openai");
    const deepseek = config.ai.providers.find((provider) => provider.id === "deepseek");
    expect(openai?.apiKey).toBe("sk-openai");
    expect(openai?.model).toBe("gpt-4o-mini");
    expect(deepseek?.model).toBe("deepseek-reasoner");
    expect(deepseek?.baseUrl).toBe("https://api.deepseek.example");
  });

  it("reports Stack Auth as configured only with the full credential triple", () => {
    expect(loadConfig(baseEnv).stack.configured).toBe(false);
    expect(loadConfig({ ...baseEnv, NEXT_PUBLIC_STACK_PROJECT_ID: "proj" }).stack.configured).toBe(
      false,
    );
    expect(
      loadConfig({
        ...baseEnv,
        NEXT_PUBLIC_STACK_PROJECT_ID: "proj",
        NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: "pub",
        STACK_SECRET_SERVER_KEY: "secret",
      }).stack.configured,
    ).toBe(true);
  });

  it("coerces feature flags from strings and clamps numeric limits", () => {
    const config = loadConfig({
      ...baseEnv,
      ALLOW_FILE_UPLOADS: "0",
      ALLOW_LAVISH_FORMATTING: "off",
      PUBLIC_FALLBACK_ENABLED: "YES",
      MAX_UPLOAD_MB: "9999",
      FORGE_PORT: "0",
    });

    expect(config.flags.allowFileUploads).toBe(false);
    expect(config.flags.allowLavishFormatting).toBe(false);
    expect(config.ai.publicFallbackEnabled).toBe(true);
    expect(config.limits.maxUploadMb).toBe(512);
    expect(config.port).toBe(1);
  });

  it("rejects values outside the schema with a readable ConfigError", () => {
    expect(() => loadConfig({ ...baseEnv, LOG_LEVEL: "loud" })).toThrow(ConfigError);
  });

  it("freezes the returned config against mutation", () => {
    const config = loadConfig({ ...baseEnv });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.limits)).toBe(true);
  });
});

describe("isPreviewAuth", () => {
  it("uses preview auth when Stack is absent outside production", () => {
    const config = loadConfig({ ...baseEnv });
    expect(isPreviewAuth(config)).toBe(true);
  });

  it("never uses preview auth once Stack is configured", () => {
    const config = loadConfig({
      ...baseEnv,
      NEXT_PUBLIC_STACK_PROJECT_ID: "proj",
      NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: "pub",
      STACK_SECRET_SERVER_KEY: "secret",
    });
    expect(isPreviewAuth(config)).toBe(false);
  });

  it("refuses preview auth in production without Stack", () => {
    const config = loadConfig({ ...baseEnv, NODE_ENV: "production" });
    expect(isPreviewAuth(config)).toBe(false);
  });
});
