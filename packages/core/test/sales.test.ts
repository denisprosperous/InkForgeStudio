/**
 * G-22 — sales/royalty ingestion + the feedback loop into the market gate.
 *
 * Deterministic money maths in integer micro-USD (no floats in the ledger)
 * and a derived demand signal that can be fed straight back into the G-21
 * gate snapshot — that is the M9 -> M1 loop in one function.
 */
import { describe, expect, it } from "vitest";
import {
  deriveDemandSignal,
  evaluateMarketGate,
  salesRecordSchema,
  summarizeSales,
  type SalesRecord,
} from "@inkforge/core";

const RECORDS: SalesRecord[] = [
  {
    channel: "kdp",
    units: 100,
    revenueMicros: 499_000_000,
    royaltyMicros: 349_300_000,
    currency: "USD",
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-08-31T00:00:00.000Z",
  },
  {
    channel: "kdp",
    units: 50,
    revenueMicros: 249_500_000,
    royaltyMicros: 174_650_000,
    currency: "USD",
    periodStart: "2026-09-01T00:00:00.000Z",
    periodEnd: "2026-09-30T00:00:00.000Z",
  },
  {
    channel: "gumroad",
    units: 20,
    revenueMicros: 300_000_000,
    royaltyMicros: 300_000_000,
    currency: "USD",
    periodStart: "2026-09-01T00:00:00.000Z",
    periodEnd: "2026-09-30T00:00:00.000Z",
  },
];

describe("G-22 sales record contract", () => {
  it("normalizes currency and rejects negative money", () => {
    const record = salesRecordSchema.parse({
      channel: "kdp",
      units: 10,
      revenueMicros: 1_000,
      royaltyMicros: 700,
      currency: "usd",
      periodStart: "2026-09-01T00:00:00.000Z",
      periodEnd: "2026-09-30T00:00:00.000Z",
    });
    expect(record.currency).toBe("USD");
    expect(() =>
      salesRecordSchema.parse({
        channel: "kdp",
        units: -1,
        revenueMicros: 0,
        royaltyMicros: 0,
        periodStart: "2026-09-01T00:00:00.000Z",
        periodEnd: "2026-09-30T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("G-22 summary", () => {
  it("aggregates totals, royalty rate and per-channel split", () => {
    const summary = summarizeSales(RECORDS);
    expect(summary.totalUnits).toBe(170);
    expect(summary.totalRevenueMicros).toBe(1_048_500_000);
    expect(summary.totalRoyaltyMicros).toBe(823_950_000);
    expect(summary.royaltyRate).toBeCloseTo(823_950_000 / 1_048_500_000, 3);
    expect(summary.byChannel.map((row) => row.channel)).toEqual(["kdp", "gumroad"]);
    expect(summary.byChannel[0]?.units).toBe(150);
  });

  it("filters by period window deterministically", () => {
    const september = summarizeSales(RECORDS, { from: "2026-09-01T00:00:00.000Z" });
    expect(september.totalUnits).toBe(70);
    const august = summarizeSales(RECORDS, { to: "2026-08-31T23:59:59.000Z" });
    expect(august.totalUnits).toBe(100);
  });

  it("is empty-safe", () => {
    const summary = summarizeSales([]);
    expect(summary.totalUnits).toBe(0);
    expect(summary.royaltyRate).toBe(0);
    expect(summary.byChannel).toEqual([]);
  });
});

describe("G-22 feedback loop into the market gate", () => {
  it("derives a bounded demand signal with the record count as sample", () => {
    const signal = deriveDemandSignal(summarizeSales(RECORDS));
    expect(signal.demandScore).toBeGreaterThanOrEqual(0);
    expect(signal.demandScore).toBeLessThanOrEqual(100);
    expect(signal.sampleSize).toBe(3);
    expect(signal.rationale.length).toBeGreaterThan(0);
  });

  it("feeds the gate snapshot so sales can move a verdict", () => {
    const signal = deriveDemandSignal(summarizeSales(RECORDS));
    const gate = evaluateMarketGate({
      niche: "cozy fantasy baking",
      demandScore: signal.demandScore,
      competitionScore: 30,
      pricePower: 70,
      trendScore: 60,
      sampleSize: signal.sampleSize,
      source: "sales-ingest",
      capturedAt: "2026-10-01T00:00:00.000Z",
    });
    expect(["go", "hold", "no-go"]).toContain(gate.verdict);
    expect(gate.snapshot.source).toBe("sales-ingest");
  });

  it("keeps weak sellers out of a go verdict", () => {
    const weak = summarizeSales([
      {
        channel: "kdp",
        units: 1,
        revenueMicros: 499_000,
        royaltyMicros: 100_000,
        currency: "USD",
        periodStart: "2026-09-01T00:00:00.000Z",
        periodEnd: "2026-09-30T00:00:00.000Z",
      },
    ]);
    const signal = deriveDemandSignal(weak);
    expect(signal.demandScore).toBeLessThan(50);
  });
});
