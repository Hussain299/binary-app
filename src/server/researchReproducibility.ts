/**
 * Deterministic research primitives.
 *
 * A research batch must be replayable from its batch ID and exact input dataset.
 * These helpers deliberately avoid process-global Math.random mutation.
 */

import { createHash } from "node:crypto";

export const FEATURE_SCHEMA_VERSION = "causal-market-features-v1";
export const RESEARCH_ENGINE_VERSION = "symbolic-evolution-v2";

/** Cryptographic digest for experiment IDs and audit fingerprints. */
export function stableHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Hash the complete canonical candle stream, including timestamp and provenance. */
export function fingerprintCandles(
  candles: ReadonlyArray<{
    symbol: string;
    timestampMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    source: string;
  }>
): string {
  const hash = createHash("sha256");
  for (const candle of candles) {
    hash.update([
      candle.symbol,
      String(candle.timestampMs),
      candle.open.toPrecision(15),
      candle.high.toPrecision(15),
      candle.low.toPrecision(15),
      candle.close.toPrecision(15),
      candle.volume.toPrecision(12),
      candle.source,
    ].join("|"), "utf8");
    hash.update("\n", "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Mulberry32 PRNG. The generator is local to a research run and returns values
 * in [0, 1), making candidate generation reproducible without global side effects.
 */
export function createSeededRandom(seed: string): () => number {
  if (!seed.trim()) throw new Error("A non-empty research seed is required.");
  const hex = stableHash(seed);
  let state = Number.parseInt(hex.slice(0, 8), 16) >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bind the random stream to the run, pair, exact dataset, and code protocol. */
export function deriveResearchSeed(
  batchId: string,
  symbol: string,
  datasetFingerprint: string
): string {
  if (!batchId.trim() || !symbol.trim() || !datasetFingerprint.trim()) {
    throw new Error("Batch ID, symbol, and dataset fingerprint are required to derive a research seed.");
  }
  return stableHash([
    "signalforge-research-seed-v1",
    batchId,
    symbol,
    datasetFingerprint,
    FEATURE_SCHEMA_VERSION,
    RESEARCH_ENGINE_VERSION,
  ].join("|"));
}
