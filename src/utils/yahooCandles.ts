import type { Candle, ForexSymbol } from '../types/index.ts';

export interface YahooCloseObservation {
  timestamp: string;
  timestampMs: number;
  close: number;
  source: 'yahoo-close-only';
}

export interface YahooNormalizationResult {
  candles: Candle[];
  closeOnlyObservations: YahooCloseObservation[];
  inputRows: number;
  rejectedRows: number;
  missingVolumeRows: number;
  zeroRangeRows: number;
  isCollapsedQuoteSeries: boolean;
}

interface ParsedYahooRow {
  timestamp: string;
  timestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  hasFullOhlc: boolean;
  zeroRange: boolean;
}

/**
 * Yahoo FX minute bars can be syntactically complete while carrying only one
 * sampled quote: O=H=L=C. A batch-level test distinguishes this feed shape from
 * an isolated, legitimate doji in a real OHLC series.
 */
export function isCollapsedYahooQuoteCandleBatch(candles: Candle[]): boolean {
  const yahooRows = candles.filter(candle => candle.source === 'yahoo');
  if (yahooRows.length < 3) return false;
  const zeroRangeRows = yahooRows.filter(candle => candle.high === candle.low).length;
  return zeroRangeRows / yahooRows.length >= 0.75;
}

/**
 * Normalize provider data without manufacturing OHLC or volume.
 *
 * If at least 75% of a batch of three or more structurally complete Yahoo rows
 * have High===Low, the entire batch is treated as close-only observations.
 * This preserves isolated dojis in otherwise genuine OHLC data.
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

  const rows: ParsedYahooRow[] = [];
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
    const hasUsableTimestamp =
      Number.isFinite(timestampMs) &&
      Number.isFinite(date.getTime()) &&
      rawTimestamp > 0;

    if (!hasUsableTimestamp) {
      rejectedRows++;
      continue;
    }

    const open = toFiniteNumber(opens[i]);
    const high = toFiniteNumber(highs[i]);
    const low = toFiniteNumber(lows[i]);
    const close = toFiniteNumber(closes[i]);
    const hasPositiveClose = Number.isFinite(close) && close > 0;
    const hasFullOhlc =
      hasPositiveClose &&
      [open, high, low].every(value => Number.isFinite(value) && value > 0) &&
      high >= Math.max(open, close, low) &&
      low <= Math.min(open, close, high);

    const rawVolume = toFiniteNumber(volumes[i]);
    // Yahoo reports 0/null for spot FX where centralized traded volume is not
    // available. Keep 0 internally, count it as unavailable, and display N/A.
    const hasReportedVolume = Number.isFinite(rawVolume) && rawVolume > 0;
    if (!hasReportedVolume) missingVolumeRows++;
    const volume = hasReportedVolume ? rawVolume : 0;

    if (!hasFullOhlc) {
      rejectedRows++;
      if (hasPositiveClose) {
        rows.push({
          timestamp: date.toISOString(),
          timestampMs,
          open: NaN,
          high: NaN,
          low: NaN,
          close,
          volume,
          hasFullOhlc: false,
          zeroRange: false,
        });
      }
      continue;
    }

    const zeroRange = high === low;
    if (zeroRange) zeroRangeRows++;
    rows.push({
      timestamp: date.toISOString(),
      timestampMs,
      open,
      high,
      low,
      close,
      volume,
      hasFullOhlc: true,
      zeroRange,
    });
  }

  // Deduplicate by timestamp before evaluating batch structure. Keep the last
  // provider observation for a duplicate minute, then sort chronologically.
  const byTimestamp = new Map<number, ParsedYahooRow>();
  for (const row of rows) byTimestamp.set(row.timestampMs, row);
  const deduplicatedRows = Array.from(byTimestamp.values())
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const fullOhlcRows = deduplicatedRows.filter(row => row.hasFullOhlc);
  const zeroRangeFullRows = fullOhlcRows.filter(row => row.zeroRange).length;
  const isCollapsedQuoteSeries =
    fullOhlcRows.length >= 3 &&
    zeroRangeFullRows / fullOhlcRows.length >= 0.75;

  const candles: Candle[] = [];
  const closeOnlyObservations: YahooCloseObservation[] = [];

  for (const row of deduplicatedRows) {
    if (!row.hasFullOhlc || isCollapsedQuoteSeries) {
      closeOnlyObservations.push({
        timestamp: row.timestamp,
        timestampMs: row.timestampMs,
        close: row.close,
        source: 'yahoo-close-only',
      });
      continue;
    }

    candles.push({
      symbol,
      timestamp: row.timestamp,
      timestampMs: row.timestampMs,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      source: 'yahoo',
    });
  }

  return {
    candles,
    closeOnlyObservations,
    inputRows: timestamps.length,
    rejectedRows,
    missingVolumeRows,
    zeroRangeRows,
    isCollapsedQuoteSeries,
  };
}

/** Recognize flat Yahoo bars saved by the older volume=150 fallback. */
export function isLegacyFabricatedYahooFlatCandle(candle: Candle): boolean {
  return candle.source === 'yahoo' &&
    candle.volume === 150 &&
    candle.open === candle.high &&
    candle.high === candle.low &&
    candle.low === candle.close;
}
