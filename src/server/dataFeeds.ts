/**
 * SignalForge ML — Multi-Source Forex Data Ingestion Engine
 * Implements strict fallback order: Biquote -> Dukascopy -> Yahoo Finance.
 * Includes gap detection, duplicate elimination, UTC normalization, and health scoring.
 */

import { Candle, ForexSymbol, MarketSessionId, MarketSessionInfo, ProviderHealth } from '../types/index.js';
import { db } from './db.js';

interface RawCandle {
  timestamp: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export class DataFeedEngine {
  private basePrices: Record<ForexSymbol, number> = {
    'EUR/USD': 1.0854,
    'GBP/USD': 1.2985,
    'USD/JPY': 152.42,
    'EUR/JPY': 165.45,
    'AUD/USD': 0.6582,
    'USD/CAD': 1.3895,
    'EUR/GBP': 0.8345,
    'AUD/CAD': 0.9125,
    'AUD/CHF': 0.5740,
    'AUD/JPY': 99.85,
    'AUD/NZD': 1.0875,
    'EUR/AUD': 1.6480,
    'EUR/CAD': 1.5030,
    'EUR/CHF': 0.9470,
    'EUR/NZD': 1.7920,
    'GBP/AUD': 1.9720,
    'GBP/CAD': 1.8010,
    'GBP/CHF': 1.1340,
    'GBP/JPY': 198.20,
    'GBP/NZD': 2.1460,
  };

  /**
   * Fetches candles with full 3-tier fallback logic and health auditing.
   */
  public async fetchCandles(symbol: ForexSymbol, limit: number = 100): Promise<{ candles: Candle[]; source: string; qualityScore: number }> {
    const cleanSymbol = symbol.replace('/', '');
    let candles: Candle[] = [];
    let activeSource = 'none';

    // 1. Try Biquote
    try {
      const start = Date.now();
      const biquoteUrl = `https://biquote.io/api/${cleanSymbol}/ohlc?interval=1m&limit=${limit}`;
      const res = await fetch(biquoteUrl, {
        headers: { 'User-Agent': 'SignalForge-Research/2.0' },
        signal: AbortSignal.timeout(4000),
      });

      if (res.ok) {
        const data = await res.json() as any;
        const rawList = Array.isArray(data) ? data : data?.data || data?.candles;
        if (Array.isArray(rawList) && rawList.length > 0) {
          candles = this.normalizeBiquote(symbol, rawList);
          activeSource = 'biquote';
          db.updateFeedHealth({
            provider: 'biquote',
            symbol,
            status: 'ONLINE',
            latencyMs: Date.now() - start,
            lastSuccess: new Date().toISOString(),
            consecutiveFailures: 0,
            attribution: 'Biquote.io Public M1 Feed',
          });
        }
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err: any) {
      db.updateFeedHealth({
        provider: 'biquote',
        symbol,
        status: 'DEGRADED',
        latencyMs: 4000,
        lastSuccess: 'Pending',
        consecutiveFailures: 1,
        attribution: 'Biquote.io (Fallback triggered)',
        errorMessage: err.message,
      });
    }

    // 2. Try Dukascopy Fallback if Biquote failed
    if (candles.length === 0) {
      try {
        const start = Date.now();
        const dukascopyUrl = `https://zapi.ink/v1/finance:dukascopy/m1-candles?instrument=${cleanSymbol}&count=${limit}`;
        const res = await fetch(dukascopyUrl, {
          signal: AbortSignal.timeout(4500),
        });

        if (res.ok) {
          const data = await res.json() as any;
          const rawList = data?.candles || data;
          if (Array.isArray(rawList) && rawList.length > 0) {
            candles = this.normalizeDukascopy(symbol, rawList);
            activeSource = 'dukascopy';
            db.updateFeedHealth({
              provider: 'dukascopy',
              symbol,
              status: 'ONLINE',
              latencyMs: Date.now() - start,
              lastSuccess: new Date().toISOString(),
              consecutiveFailures: 0,
              attribution: 'Dukascopy Secondary M1 Feed',
            });
          }
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err: any) {
        db.updateFeedHealth({
          provider: 'dukascopy',
          symbol,
          status: 'DEGRADED',
          latencyMs: 4500,
          lastSuccess: 'Pending',
          consecutiveFailures: 1,
          attribution: 'Dukascopy (Fallback triggered)',
          errorMessage: err.message,
        });
      }
    }

    // 3. Try Yahoo Finance Fallback
    if (candles.length === 0) {
      try {
        const start = Date.now();
        const yahooSymbol = `${cleanSymbol}=X`;
        const yahooUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?range=2d&interval=1m`;
        const res = await fetch(yahooUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(5000),
        });

        if (res.ok) {
          const data = await res.json() as any;
          const result = data?.chart?.result?.[0];
          if (result && result.timestamp && result.indicators?.quote?.[0]) {
            candles = this.normalizeYahoo(symbol, result);
            activeSource = 'yahoo';
            db.updateFeedHealth({
              provider: 'yahoo',
              symbol,
              status: 'ONLINE',
              latencyMs: Date.now() - start,
              lastSuccess: new Date().toISOString(),
              consecutiveFailures: 0,
              attribution: 'Yahoo Finance Chart Feed',
            });
          }
        }
      } catch (err: any) {
        db.updateFeedHealth({
          provider: 'yahoo',
          symbol,
          status: 'FAILED',
          latencyMs: 5000,
          lastSuccess: 'Pending',
          consecutiveFailures: 1,
          attribution: 'Yahoo Finance (All public APIs exhausted)',
          errorMessage: err.message,
        });
      }
    }

    // 4. If all public endpoints fail or are closed (weekend/rate limit), use realistic high-fidelity continuity generator
    if (candles.length === 0) {
      const stored = db.getCandles(symbol, limit);
      if (stored.length > 0) {
        candles = this.extendFromStored(symbol, stored, limit);
        activeSource = 'synthetic';
      } else {
        candles = this.generateRealisticHistoricalCandles(symbol, limit);
        activeSource = 'synthetic';
      }
    } else {
      // Ensure returned API candles extend up to current live time
      candles = this.bridgeToCurrentTime(symbol, candles, limit);
    }

    // Audit quality, sort chronologically, remove duplicates
    const validated = this.validateAndDeduplicate(candles);
    const qualityScore = this.calculateQualityScore(validated);

    // Save to persistent database
    db.storeCandles(symbol, validated);

    const containsSynthetic = validated.some(candle => candle.source === 'synthetic');
    const reportedSource = containsSynthetic
      ? (activeSource === 'synthetic' ? 'synthetic' : `${activeSource}+synthetic`)
      : activeSource;
    return {
      candles: validated,
      source: reportedSource,
      qualityScore,
    };
  }

  private normalizeBiquote(symbol: ForexSymbol, raw: any[]): Candle[] {
    return raw
      .map(item => {
        const timeVal = item.time || item.timestamp || item.t;
        const tsMs = typeof timeVal === 'number' ? (timeVal < 10000000000 ? timeVal * 1000 : timeVal) : Date.parse(timeVal);
        return {
          symbol,
          timestamp: new Date(tsMs).toISOString(),
          timestampMs: tsMs,
          open: Number(item.open || item.o),
          high: Number(item.high || item.h),
          low: Number(item.low || item.l),
          close: Number(item.close || item.c),
          volume: Number(item.volume || item.v || 100),
          source: 'biquote' as const,
        };
      })
      .filter(c => !isNaN(c.timestampMs) && !isNaN(c.close) && c.high >= c.low);
  }

  private normalizeDukascopy(symbol: ForexSymbol, raw: any[]): Candle[] {
    return raw
      .map(item => {
        const tsMs = typeof item.time === 'number' ? (item.time < 10000000000 ? item.time * 1000 : item.time) : Date.parse(item.time);
        return {
          symbol,
          timestamp: new Date(tsMs).toISOString(),
          timestampMs: tsMs,
          open: Number(item.open),
          high: Number(item.high),
          low: Number(item.low),
          close: Number(item.close),
          volume: Number(item.volume || 100),
          source: 'dukascopy' as const,
        };
      })
      .filter(c => !isNaN(c.timestampMs) && !isNaN(c.close));
  }

  private normalizeYahoo(symbol: ForexSymbol, chartResult: any): Candle[] {
    const timestamps = chartResult.timestamp || [];
    const quote = chartResult.indicators?.quote?.[0] || {};
    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];
    const volumes = quote.volume || [];

    const candles: Candle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] !== null && closes[i] !== undefined && !isNaN(closes[i])) {
        const tsMs = timestamps[i] * 1000;
        candles.push({
          symbol,
          timestamp: new Date(tsMs).toISOString(),
          timestampMs: tsMs,
          open: Number(opens[i] ?? closes[i]),
          high: Number(highs[i] ?? closes[i]),
          low: Number(lows[i] ?? closes[i]),
          close: Number(closes[i]),
          volume: Number(volumes[i] || 150),
          source: 'yahoo' as const,
        });
      }
    }
    return candles;
  }

  private validateAndDeduplicate(candles: Candle[]): Candle[] {
    const map = new Map<number, Candle>();
    for (const c of candles) {
      if (
        !isNaN(c.timestampMs) &&
        !isNaN(c.open) &&
        !isNaN(c.high) &&
        !isNaN(c.low) &&
        !isNaN(c.close) &&
        c.high >= c.low &&
        c.high >= c.open &&
        c.high >= c.close &&
        c.low <= c.open &&
        c.low <= c.close
      ) {
        map.set(c.timestampMs, c);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.timestampMs - b.timestampMs);
  }

  private calculateQualityScore(candles: Candle[]): number {
    if (candles.length < 5) return 20;
    let gaps = 0;
    for (let i = 1; i < candles.length; i++) {
      const diff = candles[i].timestampMs - candles[i - 1].timestampMs;
      if (diff > 90 * 1000) {
        gaps++;
      }
    }
    const gapPenalty = Math.min(40, gaps * 4);
    return Math.max(30, 100 - gapPenalty);
  }

  /**
   * High-fidelity realistic candle generator for when markets are closed or APIs rate-limit
   */
  public generateRealisticHistoricalCandles(symbol: ForexSymbol, count: number = 120): Candle[] {
    const candles: Candle[] = [];
    let currentPrice = this.basePrices[symbol] || 1.085;
    const now = Date.now();
    const intervalMs = 60 * 1000;
    const startMs = now - count * intervalMs;
    const isJpy = symbol.includes('JPY');
    const pipScale = isJpy ? 0.01 : 0.0001;

    for (let i = 0; i < count; i++) {
      const timeMs = startMs + i * intervalMs;
      const stepChange = (Math.random() - 0.495) * 3.5 * pipScale;
      const open = currentPrice;
      const close = Number((open + stepChange).toFixed(isJpy ? 3 : 5));
      const wickUpper = Math.random() * 2.0 * pipScale;
      const wickLower = Math.random() * 2.0 * pipScale;
      const high = Number((Math.max(open, close) + wickUpper).toFixed(isJpy ? 3 : 5));
      const low = Number((Math.min(open, close) - wickLower).toFixed(isJpy ? 3 : 5));
      const volume = Math.floor(80 + Math.random() * 250);

      currentPrice = close;
      candles.push({
        symbol,
        timestamp: new Date(timeMs).toISOString(),
        timestampMs: timeMs,
        open,
        high,
        low,
        close,
        volume,
        source: 'synthetic',
      });
    }

    return candles;
  }

  private bridgeToCurrentTime(symbol: ForexSymbol, candles: Candle[], limit: number): Candle[] {
    if (candles.length === 0) return this.generateRealisticHistoricalCandles(symbol, limit);
    const nowMs = Date.now();
    const intervalMs = 60 * 1000;
    const latest = candles[candles.length - 1];

    // If candles are within the last 90 seconds, they are fresh
    if (nowMs - latest.timestampMs <= 90 * 1000) {
      return candles.slice(-limit);
    }

    const isJpy = symbol.includes('JPY');
    const pipScale = isJpy ? 0.01 : 0.0001;
    let currentPrice = latest.close;
    // Advance forward minute by minute up to current Date.now()
    const missedSteps = Math.min(240, Math.max(1, Math.floor((nowMs - latest.timestampMs) / intervalMs)));
    const extension: Candle[] = [];

    for (let i = 1; i <= missedSteps; i++) {
      const timeMs = latest.timestampMs + i * intervalMs;
      const stepChange = (Math.random() - 0.495) * 3.2 * pipScale;
      const open = currentPrice;
      const close = Number((open + stepChange).toFixed(isJpy ? 3 : 5));
      const wickUpper = Math.random() * 2.0 * pipScale;
      const wickLower = Math.random() * 2.0 * pipScale;
      const high = Number((Math.max(open, close) + wickUpper).toFixed(isJpy ? 3 : 5));
      const low = Number((Math.min(open, close) - wickLower).toFixed(isJpy ? 3 : 5));
      const volume = Math.floor(80 + Math.random() * 250);

      currentPrice = close;
      extension.push({
        symbol,
        timestamp: new Date(timeMs).toISOString(),
        timestampMs: timeMs,
        open,
        high,
        low,
        close,
        volume,
        source: 'synthetic',
      });
    }

    const merged = [...candles, ...extension];
    return merged.slice(-limit);
  }

  private extendFromStored(symbol: ForexSymbol, stored: Candle[], limit: number): Candle[] {
    return this.bridgeToCurrentTime(symbol, stored, limit);
  }

  /**
   * Returns current active market sessions and timezone metadata
   */
  public getMarketSessions() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const currentSession = getSessionFromTimestamp(now);

    return {
      activeSessionId: currentSession.id,
      activeSessionName: currentSession.name,
      sydney: utcHour >= 22 || utcHour < 7,
      tokyo: utcHour >= 0 && utcHour < 9,
      london: utcHour >= 7 && utcHour < 16,
      newYork: utcHour >= 12 && utcHour < 21,
      overlap: utcHour >= 12 && utcHour < 16,
      currentUtcHour: utcHour,
      currentUtcIso: now.toISOString(),
      currentIst: new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).format(now).toUpperCase() + ' IST',
    };
  }
}

/**
 * Deterministically resolves the forex market session for any UTC timestamp.
 * 4 Recognized Institutional Sessions:
 * 1. ASIA (Tokyo/Sydney): 00:00 - 07:00 UTC (05:30 - 12:30 IST)
 * 2. LONDON: 07:00 - 12:00 UTC (12:30 - 17:30 IST)
 * 3. OVERLAP (London + New York Peak): 12:00 - 16:00 UTC (17:30 - 21:30 IST)
 * 4. NEW_YORK (Afternoon NY): 16:00 - 21:00 UTC (21:30 - 02:30 IST)
 */
export function getSessionFromTimestamp(timestampUtc: string | Date | number): {
  id: MarketSessionId;
  name: string;
  shortName: string;
  utcRange: string;
  istRange: string;
} {
  const d = new Date(timestampUtc);
  const hour = d.getUTCHours();

  if (hour >= 12 && hour < 16) {
    return {
      id: 'OVERLAP',
      name: 'London / New York Overlap',
      shortName: 'Overlap',
      utcRange: '12:00 - 16:00 UTC',
      istRange: '05:30 PM - 09:30 PM IST',
    };
  } else if (hour >= 7 && hour < 12) {
    return {
      id: 'LONDON',
      name: 'London Session',
      shortName: 'London',
      utcRange: '07:00 - 12:00 UTC',
      istRange: '12:30 PM - 05:30 PM IST',
    };
  } else if (hour >= 16 && hour < 21) {
    return {
      id: 'NEW_YORK',
      name: 'New York Session',
      shortName: 'New York',
      utcRange: '16:00 - 21:00 UTC',
      istRange: '09:30 PM - 02:30 AM IST',
    };
  } else {
    return {
      id: 'ASIA',
      name: 'Asian Session',
      shortName: 'Asia',
      utcRange: '00:00 - 07:00 UTC',
      istRange: '05:30 AM - 12:30 PM IST',
    };
  }
}

export const dataFeedEngine = new DataFeedEngine();
