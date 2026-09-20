/**
 * G-21 — niche & revenue intelligence (B3/C1): the deterministic pre-gen
 * market gate. Go/no-go BEFORE spend: generation jobs are blocked while the
 * gate says no-go. Pure scoring — the snapshot (demand/competition/price
 * power/trend + sample size) is supplied by the author or a later
 * ingestion; the engine never invents numbers.
 */
import { describe, expect, it } from "vitest";
import {
  GATE_VERSION,
  GO_THRESHOLD,
  HOLD_THRESHOLD,
  MIN_SAMPLE_SIZE,
  evaluateMarketGate,
  marketGateSchema,
  marketSnapshotSchema,
  type MarketSnapshot,
} from "@inkforge/core";

const SNAPSHOT: MarketSnapshot = {
  niche: "cozy fantasy baking",
  demandScore: 80,
  competitionScore: 30,
  pricePower: 70,
  trendScore: 60,
  sampleSize: 40,
  source: "manual",
  capturedAt: "2026-09-20T00:00:00.000Z",
};

describe("G-21 snapshot schema", () => {
  it("defaults the source and clamps scores to 0..100", () => {
    const snapshot = marketSnapshotSchema.parse({
      niche: "space westerns",
      demandScore: 120,
      competitionScore: -5,
      pricePower: 50,
      trendScore: 50,
      sampleSize: 1,
    });
    expect(snapshot.demandScore).toBe(100);
    expect(snapshot.competitionScore).toBe(0);
    expect(snapshot.source).toBe("manual");
  });

  it("rejects an empty niche", () => {
    expect(() => marketSnapshotSchema.parse({ niche: "", demandScore: 1 })).toThrow();
  });
});

describe("G-21 gate evaluation", () => {
  it("is a deterministic weighted composite", () => {
    // 0.4*80 + 0.2*(100-30) + 0.2*70 + 0.2*60 = 32 + 14 + 14 + 12 = 72
    const gate = evaluateMarketGate(SNAPSHOT);
    expect(gate.composite).toBe(72);
    expect(gate.verdict).toBe("go");
  });

  it("holds in the band between hold and go thresholds", () => {
    const gate = evaluateMarketGate({ ...SNAPSHOT, demandScore: 60 });
    // 24 + 14 + 14 + 12 = 64 < 65 -> hold
    expect(gate.composite).toBe(64);
    expect(gate.verdict).toBe("hold");
  });

  it("rejects a weak market as no-go and names the drivers", () => {
    const gate = evaluateMarketGate({
      ...SNAPSHOT,
      demandScore: 20,
      competitionScore: 85,
      pricePower: 20,
      trendScore: 20,
    });
    expect(gate.verdict).toBe("no-go");
    expect(gate.reasons.join(" ")).toContain("demand");
    expect(gate.reasons.join(" ")).toContain("competition");
  });

  it("withholds a go verdict while the sample is too small", () => {
    const gate = evaluateMarketGate({ ...SNAPSHOT, sampleSize: MIN_SAMPLE_SIZE - 1 });
    expect(gate.verdict).not.toBe("go");
    expect(gate.reasons.join(" ")).toContain("sample");
  });

  it("scales confidence with sample size and never exceeds 1", () => {
    expect(evaluateMarketGate({ ...SNAPSHOT, sampleSize: 10 }).confidence).toBeCloseTo(10 / 30, 2);
    expect(evaluateMarketGate({ ...SNAPSHOT, sampleSize: 300 }).confidence).toBe(1);
  });

  it("round-trips through the stored gate schema", () => {
    const gate = evaluateMarketGate(SNAPSHOT);
    expect(marketGateSchema.parse(gate)).toEqual(gate);
    expect(gate.gateVersion).toBe(GATE_VERSION);
  });

  it("keeps the thresholds coherent: hold band sits below go", () => {
    expect(HOLD_THRESHOLD).toBeLessThan(GO_THRESHOLD);
  });
});
