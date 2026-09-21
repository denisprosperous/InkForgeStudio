/**
 * G-22 — sales/royalty ingestion and the feedback loop into the G-21 gate.
 *
 * Deterministic money maths in integer micro-USD and a derived demand
 * signal that plugs straight into a market-gate snapshot (source:
 * "sales-ingest") — the M9 -> M1 loop, testable without a model call.
 */
import { z } from "zod";

export const salesRecordSchema = z.object({
  channel: z.string().trim().min(1).max(40),
  units: z.number().int().min(0).max(10_000_000),
  /** Gross revenue in micro-USD (1e-6 USD). */
  revenueMicros: z.number().int().min(0),
  /** Author royalty in micro-USD. */
  royaltyMicros: z.number().int().min(0),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .default("USD"),
  periodStart: z.string(),
  periodEnd: z.string(),
});
export type SalesRecord = z.infer<typeof salesRecordSchema>;

export interface ChannelSummary {
  readonly channel: string;
  readonly units: number;
  readonly revenueMicros: number;
  readonly royaltyMicros: number;
}

export interface SalesSummary {
  readonly records: number;
  readonly totalUnits: number;
  readonly totalRevenueMicros: number;
  readonly totalRoyaltyMicros: number;
  /** Royalty / revenue in 0..1 (0 when there is no revenue). */
  readonly royaltyRate: number;
  readonly byChannel: readonly ChannelSummary[];
}

/** Deterministic aggregate over sales records, optionally windowed. */
export function summarizeSales(
  records: readonly SalesRecord[],
  options: { readonly from?: string; readonly to?: string } = {},
): SalesSummary {
  const fromMs = options.from !== undefined ? Date.parse(options.from) : undefined;
  const toMs = options.to !== undefined ? Date.parse(options.to) : undefined;
  const selected = records.filter((record) => {
    const start = Date.parse(record.periodStart);
    if (fromMs !== undefined && Number.isFinite(fromMs) && start < fromMs) return false;
    if (toMs !== undefined && Number.isFinite(toMs) && start > toMs) return false;
    return true;
  });

  const byChannelMap = new Map<string, ChannelSummary>();
  let totalUnits = 0;
  let totalRevenueMicros = 0;
  let totalRoyaltyMicros = 0;
  for (const record of selected) {
    totalUnits += record.units;
    totalRevenueMicros += record.revenueMicros;
    totalRoyaltyMicros += record.royaltyMicros;
    const current = byChannelMap.get(record.channel) ?? {
      channel: record.channel,
      units: 0,
      revenueMicros: 0,
      royaltyMicros: 0,
    };
    byChannelMap.set(record.channel, {
      channel: record.channel,
      units: current.units + record.units,
      revenueMicros: current.revenueMicros + record.revenueMicros,
      royaltyMicros: current.royaltyMicros + record.royaltyMicros,
    });
  }

  return {
    records: selected.length,
    totalUnits,
    totalRevenueMicros,
    totalRoyaltyMicros,
    royaltyRate:
      totalRevenueMicros === 0
        ? 0
        : Math.round((totalRoyaltyMicros / totalRevenueMicros) * 10_000) / 10_000,
    byChannel: [...byChannelMap.values()].sort(
      (a, b) => b.revenueMicros - a.revenueMicros || a.channel.localeCompare(b.channel),
    ),
  };
}

export interface DemandSignal {
  /** 0..100, ready for a market snapshot's demandScore. */
  readonly demandScore: number;
  /** Observations behind the signal — feeds the gate's sample-size rule. */
  readonly sampleSize: number;
  readonly rationale: readonly string[];
}

/** Baseline revenue (micro-USD) that maps to a mid-strength demand signal. */
const DEMAND_BASELINE_MICROS = 200_000_000;
/** Units that map to a mid-strength demand signal. */
const DEMAND_BASELINE_UNITS = 60;

/**
 * Deterministic sales -> demand signal. Half the score comes from units
 * (capped at 2x baseline) and half from royalty revenue; a healthy royalty
 * rate adds a small bonus. Weak sellers stay under the gate's hold band.
 */
export function deriveDemandSignal(summary: SalesSummary): DemandSignal {
  const unitScore = Math.min(1, summary.totalUnits / (DEMAND_BASELINE_UNITS * 2));
  const revenueScore = Math.min(1, summary.totalRoyaltyMicros / (DEMAND_BASELINE_MICROS * 2));
  const royaltyBonus = summary.royaltyRate >= 0.5 ? 0.05 : 0;
  const demandScore = Math.round(
    Math.min(1, 0.5 * unitScore + 0.5 * revenueScore + royaltyBonus) * 100,
  );
  const rationale: string[] = [
    `${summary.totalUnits} units across ${summary.records} periods`,
    `royalty ${(summary.totalRoyaltyMicros / 1_000_000).toFixed(2)} USD at rate ${summary.royaltyRate}`,
  ];
  if (summary.byChannel.length > 0 && summary.byChannel[0]) {
    rationale.push(`best channel ${summary.byChannel[0].channel}`);
  }
  return { demandScore, sampleSize: summary.records, rationale };
}
