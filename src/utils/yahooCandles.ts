import type { Candle, ForexSymbol } from '../types/index.ts';

export interface YahooNormalizationResult {
  candles: Candle[];
  inputRows: number;
  rejectedRows: number;
  missingVolumeRows: number;
  zeroRangeRows: number;
}

/**
 * Yahoo can return timestamp/close-only rows for some FX intervals.
 * Never synthesize Open/High/Low from Close: doing so creates fake doji candles.
 */
export function normalizeYahooChartCandles(
  symbol: ForexSymbol,
  chartResult: any,
): YahooNormalizationResult {
  const timestamps: unknown[] = Array.isArray(chartResult?.timestamp) ? chartResult.timestamp : [];
  const quote = chartResult?.indicators?.quote?.[0] ?? {};
  const opens: unknown[] = Array.isArray(quote.open) ? quote.open : [];
  const highs: unknown[] = Array.isArray(quote.high) ? quote.high : [];
  const lows: unknown[] = Array.isArray(quote.low) ? quote.low : [];
  const closes: unknown[] = Array.isArray(quote.close) ? quote.close : [];
  const volumes: unknown[] = Array.isArray(quote.volume) ? quote.volume : [];

  const candles: Candle[] = [];
  let rejectedRows = 0;
  let missingVolumeRows = 0;
  let zeroRangeRows = 0;

  const toFiniteNumber = (value: unknown): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : NaN;
    }
    return NaN;
  };

  for (let i = 0; i < timestamps.length; i++) {
    const rawTimestamp = toFiniteNumber(timestamps[i]);
    const timestampMs = rawTimestamp * 1000;
    const date = new Date(timestampMs);
    const open = toFiniteNumber(opens[i]);
    const high = toFiniteNumber(highs[i]);
    const low = toFiniteNumber(lows[i]);
    const close = toFiniteNumber(closes[i]);

    // All four OHLC values must be supplied by Yahoo and pass the candle
    // envelope. Close-only records are not candlesticks and are rejected.
    if (
      !Number.isFinite(timestampMs) ||
      !Number.isFinite(date.getTime()) ||
      rawTimestamp <= 0 ||
      ![open, high, low, close].every(value => Number.isFinite(value) && value > 0) ||
      high < Math.max(open, close, low) ||
      low > Math.min(open, close, high)
    ) {
      rejectedRows++;
      continue;
    }

    const rawVolume = toFiniteNumber(volumes[i]);
    if (!Number.isFinite(rawVolume) || rawVolume < 0) missingVolumeRows++;
    const volume = Number.isFinite(rawVolume) && rawVolume >= 0 ? rawVolume : 0;
    if (high === low) zeroRangeRows++;

    candles.push({
      symbol,
      timestamp: date.toISOString(),
      timestampMs,
      open,
      high,
      low,
      close,
      volume,
      source: 'yahoo',
    });
  }

  const deduplicated = new Map<number, Candle>();
  for (const candle of candles) deduplicated.set(candle.timestampMs, candle);

  return {
    candles: Array.from(deduplicated.values()).sort((a, b) => a.timestampMs - b.timestampMs),
    inputRows: timestamps.length,
    rejectedRows,
    missingVolumeRows,
    zeroRangeRows,
  };
}

/**
 * The previous normalizer used volume=150 as a placeholder while also filling
 * missing O/H/L from Close. Exclude those already-persisted fake flat bars.
 * Genuine flat candles from other feeds and real Yahoo candles are unaffected.
 */
export function isLegacyFabricatedYahooFlatCandle(candle: Candle): boolean {
  return candle.source === 'yahoo' &&
    candle.volume === 150 &&
    candle.open === candle.high &&
    candle.high === candle.low &&
    candle.low === candle.close;
}
