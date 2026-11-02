import type { Candle } from '../types/index.js';
import { isLegacyFabricatedYahooFlatCandle } from './yahooCandles.ts';

const TRUSTED_MARKET_SOURCES = new Set(['biquote', 'dukascopy', 'yahoo', 'imported']);

/** Keep provider/imported observations separate from synthetic and known-fake legacy bars. */
export function getTrustedMarketCandles(candles: Candle[]): Candle[] {
  return candles
    .filter(candle =>
      TRUSTED_MARKET_SOURCES.has(candle.source) &&
      !isLegacyFabricatedYahooFlatCandle(candle)
    )
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

export function getLatestObservedCandle(candles: Candle[]): Candle | null {
  const trusted = getTrustedMarketCandles(candles);
  return trusted[trusted.length - 1] ?? null;
}

/**
 * Build a padded finite price domain. A minimum span prevents flat markets
 * from collapsing to a horizontal pixel and is scaled for JPY/non-JPY pairs.
 */
export function getMarketChartPriceDomain(
  candles: Candle[],
  isJpy: boolean,
): { min: number; max: number; range: number } | null {
  if (candles.length === 0) return null;

  const finitePrices = candles.flatMap(candle => [candle.low, candle.high])
    .filter(Number.isFinite);
  if (finitePrices.length === 0) return null;

  const rawMin = Math.min(...finitePrices);
  const rawMax = Math.max(...finitePrices);
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) return null;

  const minimumRange = isJpy ? 0.04 : 0.0004;
  const span = Math.max(rawMax - rawMin, minimumRange);
  const padding = span * 0.08;
  const centre = (rawMin + rawMax) / 2;
  const min = centre - span / 2 - padding;
  const max = centre + span / 2 + padding;
  const range = max - min;

  return Number.isFinite(range) && range > 0 ? { min, max, range } : null;
}
