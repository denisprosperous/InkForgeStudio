/**
 * Adapter E-6 — international market adaptation.
 *
 * Per-market requirements the export must satisfy (units, currency, legal
 * notices, text direction, local numbering). Legal notices are returned as
 * verification tasks — the platform never writes jurisdiction-specific legal
 * language it cannot verify.
 */

export interface MarketProfile {
  readonly market: string;
  readonly label: string;
  readonly currency: string;
  readonly units: "metric" | "imperial";
  readonly direction: "ltr" | "rtl";
  readonly legalNotices: readonly string[];
}

export const MARKET_PROFILES: readonly MarketProfile[] = [
  {
    market: "US",
    label: "United States",
    currency: "USD",
    units: "imperial",
    direction: "ltr",
    legalNotices: [],
  },
  {
    market: "GB",
    label: "United Kingdom",
    currency: "GBP",
    units: "metric",
    direction: "ltr",
    legalNotices: [],
  },
  {
    market: "DE",
    label: "Germany",
    currency: "EUR",
    units: "metric",
    direction: "ltr",
    legalNotices: ["Impressum (publisher imprint) required for retail listings"],
  },
  {
    market: "JP",
    label: "Japan",
    currency: "JPY",
    units: "metric",
    direction: "ltr",
    legalNotices: ["Publisher and price must appear on the cover obi"],
  },
  {
    market: "SA",
    label: "Saudi Arabia",
    currency: "SAR",
    units: "metric",
    direction: "rtl",
    legalNotices: ["Right-to-left layout mandatory", "Content review notice for imported titles"],
  },
  {
    market: "BR",
    label: "Brazil",
    currency: "BRL",
    units: "metric",
    direction: "ltr",
    legalNotices: ["Consumer price must include local taxes (imposto) in listing"],
  },
];

export interface MarketAdaptation {
  readonly market: string;
  readonly marketLabel: string;
  readonly currency: string;
  readonly units: "metric" | "imperial";
  readonly direction: "ltr" | "rtl";
  readonly languageMatches: boolean;
  readonly requirements: readonly string[];
  readonly legalNoticesRequired: readonly { readonly notice: string; readonly verify: string }[];
}

export function buildMarketAdaptation(input: {
  readonly market: string;
  readonly bookLanguage: string;
}): MarketAdaptation {
  const profile = MARKET_PROFILES.find((entry) => entry.market === input.market);
  if (!profile) throw new Error(`unknown market: ${input.market}`);
  const languageMatches = input.bookLanguage === profile.market.toLowerCase();
  const requirements: string[] = [
    `units in ${profile.units}`,
    `pricing in ${profile.currency}`,
    profile.direction === "rtl"
      ? "right-to-left page order and mirrored margins"
      : "left-to-right flow",
  ];
  for (const notice of profile.legalNotices) requirements.push(`legal notice: ${notice}`);
  if (!languageMatches) {
    requirements.push(
      `translation package (G-30g) for ${profile.market} in the market language before export`,
    );
  }
  return {
    market: profile.market,
    marketLabel: profile.label,
    currency: profile.currency,
    units: profile.units,
    direction: profile.direction,
    languageMatches,
    requirements,
    legalNoticesRequired: profile.legalNotices.map((notice) => ({
      notice,
      verify: `confirm current ${profile.market} requirement with counsel before publishing`,
    })),
  };
}
