/**
 * Adapter E-6 — international market adaptation: per-market requirements the
 * export must satisfy (units, currency, legal notices, direction, numbering).
 */
import { describe, expect, it } from "vitest";
import { MARKET_PROFILES, buildMarketAdaptation } from "@inkforge/core";

describe("E-6 international market adapter", () => {
  it("declares profiles with legal, currency and direction metadata", () => {
    const markets = MARKET_PROFILES.map((profile) => profile.market);
    expect(markets).toContain("DE");
    expect(markets).toContain("JP");
    expect(markets).toContain("SA");
    const saudi = MARKET_PROFILES.find((profile) => profile.market === "SA")!;
    expect(saudi.direction).toBe("rtl");
  });

  it("builds an adaptation pack with requirements and metrics units", () => {
    const pack = buildMarketAdaptation({ market: "DE", bookLanguage: "de" });
    expect(pack.market).toBe("DE");
    expect(pack.currency).toBe("EUR");
    expect(pack.units).toBe("metric");
    expect(pack.requirements.join(" ")).toContain("imprint");
    expect(pack.languageMatches).toBe(true);
  });

  it("flags a language mismatch instead of assuming translation", () => {
    const pack = buildMarketAdaptation({ market: "JP", bookLanguage: "en" });
    expect(pack.languageMatches).toBe(false);
    expect(pack.requirements.join(" ")).toContain("translation package (G-30g)");
  });

  it("requires a verified legal notice where the market mandates one", () => {
    const pack = buildMarketAdaptation({ market: "SA", bookLanguage: "ar" });
    expect(pack.legalNoticesRequired.length).toBeGreaterThan(0);
    expect(pack.legalNoticesRequired.every((notice) => notice.verify.length > 0)).toBe(true);
  });

  it("rejects unknown markets and is deterministic", () => {
    expect(() => buildMarketAdaptation({ market: "ZZ", bookLanguage: "en" })).toThrow();
    const input = { market: "DE", bookLanguage: "de" } as const;
    expect(buildMarketAdaptation(input)).toEqual(buildMarketAdaptation(input));
  });
});
