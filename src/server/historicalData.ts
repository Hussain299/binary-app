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
import type { Candle, ForexSymbol } from '../types/index.ts';

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

  /** Read only the newest monthly partitions needed for a bounded research window. */
  public getLatestCandles(symbol: ForexSymbol, limit = 120_000): Candle[] {
    try {
      if (!Number.isFinite(limit) || limit < 1) return [];
      if (!fs.existsSync(ROOT)) return [];
      const boundedLimit = Math.max(1, Math.min(Math.floor(limit), MAX_CANDLES_PER_PAIR));
      const prefix = this.prefixFor(symbol);
      const months = fs.readdirSync(ROOT)
        .filter(name => name.startsWith(prefix) && /^\d{6}\.json$/.test(name.slice(prefix.length)))
        .map(name => name.slice(prefix.length, -5))
        .sort();
      const candles: Candle[] = [];
      for (let index = months.length - 1; index >= 0 && candles.length < boundedLimit; index--) {
        candles.push(...this.readMonth(symbol, months[index]));
      }
      candles.sort((a, b) => a.timestampMs - b.timestampMs);
      return candles.slice(-boundedLimit);
    } catch (error) {
      console.error(`[HistoricalData] Failed to read latest ${symbol} research window:`, error);
      return [];
    }
  }

  public getCandles(symbol: ForexSymbol, limit = MAX_CANDLES_PER_PAIR): Candle[] {
    return this.getLatestCandles(symbol, limit);
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

  private listMonths(symbol: ForexSymbol): string[] {
    if (!fs.existsSync(ROOT)) return [];
    const prefix = this.prefixFor(symbol);
    return fs.readdirSync(ROOT)
      .filter(name => name.startsWith(prefix) && /^\d{6}\.json$/.test(name.slice(prefix.length)))
      .map(name => name.slice(prefix.length, -5))
      .sort();
  }

  private isResearchUsable(candle: Candle): boolean {
    return ALLOWED_SOURCES.has(candle.source) &&
      !(candle.volume === 0 &&
        candle.open === candle.high &&
        candle.high === candle.low &&
        candle.low === candle.close);
  }

  /**
   * Stream one month partition at a time. The old implementation assembled up
   * to 1.9m candles just to paint the readiness dashboard, creating avoidable
   * memory pressure across a 20-pair research universe.
   */
  public getStats(symbol: ForexSymbol, sinceTimestampMs: number | null = null) {
    const months = this.listMonths(symbol);
    let count = 0;
    let usableM1Count = 0;
    let usableM1CandlesSince = 0;
    let zeroVolumeFlatRows = 0;
    let minuteSteps = 0;
    let previousUsableTimestamp: number | null = null;
    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;
    const sources = new Set<string>();
    let monthsStored = 0;

    for (const month of months) {
      const rows = this.readMonth(symbol, month)
        .sort((a, b) => a.timestampMs - b.timestampMs);
      if (rows.length === 0) continue;
      monthsStored++;
      count += rows.length;
      for (const candle of rows) {
        sources.add(candle.source);
        if (!firstTimestamp || candle.timestampMs < Date.parse(firstTimestamp)) {
          firstTimestamp = candle.timestamp;
        }
        if (!lastTimestamp || candle.timestampMs > Date.parse(lastTimestamp)) {
          lastTimestamp = candle.timestamp;
        }
        if (!this.isResearchUsable(candle)) {
          if (candle.volume === 0 &&
              candle.open === candle.high &&
              candle.high === candle.low &&
              candle.low === candle.close) {
            zeroVolumeFlatRows++;
          }
          continue;
        }
        usableM1Count++;
        if (sinceTimestampMs !== null && candle.timestampMs >= sinceTimestampMs) {
          usableM1CandlesSince++;
        }
        if (previousUsableTimestamp !== null &&
            Math.abs((candle.timestampMs - previousUsableTimestamp) - 60_000) <= 5_000) {
          minuteSteps++;
        }
        previousUsableTimestamp = candle.timestampMs;
      }
    }

    return {
      symbol,
      count,
      usableM1Count,
      usableM1CandlesSince: sinceTimestampMs === null ? usableM1Count : usableM1CandlesSince,
      zeroVolumeFlatRows,
      continuityRatio: minuteSteps / Math.max(1, usableM1Count - 1),
      firstTimestamp,
      lastTimestamp,
      monthsStored,
      sources: [...sources].sort(),
    };
  }

  /** Count only usable M1 observations newer than an already inspected boundary. */
  public countUsableCandlesSince(symbol: ForexSymbol, timestampMs: number): number {
    if (!Number.isFinite(timestampMs)) return 0;
    let count = 0;
    for (const month of this.listMonths(symbol)) {
      for (const candle of this.readMonth(symbol, month)) {
        if (candle.timestampMs >= timestampMs && this.isResearchUsable(candle)) count++;
      }
    }
    return count;
  }
}

export const historicalDataStore = new HistoricalDataStore();
