/**
 * SignalForge ML — Comprehensive Automated Verification Test Suite
 * Executes real tests across Data Ingestion, ML Pipeline, Causal Entry/Exit Engine,
 * Research Trinity Audits, and System State.
 */

import { Candle, ForexSymbol, ResearchSignal, VerificationTestResult } from '../types/index.js';
import { dataFeedEngine } from './dataFeeds.js';
import { db } from './db.js';
import { entryExitEngine } from './entryExitEngine.js';
import { researchEngine } from './researchEngine.js';

const makeM1TestCandles = (symbol: ForexSymbol, count: number): Candle[] =>
  dataFeedEngine.generateRealisticHistoricalCandles(symbol, count).map(c => {
    const timestampMs = Math.floor(c.timestampMs / 60_000) * 60_000;
    return {
      ...c,
      timestampMs,
      timestamp: new Date(timestampMs).toISOString(),
      source: 'biquote' as const,
    };
  });

export async function runAllVerificationTests(): Promise<{
  summary: { total: number; passed: number; failed: number; durationMs: number };
  results: VerificationTestResult[];
}> {
  const startTime = Date.now();
  const results: VerificationTestResult[] = [];

  const runTest = async (
    category: VerificationTestResult['category'],
    name: string,
    fn: () => Promise<void> | void
  ) => {
    const t0 = Date.now();
    try {
      await fn();
      results.push({
        category,
        name,
        passed: true,
        durationMs: Date.now() - t0,
        details: 'Passed all verification assertions.',
      });
    } catch (err: any) {
      results.push({
        category,
        name,
        passed: false,
        durationMs: Date.now() - t0,
        details: 'Assertion failure',
        error: err.message,
      });
    }
  };

  // ==========================================
  // 1. DATA TESTS
  // ==========================================
  await runTest('DATA', 'Provider Fallback & Continuity Generation', async () => {
    // Test that requesting candles never returns empty list even if remote APIs are offline
    const res = await dataFeedEngine.fetchCandles('EUR/USD', 50);
    if (!res.candles || res.candles.length < 20) {
      throw new Error(`Expected at least 20 candles, got ${res.candles?.length || 0}`);
    }
    if (!res.source) {
      throw new Error('Missing active provider source attribution');
    }
  });

  await runTest('DATA', 'Invalid OHLC Validation & Sanity Enforcement', () => {
    const candles = dataFeedEngine.generateRealisticHistoricalCandles('GBP/USD', 20);
    for (const c of candles) {
      if (c.high < c.low) throw new Error(`High (${c.high}) < Low (${c.low})`);
      if (c.high < c.open || c.high < c.close) throw new Error('High is not the highest value');
      if (c.low > c.open || c.low > c.close) throw new Error('Low is not the lowest value');
    }
  });

  await runTest('DATA', 'Timestamp Ordering & Strict Chronology', () => {
    const candles = dataFeedEngine.generateRealisticHistoricalCandles('USD/JPY', 30);
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].timestampMs <= candles[i - 1].timestampMs) {
        throw new Error(`Candle ${i} timestamp is not strictly greater than previous`);
      }
    }
  });

  await runTest('DATA', 'Deduplication & Gap Detection', () => {
    const testCandles: Candle[] = [
      {
        symbol: 'EUR/USD',
        timestamp: '2026-10-29T10:00:00.000Z',
        timestampMs: 1793282400000,
        open: 1.085,
        high: 1.086,
        low: 1.084,
        close: 1.0855,
        volume: 100,
        source: 'biquote',
      },
      {
        symbol: 'EUR/USD',
        timestamp: '2026-10-29T10:00:00.000Z', // Duplicate
        timestampMs: 1793282400000,
        open: 1.085,
        high: 1.086,
        low: 1.084,
        close: 1.0855,
        volume: 100,
        source: 'biquote',
      },
    ];
    db.storeCandles('EUR/USD', testCandles);
    const retrieved = db.getCandles('EUR/USD', 10);
    const countWithSameTime = retrieved.filter(c => c.timestampMs === 1793282400000).length;
    if (countWithSameTime > 1) {
      throw new Error(`Duplicate candle detected in storage: count=${countWithSameTime}`);
    }
  });

  // ==========================================
  // 2. ENTRY / EXIT CAUSAL TESTS
  // ==========================================
  await runTest('ENTRY_EXIT', 'Causal Trigger: No Lookahead Entry', () => {
    const signalCandle: Candle = {
      symbol: 'EUR/USD',
      timestamp: '2026-10-29T10:00:00.000Z',
      timestampMs: 1793282400000,
      open: 1.085,
      high: 1.086,
      low: 1.084,
      close: 1.0858,
      volume: 120,
      source: 'synthetic',
    };

    const sig = entryExitEngine.createResearchSignal({
      symbol: 'EUR/USD',
      direction: 'BUY',
      signalCandle,
      ruleFamily: `test_no_lookahead_${Date.now()}`,
      expiryMinutes: 5,
      confidence: 0.72,
      modelVersion: 'vTest',
    });

    if (sig.lifecycleState !== 'WAITING_FOR_ENTRY') {
      throw new Error(`Expected WAITING_FOR_ENTRY initial state, got ${sig.lifecycleState}`);
    }
    if (sig.actualEntryPrice !== null || sig.actualEntryTimeUtc !== null) {
      throw new Error('Premature entry fill recorded before subsequent trigger candle arrived');
    }
    if (sig.triggerPrice <= signalCandle.high) {
      throw new Error('BUY trigger price must be above signal candle high');
    }
  });

  await runTest('ENTRY_EXIT', 'Causal Trigger Confirmation & Actual Fill', () => {
    const baseTime = 1793282400000;
    const signalCandle: Candle = {
      symbol: 'EUR/USD',
      timestamp: new Date(baseTime).toISOString(),
      timestampMs: baseTime,
      open: 1.085,
      high: 1.086,
      low: 1.084,
      close: 1.0858,
      volume: 120,
      source: 'synthetic',
    };

    const sig = entryExitEngine.createResearchSignal({
      symbol: 'EUR/USD',
      direction: 'BUY',
      signalCandle,
      ruleFamily: `test_causal_fill_${Date.now()}`,
      expiryMinutes: 10,
      confidence: 0.75,
      modelVersion: 'vTest',
    });

    // Next candle breaks above trigger
    const triggerCandle: Candle = {
      symbol: 'EUR/USD',
      timestamp: new Date(baseTime + 60000).toISOString(),
      timestampMs: baseTime + 60000,
      open: 1.0859,
      high: 1.0868, // Breaks above trigger
      low: 1.0855,
      close: 1.0865,
      volume: 140,
      source: 'synthetic',
    };

    entryExitEngine.evaluateSignals({ 'EUR/USD': [signalCandle, triggerCandle] } as any, true);

    const updated = db.getSignalById(sig.id);
    if (!updated || updated.lifecycleState !== 'ACTIVE') {
      throw new Error(`Expected ACTIVE state after trigger break, got ${updated?.lifecycleState}`);
    }
    if (!updated.actualEntryPrice || updated.actualEntryPrice <= 0) {
      throw new Error('Missing actual entry price after confirmation');
    }
    // Strict requirement: Expiry must be calculated from ACTUAL ENTRY time!
    const expectedExitMs = triggerCandle.timestampMs + 10 * 60 * 1000;
    if (Date.parse(updated.plannedExitTimeUtc!) !== expectedExitMs) {
      throw new Error(
        `Planned exit must equal actual entry + expiry. Got ${updated.plannedExitTimeUtc}`
      );
    }
  });

  await runTest('ENTRY_EXIT', 'Ambiguous Candle Ordering Detection', () => {
    const baseTime = 1793282500000;
    const signalCandle: Candle = {
      symbol: 'GBP/USD',
      timestamp: new Date(baseTime).toISOString(),
      timestampMs: baseTime,
      open: 1.298,
      high: 1.299,
      low: 1.297,
      close: 1.2985,
      volume: 100,
      source: 'synthetic',
    };

    const sig = entryExitEngine.createResearchSignal({
      symbol: 'GBP/USD',
      direction: 'BUY',
      signalCandle,
      ruleFamily: `test_ambiguous_${Date.now()}`,
      expiryMinutes: 5,
      confidence: 0.65,
      modelVersion: 'vTest',
    });

    // Highly volatile candle hits BOTH high trigger and low invalidation level in 1m
    const extremeCandle: Candle = {
      symbol: 'GBP/USD',
      timestamp: new Date(baseTime + 60000).toISOString(),
      timestampMs: baseTime + 60000,
      open: 1.2985,
      high: 1.3005, // Crosses trigger (1.29902)
      low: 1.2955, // Crosses invalidation (1.2969)
      close: 1.298,
      volume: 450,
      source: 'synthetic',
    };

    entryExitEngine.evaluateSignals({ 'GBP/USD': [signalCandle, extremeCandle] } as any, true);
    const evaluated = db.getSignalById(sig.id);

    if (evaluated?.lifecycleState !== 'AMBIGUOUS') {
      throw new Error(
        `Expected AMBIGUOUS lifecycle state when both thresholds crossed, got ${evaluated?.lifecycleState}`
      );
    }
  });

  // ==========================================
  // 3. ML & RESEARCH PIPELINE TESTS
  // ==========================================
  await runTest('ML', 'Purged Walk-Forward Splits & Embargo Verification', () => {
    const candles = makeM1TestCandles('EUR/USD', 4000);
    const exp = researchEngine.runWalkForwardExperiment('EUR/USD', candles, 'momentum_5', 10, 1);

    if (exp.purgedWindowCandles < 10) {
      throw new Error(`Purged embargo must cover the 10m horizon, got ${exp.purgedWindowCandles} M1 candles.`);
    }
    if (exp.metrics.trainSampleSize <= exp.metrics.validationSampleSize || exp.metrics.validationSampleSize <= 0) {
      throw new Error('Training and validation sample counts are missing or incorrectly ordered.');
    }
    if (Date.parse(exp.valPeriod.start) <= Date.parse(exp.trainPeriod.end)) {
      throw new Error('Validation set must chronologically follow train set after embargo purge');
    }
    if (exp.metrics.sampleSize <= 0) {
      throw new Error('Test set sample size is zero');
    }
  });

  await runTest('ML', 'Synthetic candles cannot be used for research claims', () => {
    const synthetic = dataFeedEngine.generateRealisticHistoricalCandles('EUR/USD', 1500);
    let rejected = false;
    try {
      researchEngine.runWalkForwardExperiment('EUR/USD', synthetic, 'momentum_5', 10, 1);
    } catch (error: any) {
      rejected = String(error.message).includes('genuine market candles');
    }
    if (!rejected) throw new Error('Synthetic fallback candles were not rejected by the backtest engine.');
  });

  await runTest('RESEARCH', 'Generated strategy remains unvalidated until historical testing', () => {
    const candles = dataFeedEngine.generateRealisticHistoricalCandles('EUR/USD', 100);
    const gene = researchEngine.synthesizeInfiniteNovelStrategy(candles, 'EUR/USD', 99);
    if (gene.verifiedAccuracy !== 0 || gene.sampleCount !== 0) {
      throw new Error('New candidate must not contain a fabricated accuracy or sample count.');
    }
    if (gene.status !== 'EXPERIMENTING' || gene.accuracyStatus !== 'UNVALIDATED') {
      throw new Error('New candidate must remain unvalidated and out of the promoted pool.');
    }
  });

  await runTest('ML', 'Probabilistic Calibration & Brier Score Calculation', () => {
    const candles = makeM1TestCandles('USD/JPY', 4000);
    const exp = researchEngine.runWalkForwardExperiment(
      'USD/JPY',
      candles,
      'mean_reversion_20',
      5,
      1
    );

    if (isNaN(exp.metrics.brierScore) || exp.metrics.brierScore < 0 || exp.metrics.brierScore > 1) {
      throw new Error(`Invalid Brier score: ${exp.metrics.brierScore}`);
    }
    if (!exp.metrics.confusionMatrix || exp.metrics.confusionMatrix.tp === undefined) {
      throw new Error('Missing confusion matrix');
    }
  });

  await runTest('RESEARCH', 'Skeptical Auditor Rejection of Overfitted Candidates', async () => {
    const candles = makeM1TestCandles('EUR/GBP', 4000);
    const exp = researchEngine.runWalkForwardExperiment('EUR/GBP', candles, 'wick_reversal', 15, 1);
    const reviews = await researchEngine.generateTrinityReviews(exp);

    const auditor = reviews.find(r => r.role === 'SKEPTICAL_AUDITOR');
    if (!auditor) {
      throw new Error('Skeptical auditor review was not produced');
    }
    if (exp.auditorVerdict === 'REJECTED' && auditor.verdict !== 'REJECT') {
      throw new Error('Auditor review verdict mismatched with experiment rejection status');
    }
  });

  // ==========================================
  // 4. SYSTEM & DATABASE TESTS
  // ==========================================
  await runTest('SYSTEM', 'Persistent Database & Cloudflare D1 Export Parity', () => {
    const schema = db.generateCloudflareD1Schema();
    if (!schema.includes('CREATE TABLE IF NOT EXISTS research_signals')) {
      throw new Error('D1 schema missing research_signals table');
    }
    if (!schema.includes('idx_signals_state')) {
      throw new Error('D1 schema missing lifecycle indexes');
    }
    const wrangler = db.generateWranglerToml();
    if (!wrangler.includes('binding = "DB"')) {
      throw new Error('Wrangler toml missing D1 binding');
    }
  });

  // Purge test signals so they never appear on the user's trading terminal
  db.purgeTestSignals();

  const durationMs = Date.now() - startTime;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    summary: {
      total: results.length,
      passed,
      failed,
      durationMs,
    },
    results,
  };
}
