/**
 * Persistent store for imported one-minute OHLC history.
 *
 * Data is partitioned by pair and UTC month. Each upload batch only rewrites
 * the affected monthly partitions, avoiding repeated full-history rewrites
 * when importing several years of candles.
 *
 * User-imported data is schema-checked. The importer cannot independently
 * authenticate the provider; timestamp alignment is checked by the research pipeline.
 */
import fs from 'fs';
import path from 'path';
import { Candle, ForexSymbol } from '../types/index.js';

const ROOT = path.resolve(process.cwd(), 'data', 'historical');
const MAX_CANDLES_PER_PAIR = 1_900_000;
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
  private prefixFor(symbol: ForexSymbol): string {
    return `${symbol.replace('/', '')}_`;
  }

  private fileFor(symbol: ForexSymbol, month: string): string {
    return path.join(ROOT, `${this.prefixFor(symbol)}${month}.json`);
  }

  private ensureRoot(): void {
    fs.mkdirSync(ROOT, { recursive: true });
  }

  private readMonth(symbol: ForexSymbol, month: string): Candle[] {
    try {
      const file = this.fileFor(symbol, month);
      if (!fs.existsSync(file)) return [];
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((row: any) =>
        row && row.symbol === symbol &&
        Number.isFinite(row.timestampMs) &&
        Number.isFinite(row.open) &&
        Number.isFinite(row.high) &&
        Number.isFinite(row.low) &&
        Number.isFinite(row.close)
      ) as Candle[];
    } catch (error) {
      console.error(`[HistoricalData] Failed to read ${symbol} ${month} partition:`, error);
      return [];
    }
  }

  public getCandles(symbol: ForexSymbol, limit = MAX_CANDLES_PER_PAIR): Candle[] {
    try {
      if (!fs.existsSync(ROOT)) return [];
      const prefix = this.prefixFor(symbol);
      const months = fs.readdirSync(ROOT)
        .filter(name => name.startsWith(prefix) && /^\d{6}\.json$/.test(name.slice(prefix.length)))
        .map(name => name.slice(prefix.length, -5))
        .sort();
      const candles: Candle[] = [];
      for (const month of months) candles.push(...this.readMonth(symbol, month));
      candles.sort((a, b) => a.timestampMs - b.timestampMs);
      return candles.slice(-Math.max(1, Math.min(limit, MAX_CANDLES_PER_PAIR)));
    } catch (error) {
      console.error(`[HistoricalData] Failed to list ${symbol} history:`, error);
      return [];
    }
  }

  public importCandles(symbol: ForexSymbol, input: unknown): HistoricalImportResult {
    if (!Array.isArray(input) || input.length === 0) {
      throw new Error('Provide a non-empty candles array.');
    }
    if (input.length > MAX_IMPORT_BATCH) {
      throw new Error(`A single import batch is limited to ${MAX_IMPORT_BATCH.toLocaleString()} candles. The UI uploads history in chunks.`);
    }

    const byMonth = new Map<string, Map<number, Candle>>();
    let rejected = 0;
    let duplicates = 0;

    for (const raw of input) {
      if (!raw || typeof raw !== 'object') { rejected++; continue; }
      const row = raw as Record<string, unknown>;
      const time = row.timestampMs ?? row.timestamp ?? row.time ?? row.date;
      const timeString = String(time ?? '').trim();
      const numericTime = /^\d+(\.\d+)?$/.test(timeString) ? Number(timeString) : NaN;
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
      const suppliedSource = String(row.source ?? 'imported');

      if (
        !Number.isFinite(timestampMs) ||
        ![open, high, low, close].every(Number.isFinite) ||
        high < Math.max(open, close, low) ||
        low > Math.min(open, close, high) ||
        !ALLOWED_SOURCES.has(suppliedSource)
      ) { rejected++; continue; }

      const date = new Date(timestampMs);
      if (!Number.isFinite(date.getTime())) { rejected++; continue; }
      const month = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      const candle: Candle = {
        symbol,
        timestamp: date.toISOString(),
        timestampMs,
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
        source: 'imported',
      };
      if (!byMonth.has(month)) byMonth.set(month, new Map<number, Candle>());
      const monthMap = byMonth.get(month)!;
      if (monthMap.has(timestampMs)) duplicates++;
      monthMap.set(timestampMs, candle);
    }

    if (byMonth.size === 0) {
      throw new Error(`No valid candles found. Rejected rows: ${rejected}.`);
    }

    this.ensureRoot();
    let imported = 0;
    const prefix = this.prefixFor(symbol);
    const existingMonths = fs.readdirSync(ROOT)
      .filter(name => name.startsWith(prefix) && /^\d{6}\.json$/.test(name.slice(prefix.length)))
      .map(name => name.slice(prefix.length, -5));
    const allMonths = new Set([...existingMonths, ...byMonth.keys()]);
    const changedPartitions = new Map<string, Candle[]>();
    let totalAfterImport = 0;

    // Check the full post-merge size before writing any partition. getCandles()
    // truncates its return value, so it cannot detect an over-capacity store after writing.
    for (const month of allMonths) {
      const merged = new Map<number, Candle>();
      for (const candle of this.readMonth(symbol, month)) merged.set(candle.timestampMs, candle);
      const incoming = byMonth.get(month);
      if (incoming) {
        for (const candle of incoming.values()) {
          if (merged.has(candle.timestampMs)) duplicates++;
          else imported++;
          merged.set(candle.timestampMs, candle);
        }
        changedPartitions.set(month, Array.from(merged.values()).sort((a, b) => a.timestampMs - b.timestampMs));
      }
      totalAfterImport += merged.size;
    }

    if (totalAfterImport > MAX_CANDLES_PER_PAIR) {
      throw new Error(`Historical store limit reached (${MAX_CANDLES_PER_PAIR.toLocaleString()} candles per pair); no files were changed.`);
    }

    for (const [month, sortedMonth] of changedPartitions) {
      const file = this.fileFor(symbol, month);
      const temp = `${file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(sortedMonth), 'utf-8');
      fs.renameSync(temp, file);
    }

    const sorted = this.getCandles(symbol, MAX_CANDLES_PER_PAIR);
    return {
      symbol,
      imported,
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
      monthsStored: candles.length ? new Set(candles.map(c => c.timestamp.slice(0, 7))).size : 0,
      sources: [...new Set(candles.map(c => c.source))],
    };
  }
}

export const historicalDataStore = new HistoricalDataStore();
