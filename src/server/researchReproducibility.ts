/**
 * Deterministic research primitives.
 *
 * A research batch must be replayable from its batch ID and exact input dataset.
 * These helpers deliberately avoid process-global Math.random mutation.
 */

export const FEATURE_SCHEMA_VERSION = "causal-market-features-v1";
export const RESEARCH_ENGINE_VERSION = "symbolic-evolution-v2";

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

/** Stable 64-bit FNV-1a hash for experiment IDs and dataset fingerprints. */
export function stableHash(value: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Hash the complete canonical candle stream, including provenance. */
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
  let hash = FNV_OFFSET_BASIS;
  const update = (value: string) => {
    for (let index = 0; index < value.length; index++) {
      hash ^= BigInt(value.charCodeAt(index));
      hash = (hash * FNV_PRIME) & UINT64_MASK;
    }
    hash ^= 10n; // newline delimiter
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  };

  for (const candle of candles) {
    update([
      candle.symbol,
      String(candle.timestampMs),
      candle.open.toPrecision(15),
      candle.high.toPrecision(15),
      candle.low.toPrecision(15),
      candle.close.toPrecision(15),
      candle.volume.toPrecision(12),
      candle.source,
    ].join("|"));
  }

  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
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

/** Bind the random stream to the run, symbol, dataset, and code protocol. */
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
