/**
 * Persistent store for imported, genuine historical market candles.
 * Kept separate from the short rolling live-feed cache so backtests can use
 * long datasets without confusing synthetic continuity candles with market data.
 */
import fs from 'fs';
import path from 'path';
import { Candle, ForexSymbol } from '../types/index.js';

const ROOT = path.resolve(process.cwd(), 'data', 'historical');
const MAX_CANDLES_PER_PAIR = 1_900_000; // Approximately five years of active-session M1 FX candles.
const MAX_IMPORT_BATCH = 20_000;
const ALLOWED_SOURCES = new Set(['biquote', 'dukascopy', 'yahoo', 'imported']);

export interface HistoricalImportResult {
  symbol: ForexSymbol;
  imported: number;
  totalStored: number;
  duplicates: number;
  rejected: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

class HistoricalDataStore {
  private fileFor(symbol: ForexSymbol): string {
    return path.join(ROOT, `${symbol.replace('/', '')}.json`);
  }

  private ensureRoot(): void {
    fs.mkdirSync(ROOT, { recursive: true });
  }

  public getCandles(symbol: ForexSymbol, limit = MAX_CANDLES_PER_PAIR): Candle[] {
    try {
      const file = this.fileFor(symbol);
      if (!fs.existsSync(file)) return [];
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(-Math.max(1, Math.min(limit, MAX_CANDLES_PER_PAIR)));
    } catch (error) {
      console.error(`[HistoricalData] Failed to read ${symbol} history:`, error);
      return [];
    }
  }

  public importCandles(symbol: ForexSymbol, input: unknown): HistoricalImportResult {
    if (!Array.isArray(input) || input.length === 0) {
      throw new Error('Provide a non-empty candles array.');
    }
    if (input.length > MAX_IMPORT_BATCH) {
      throw new Error(`A single import batch is limited to ${MAX_IMPORT_BATCH.toLocaleString()} candles. Uploads are chunked automatically by the UI.`);
    }

    const byTime = new Map<number, Candle>();
    let rejected = 0;
    let duplicates = 0;
    for (const raw of input) {
      if (!raw || typeof raw !== 'object') { rejected++; continue; }
      const row = raw as Record<string, unknown>;
      const time = row.timestampMs ?? row.timestamp ?? row.time ?? row.date;
      const timeString = String(time ?? '').trim();
      const numericTime = /^\\d+(\\.\\d+)?$/.test(timeString) ? Number(timeString) : NaN;
      const timestampMs = typeof time === 'number'
        ? (time < 10_000_000_000 ? time * 1000 : time)
        : Number.isFinite(numericTime)
          ? (numericTime < 10_000_000_000 ? numericTime * 1000 : numericTime)
          : Date.parse(timeString);
      const open = Number(row.open ?? row.o);
      const high = Number(row.high ?? row.h);
      const low = Number(row.low ?? row.l);
      const close = Number(row.close ?? row.c);
      const volume = Number(row.volume ?? row.v ?? 0);
      if (
        !Number.isFinite(timestampMs) ||
        ![open, high, low, close].every(Number.isFinite) ||
        high < Math.max(open, close, low) ||
        low > Math.min(open, close, high) ||
        !ALLOWED_SOURCES.has(String(row.source ?? 'imported'))
      ) { rejected++; continue; }

      const candle: Candle = {
        symbol,
        timestamp: new Date(timestampMs).toISOString(),
        timestampMs,
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
        source: 'imported',
      };
      if (byTime.has(timestampMs)) duplicates++;
      byTime.set(timestampMs, candle);
    }
    if (byTime.size === 0) {
      throw new Error(`No valid candles found. Rejected rows: ${rejected}.`);
    }

    const existing = this.getCandles(symbol, MAX_CANDLES_PER_PAIR);
    const merged = new Map<number, Candle>();
    for (const candle of existing) merged.set(candle.timestampMs, candle);
    for (const candle of byTime.values()) {
      if (merged.has(candle.timestampMs)) duplicates++;
      merged.set(candle.timestampMs, candle);
    }
    const sorted = Array.from(merged.values())
      .sort((a, b) => a.timestampMs - b.timestampMs)
      .slice(-MAX_CANDLES_PER_PAIR);

    this.ensureRoot();
    const file = this.fileFor(symbol);
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(sorted), 'utf-8');
    fs.renameSync(temp, file);

    return {
      symbol,
      imported: byTime.size,
      totalStored: sorted.length,
      duplicates,
      rejected,
      firstTimestamp: sorted[0]?.timestamp ?? null,
      lastTimestamp: sorted[sorted.length - 1]?.timestamp ?? null,
    };
  }

  public getStats(symbol: ForexSymbol) {
    const candles = this.getCandles(symbol);
    return {
      symbol,
      count: candles.length,
      firstTimestamp: candles[0]?.timestamp ?? null,
      lastTimestamp: candles[candles.length - 1]?.timestamp ?? null,
      sources: [...new Set(candles.map(c => c.source))],
    };
  }
}

export const historicalDataStore = new HistoricalDataStore();
