/**
 * G-21 — niche & revenue intelligence v1 (B3/C1): the deterministic pre-gen
 * market gate.
 *
 * Go/no-go BEFORE spend: the snapshot (demand, competition, price power,
 * trend, sample size) is supplied by the author or a future ingestion — the
 * engine never invents numbers. The verdict is a pure function of the
 * snapshot, stored under meta.extra.marketGate (G-13 namespacing), and the
 * forge refuses generation jobs for books whose gate says no-go.
 */
import { z } from "zod";

export const GATE_VERSION = 1;
/** Composite at or above this is a go — provided the sample is big enough. */
export const GO_THRESHOLD = 65;
/** Composite below this is a no-go; in between is hold. */
export const HOLD_THRESHOLD = 50;
/** Snapshot observations required before a go verdict is allowed. */
export const MIN_SAMPLE_SIZE = 10;

/** Market scores are clamped into 0..100 — out-of-range inputs degrade, not throw. */
const SCORE = z.number().transform((value) => Math.min(100, Math.max(0, value)));

export const marketSnapshotSchema = z.object({
  niche: z.string().trim().min(1).max(120),
  demandScore: SCORE,
  /** 0 = wide open, 100 = saturated — inverted inside the composite. */
  competitionScore: SCORE,
  pricePower: SCORE,
  trendScore: SCORE,
  sampleSize: z.number().int().min(0),
  /** Where the snapshot came from (manual import, ingestion pipeline, ...). */
  source: z.string().trim().min(1).max(64).default("manual"),
  capturedAt: z.string().default("1970-01-01T00:00:00.000Z"),
});
export type MarketSnapshot = z.infer<typeof marketSnapshotSchema>;

export type MarketVerdict = "go" | "hold" | "no-go";

export const marketGateSchema = z.object({
  verdict: z.enum(["go", "hold", "no-go"]),
  composite: SCORE,
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1).max(300)).max(12),
  snapshot: marketSnapshotSchema,
  gateVersion: z.number().int().min(1).default(GATE_VERSION),
  evaluatedAt: z.string().default("1970-01-01T00:00:00.000Z"),
});
export type MarketGate = z.infer<typeof marketGateSchema>;

/** Key inside meta.extra where the verdict is stored (G-13 namespacing). */
export const MARKET_GATE_EXTRA_KEY = "marketGate";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Deterministic gate: composite = 0.4*demand + 0.2*(100-competition)
 * + 0.2*pricePower + 0.2*trend. go at >= GO_THRESHOLD, no-go at
 * < HOLD_THRESHOLD, hold between — and never a go while the sample is
 * below MIN_SAMPLE_SIZE (hold instead).
 */
export function evaluateMarketGate(input: MarketSnapshot): MarketGate {
  const snapshot = marketSnapshotSchema.parse(input);
  const composite = round2(
    0.4 * snapshot.demandScore +
      0.2 * (100 - snapshot.competitionScore) +
      0.2 * snapshot.pricePower +
      0.2 * snapshot.trendScore,
  );
  const confidence = round2(Math.min(1, snapshot.sampleSize / (MIN_SAMPLE_SIZE * 3)));
  const reasons: string[] = [];
  if (snapshot.demandScore >= 70) reasons.push(`demand ${snapshot.demandScore} is strong`);
  else if (snapshot.demandScore < 40) reasons.push(`demand ${snapshot.demandScore} is weak`);
  if (snapshot.competitionScore >= 70)
    reasons.push(`competition ${snapshot.competitionScore} is high`);
  else if (snapshot.competitionScore <= 30)
    reasons.push(`competition ${snapshot.competitionScore} is low`);
  if (snapshot.pricePower < 40) reasons.push(`price power ${snapshot.pricePower} is weak`);
  if (snapshot.trendScore < 40) reasons.push(`trend ${snapshot.trendScore} is fading`);
  let verdict: MarketVerdict;
  if (composite >= GO_THRESHOLD && snapshot.sampleSize >= MIN_SAMPLE_SIZE) {
    verdict = "go";
    reasons.unshift(`composite ${composite} >= go threshold ${GO_THRESHOLD}`);
  } else if (composite < HOLD_THRESHOLD) {
    verdict = "no-go";
    reasons.unshift(`composite ${composite} < hold threshold ${HOLD_THRESHOLD}`);
  } else {
    verdict = "hold";
    reasons.unshift(`composite ${composite} is inside the hold band`);
    if (snapshot.sampleSize < MIN_SAMPLE_SIZE) {
      reasons.push(
        `sample too small (${snapshot.sampleSize} < ${MIN_SAMPLE_SIZE}) for a go verdict`,
      );
    }
  }
  return marketGateSchema.parse({
    verdict,
    composite,
    confidence,
    reasons: reasons.slice(0, 12),
    snapshot,
    gateVersion: GATE_VERSION,
    evaluatedAt: "1970-01-01T00:00:00.000Z",
  });
}
