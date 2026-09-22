/**
 * G-30h — cross-market price arbitrage signals.
 *
 * Compares each market's price against a demand-weighted reference and flags
 * markets priced materially below it. With fewer than `minMarkets` data
 * points the honest status is "insufficient-data" — the platform never
 * invents a market position.
 */

export interface MarketPricePoint {
  readonly market: string;
  readonly currency: string;
  readonly priceCents: number;
  /** 0..100 demand index supplied by the caller (never derived here). */
  readonly demandIndex: number;
}

export interface ArbitrageSignal {
  readonly market: string;
  readonly priceCents: number;
  readonly referencePriceCents: number;
  readonly gapPercent: number;
  readonly reason: string;
}

export interface ArbitrageReport {
  readonly status: "ok" | "insufficient-data";
  readonly referencePriceCents: number;
  readonly signals: readonly ArbitrageSignal[];
}

export function findPriceArbitrage(
  points: readonly MarketPricePoint[],
  options: { readonly minMarkets?: number; readonly gapPercent?: number } = {},
): ArbitrageReport {
  const minMarkets = options.minMarkets ?? 3;
  const gapPercent = options.gapPercent ?? 20;
  if (points.length < minMarkets) {
    return { status: "insufficient-data", referencePriceCents: 0, signals: [] };
  }
  const demandTotal = points.reduce((total, point) => total + Math.max(0, point.demandIndex), 0);
  const referencePriceCents =
    demandTotal === 0
      ? Math.round(points.reduce((total, point) => total + point.priceCents, 0) / points.length)
      : Math.round(
          points.reduce(
            (total, point) =>
              total + point.priceCents * (Math.max(0, point.demandIndex) / demandTotal),
            0,
          ),
        );
  const signals: ArbitrageSignal[] = [];
  for (const point of points) {
    if (referencePriceCents === 0) continue;
    const gap = ((referencePriceCents - point.priceCents) / referencePriceCents) * 100;
    if (gap >= gapPercent) {
      signals.push({
        market: point.market,
        priceCents: point.priceCents,
        referencePriceCents,
        gapPercent: Math.round(gap * 10) / 10,
        reason: `${Math.round(gap * 10) / 10}% below reference ${referencePriceCents} (${point.currency})`,
      });
    }
  }
  signals.sort((a, b) => b.gapPercent - a.gapPercent || a.market.localeCompare(b.market));
  return { status: "ok", referencePriceCents, signals };
}
