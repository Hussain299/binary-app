import { createHash } from 'node:crypto';
import type { Candle } from '../types/index.ts';

export const FEATURE_SCHEMA_VERSION = 'causal-market-features-v1';
export const RESEARCH_ENGINE_VERSION = 'research-engine-v1';

export function stableHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Creates a deterministic PRNG producing floats in [0, 1) using mulberry32.
 */
export function createSeededRandom(seed: string): () => number {
  const hash = stableHash(seed);
  let state = parseInt(hash.slice(0, 8), 16) >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fingerprintCandles(candles: Candle[]): string {
  const simplified = candles.map(c => [
    c.timestampMs,
    c.open,
    c.high,
    c.low,
    c.close,
    c.volume,
  ]);
  return stableHash(JSON.stringify(simplified));
}

export function deriveResearchSeed(batchId: string, symbol: string, fingerprint: string): string {
  return stableHash(`${batchId}|${symbol}|${fingerprint}`);
}
