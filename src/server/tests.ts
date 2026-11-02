/**
 * SignalForge ML — Comprehensive Automated Verification Test Suite
 * Executes real tests across Data Ingestion, ML Pipeline, Causal Entry/Exit Engine,
 * Research Trinity Audits, and System State.
 */

import type { Candle, ForexSymbol, LossAutopsy, ResearchSignal, SynthesizedStrategyGene, TradeOpportunity, VerificationTestResult } from '../types/index.ts';
import { dataFeedEngine, getSessionFromTimestamp } from './dataFeeds.ts';
import { db } from './db.ts';
import { entryExitEngine } from './entryExitEngine.ts';
import { researchEngine } from './researchEngine.ts';
import { calculateBinarySettlement } from './binarySettlement.ts';
import {
  assessNearestNeighbors,
  bayesianUcbScore,
  selectEvolutionParents,
  classifyMarketRegime,
  inferGenomeStyle,
  isStrategyRegimeCompatible,
  updateBetaPosterior,
  type EpisodicTradeMemory,
  calculateAdaptiveMutationRate,
  genomeSpeciesKey,
  hasSufficientForwardParentEvidence,
  hasSufficientHistoricalApprovalEvidence,
  getHistoricalApprovalFailureReasons,
  evolutionaryParentFitness,
  binaryBreakEvenWinRate,
  wilsonLowerBound,
  outcomeFitsResearchWindow,
  doesResearchHoldoutOverlap,
} from './evolutionEngine.ts';
import {
  ENTRY_CANDLE_TIMEFRAME_MINUTES,
  EXPIRY_HORIZONS_MINUTES,
  findEligibleStartTimeframes,
  getNextCandleOpenMs,
  isSupportedExpiryMinutes,
} from './tradingClock.ts';
import { getForexMarketState, getReportingSessionFromTimestamp, isForexMarketIntervalOpen, isForexMarketOpenAt, isForexSignalScheduleValid } from './marketHours.ts';
import {
  createSeededRandom,
  deriveResearchSeed,
  fingerprintCandles,
  stableHash,
  FEATURE_SCHEMA_VERSION,
  RESEARCH_ENGINE_VERSION,
} from './researchReproducibility.ts';
import { sanitizeLossAutopsy, OBSERVATION_ONLY_LESSONS } from './researchGovernance.ts';
import { calibratePredictionScore } from './predictionCalibration.ts';
import { opportunityEngine, evaluateOpportunityHoldout, buildOpportunitySchedule } from './opportunityEngine.ts';
import { AUTOPILOT_SCAN_INTERVAL_MS, getTrustedFreshCandleSnapshot, mapWithConcurrency, MARKET_SENSE_CONCURRENCY } from './scheduler.ts';
import {
  assessPaperCapitalRisk,
  CONSERVATIVE_PAPER_RISK_POLICY,
  payoutBreakEvenProbability,
} from './capitalRisk.ts';
import {
  getLatestObservedCandle,
  getMarketChartPriceDomain,
  getTrustedMarketCandles,
  isBatchCandleStructureValid,
} from '../utils/marketChart.ts';
import {
  isCollapsedYahooQuoteCandleBatch,
  isLegacyFabricatedYahooFlatCandle,
  normalizeYahooChartCandles,
} from '../utils/yahooCandles.ts';

const makeM1TestCandles = (symbol: ForexSymbol, count: number): Candle[] =>
  dataFeedEngine.generateRealisticHistoricalCandles(symbol, count).map(c => {
    const timestampMs = Math.floor(c.timestampMs / 60_000) * 60_000;
    return {
      ...c,
      timestampMs,
      timestamp: new Date(timestampMs).toISOString(),
      source: 'test_fixture' as const,
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

  await runTest('SCHEDULER', '24/5 market sensing stays bounded and preserves pair ordering', async () => {
    const items = Array.from({ length: 37 }, (_, index) => index);
    let active = 0;
    let maximumActive = 0;
    const rows = await mapWithConcurrency(items, MARKET_SENSE_CONCURRENCY, async (item, index) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      return { item, index };
    });
    if (maximumActive > MARKET_SENSE_CONCURRENCY) {
      throw new Error(`Market scanner exceeded its concurrency limit: ${maximumActive} > ${MARKET_SENSE_CONCURRENCY}.`);
    }
    if (rows.length !== items.length || rows.some((row, index) => row.item !== index || row.index !== index)) {
      throw new Error('Bounded market scan dropped, duplicated or reordered pair results.');
    }
    if (maximumActive < 2) throw new Error('Market scan tasks did not run concurrently.');
  });

  await runTest('SCHEDULER', '24/5 market sensing rejects unsafe concurrency configuration', async () => {
    let rejected = false;
    try {
      await mapWithConcurrency([1, 2, 3], 0, async value => value);
    } catch (error) {
      rejected = error instanceof Error && error.message.includes('positive integer');
    }
    if (!rejected) throw new Error('Invalid scheduler concurrency must fail explicitly.');
  });
  await runTest('DATA', 'market chart excludes synthetic continuity from observed quote metrics', () => {
    const makeCandle = (timestampMs: number, source: Candle['source'], close: number): Candle => ({
      symbol: 'EUR/USD',
      timestamp: new Date(timestampMs).toISOString(),
      timestampMs,
      open: close,
      high: close + 0.0002,
      low: close - 0.0002,
      close,
      volume: 100,
      source,
    });
    const realOld = makeCandle(1_800_000_000_000, 'biquote', 1.1000);
    const syntheticTail = makeCandle(1_800_000_060_000, 'synthetic', 1.1010);
    const importedNewer = makeCandle(1_800_000_030_000, 'imported', 1.1005);
    const trusted = getTrustedMarketCandles([realOld, syntheticTail, importedNewer]);
    if (trusted.length !== 2 || trusted[0].timestampMs !== realOld.timestampMs ||
        trusted[1].timestampMs !== importedNewer.timestampMs) {
      throw new Error('Trusted market candles must exclude synthetic bars and remain chronological.');
    }
    if (getLatestObservedCandle([realOld, syntheticTail, importedNewer])?.timestampMs !== importedNewer.timestampMs) {
      throw new Error('Synthetic continuity must never become the displayed last observed quote.');
    }
    if (getLatestObservedCandle([syntheticTail]) !== null) {
      throw new Error('Synthetic-only market data must not be reported as an observed quote.');
    }
  });

  await runTest('DATA', 'Yahoo close-only rows are rejected instead of fabricated into flat candles', () => {
    const base = 1_800_000_000;
    const normalized = normalizeYahooChartCandles('EUR/USD', {
      timestamp: [base, base + 60, base + 120, base + 180],
      indicators: {
        quote: [{
          open: [1.1000, null, undefined, 1.1000],
          high: [1.1004, null, undefined, 1.1000],
          low: [1.0998, null, undefined, 1.1000],
          close: [1.1002, 1.1001, 1.1002, 1.1000],
          volume: [null, null, null, null],
        }],
      },
    });

    if (normalized.inputRows !== 4 || normalized.candles.length !== 2 || normalized.rejectedRows !== 2) {
      throw new Error('Yahoo normalization must keep only rows with four complete valid OHLC values.');
    }
    if (normalized.closeOnlyObservations.length !== 2 ||
        normalized.closeOnlyObservations[0].close !== 1.1001 ||
        normalized.closeOnlyObservations[1].close !== 1.1002) {
      throw new Error('Incomplete OHLC rows must be retained only as explicit close-only observations for a line chart.');
    }
    if (normalized.candles[0].volume !== 0 || normalized.candles[1].volume !== 0 ||
        normalized.missingVolumeRows !== 4) {
      throw new Error('Missing Yahoo FX volume must be represented as zero, never a fabricated constant.');
    }
    if (normalized.candles[0].open !== 1.1000 || normalized.candles[0].high !== 1.1004 ||
        normalized.candles[0].low !== 1.0998 || normalized.candles[0].close !== 1.1002) {
      throw new Error('Complete Yahoo OHLC values must be preserved exactly.');
    }
  });

  await runTest('DATA', 'Yahoo collapsed quote batches are routed to close-only instead of fake candles', () => {
    const base = Math.floor(Date.parse('2026-11-02T15:00:00.000Z') / 1000);
    const closes = [1.12095, 1.12091, 1.12088, 1.12093, 1.12102, 1.12110, 1.12104, 1.12115];
    const normalized = normalizeYahooChartCandles('EUR/USD', {
      timestamp: closes.map((_, index) => base + index * 60),
      indicators: {
        quote: [{
          open: closes,
          high: closes,
          low: closes,
          close: closes,
          volume: closes.map(() => 0),
        }],
      },
    });
    if (!normalized.isCollapsedQuoteSeries) {
      throw new Error('A batch dominated by High=Low Yahoo quotes must be identified as close-only.');
    }
    if (normalized.candles.length !== 0 || normalized.closeOnlyObservations.length !== closes.length) {
      throw new Error('Collapsed Yahoo quotes must produce no OHLC candles and preserve every valid Close observation.');
    }
    if (normalized.zeroRangeRows !== closes.length || normalized.missingVolumeRows !== closes.length) {
      throw new Error('Zero-range and unavailable-volume diagnostics must count all collapsed FX quote rows.');
    }
    if (new Set(normalized.closeOnlyObservations.map(row => row.close)).size !== closes.length) {
      throw new Error('Distinct Yahoo Close quotes must be preserved in the read-only line series.');
    }
    const last = normalized.closeOnlyObservations[normalized.closeOnlyObservations.length - 1];
    if (last.timestampMs !== (base + (closes.length - 1) * 60) * 1000) {
      throw new Error('Yahoo Unix timestamps must be normalized to the correct UTC milliseconds.');
    }
  });

  await runTest('DATA', 'batch-level Yahoo detection preserves isolated genuine flat dojis', () => {
    const base = Math.floor(Date.parse('2026-11-02T15:00:00.000Z') / 1000);
    const opens = [1.1000, 1.1002, 1.1001, 1.1003, 1.1004, 1.1002, 1.1005, 1.1004];
    const highs = [1.1004, 1.1005, 1.1003, 1.1006, 1.1008, 1.1005, 1.1009, 1.1007];
    const lows  = [1.0998, 1.1000, 1.0999, 1.1001, 1.1002, 1.1000, 1.1003, 1.1001];
    const closes= [1.1002, 1.1003, 1.1002, 1.1004, 1.1006, 1.1003, 1.1007, 1.1005];
    // One genuine zero-range doji within a predominantly valid OHLC series.
    opens[3] = 1.1003; highs[3] = 1.1003; lows[3] = 1.1003; closes[3] = 1.1003;
    const normalized = normalizeYahooChartCandles('EUR/USD', {
      timestamp: opens.map((_, index) => base + index * 60),
      indicators: {
        quote: [{
          open: opens, high: highs, low: lows, close: closes,
          volume: opens.map(() => null),
        }],
      },
    });
    if (normalized.isCollapsedQuoteSeries || normalized.candles.length !== opens.length) {
      throw new Error('An isolated genuine doji must not cause an otherwise valid Yahoo OHLC batch to be downgraded.');
    }
    if (normalized.candles[3].open !== normalized.candles[3].close ||
        normalized.candles[3].high !== normalized.candles[3].low) {
      throw new Error('The isolated genuine flat doji must be preserved exactly.');
    }
  });

  await runTest('DATA', 'Yahoo batches at the 75-percent collapsed-quote threshold are rejected as OHLC', () => {
    const base = Math.floor(Date.parse('2026-11-02T15:00:00.000Z') / 1000);
    const prices = [1.1000, 1.1001, 1.1002, 1.1003, 1.1004];
    const normalized = normalizeYahooChartCandles('EUR/USD', {
      timestamp: prices.map((_, index) => base + index * 60),
      indicators: {
        quote: [{
          open: [...prices.slice(0, 4), 1.1004],
          high: [...prices.slice(0, 4), 1.1008],
          low: [...prices.slice(0, 4), 1.1002],
          close: [...prices.slice(0, 4), 1.1006],
          volume: prices.map(() => 0),
        }],
      },
    });
    if (!normalized.isCollapsedQuoteSeries || normalized.candles.length !== 0 ||
        normalized.closeOnlyObservations.length !== prices.length) {
      throw new Error('A batch with at least three rows and at least 75% zero-range values must be classified entirely as close-only.');
    }
    if (normalized.zeroRangeRows !== 4) {
      throw new Error('Batch diagnostics must report exactly the four zero-range quote rows.');
    }
  });

  await runTest('DATA', 'collapsed Yahoo quote batches are excluded from trusted historical candles', () => {
    const base = Date.parse('2026-11-02T15:00:00.000Z');
    const yahooQuotes: Candle[] = Array.from({ length: 8 }, (_, index) => {
      const close = 1.1209 + index * 0.00001;
      return {
        symbol: 'EUR/USD',
        timestamp: new Date(base + index * 60_000).toISOString(),
        timestampMs: base + index * 60_000,
        open: close,
        high: close,
        low: close,
        close,
        volume: 0,
        source: 'yahoo' as const,
      };
    });
    const genuineBiquote: Candle = {
      ...yahooQuotes[7],
      timestampMs: base + 8 * 60_000,
      timestamp: new Date(base + 8 * 60_000).toISOString(),
      open: 1.1210,
      high: 1.1214,
      low: 1.1208,
      close: 1.1212,
      source: 'biquote',
    };
    if (isBatchCandleStructureValid(yahooQuotes)) {
      throw new Error('The collapsed Yahoo candle batch must fail OHLC structural validation.');
    }
    const trusted = getTrustedMarketCandles([...yahooQuotes, genuineBiquote]);
    if (trusted.length !== 1 || trusted[0].source !== 'biquote') {
      throw new Error('Collapsed Yahoo quote rows must be excluded while genuine candles from another provider remain trusted.');
    }
    if (!isCollapsedYahooQuoteCandleBatch(yahooQuotes)) {
      throw new Error('The Yahoo batch classifier must independently identify the collapsed quote series.');
    }
  });

  await runTest('DATA', 'legacy Yahoo fallback dojis are removed from cached trusted candles', () => {
    const fake: Candle = {
      symbol: 'EUR/USD',
      timestamp: '2026-11-02T10:00:00.000Z',
      timestampMs: 1_800_000_000_000,
      open: 1.1000,
      high: 1.1000,
      low: 1.1000,
      close: 1.1000,
      volume: 150,
      source: 'yahoo',
    };
    const legitimate: Candle = {
      ...fake,
      timestampMs: fake.timestampMs + 60_000,
      timestamp: new Date(fake.timestampMs + 60_000).toISOString(),
      volume: 0,
    };
    if (!isLegacyFabricatedYahooFlatCandle(fake)) {
      throw new Error('The old Yahoo fallback marker must be recognized.');
    }
    if (isLegacyFabricatedYahooFlatCandle(legitimate)) {
      throw new Error('A genuine complete flat candle with no reported volume must not be discarded.');
    }
    const trusted = getTrustedMarketCandles([fake, legitimate]);
    if (trusted.length !== 1 || trusted[0].timestampMs !== legitimate.timestampMs) {
      throw new Error('Legacy fake Yahoo dojis must not be shown or used as trusted candles.');
    }
  });

  await runTest('DATA', 'market chart price domain remains finite for flat and near-flat markets', () => {
    const flatEur: Candle = {
      symbol: 'EUR/USD', timestamp: '2026-11-02T10:00:00.000Z', timestampMs: 1793613600000,
      open: 1.1000, high: 1.1000, low: 1.1000, close: 1.1000, volume: 0, source: 'biquote',
    };
    const flatJpy: Candle = {
      ...flatEur, symbol: 'USD/JPY', open: 150, high: 150, low: 150, close: 150,
    };
    const eurDomain = getMarketChartPriceDomain([flatEur], false);
    const jpyDomain = getMarketChartPriceDomain([flatJpy], true);
    if (!eurDomain || !jpyDomain ||
        ![eurDomain.min, eurDomain.max, eurDomain.range, jpyDomain.min, jpyDomain.max, jpyDomain.range].every(Number.isFinite)) {
      throw new Error('Flat market domains must contain finite, drawable price scales.');
    }
    if (eurDomain.range <= 0 || jpyDomain.range <= 0 ||
        !(eurDomain.min < flatEur.close && flatEur.close < eurDomain.max) ||
        !(jpyDomain.min < flatJpy.close && flatJpy.close < jpyDomain.max)) {
      throw new Error('The price domain must pad a flat market instead of collapsing the candlestick plot.');
    }
    if (getMarketChartPriceDomain([], false) !== null) {
      throw new Error('An empty candle set must not produce a fake price domain.');
    }
  });


  await runTest('SCHEDULER', 'market scan cadence stays inside the strict T-3 processing window', () => {
    if (AUTOPILOT_SCAN_INTERVAL_MS <= 0 || AUTOPILOT_SCAN_INTERVAL_MS > 10_000) {
      throw new Error(`Autopilot scan cooldown must be at most 10 seconds; received ${AUTOPILOT_SCAN_INTERVAL_MS}ms.`);
    }
    if (AUTOPILOT_SCAN_INTERVAL_MS >= 25_000) {
      throw new Error('Autopilot scan cooldown cannot exceed the 25-second T-3 processing window.');
    }
  });

  await runTest('DATA', 'fresh trusted candles survive synthetic continuity bars appended by feed bridge', () => {
    const nowMs = Date.parse('2026-11-02T10:00:00.000Z');
    const trusted: Candle = {
      symbol: 'EUR/USD',
      timestamp: new Date(nowMs - 60_000).toISOString(),
      timestampMs: nowMs - 60_000,
      open: 1.0850,
      high: 1.0860,
      low: 1.0840,
      close: 1.0855,
      volume: 100,
      source: 'biquote',
    };
    const synthetic: Candle = {
      ...trusted,
      timestamp: new Date(nowMs).toISOString(),
      timestampMs: nowMs,
      source: 'synthetic',
    };
    const snapshot = getTrustedFreshCandleSnapshot([trusted, synthetic], nowMs);
    if (!snapshot.isFresh || snapshot.newestCandle?.source !== 'biquote') {
      throw new Error('A synthetic continuity tail must not hide a still-fresh trusted provider candle.');
    }
    if (snapshot.candles.length !== 1 || snapshot.candles[0].source !== 'biquote') {
      throw new Error('Signal input must contain only trusted real-market candles.');
    }
    const syntheticOnly = getTrustedFreshCandleSnapshot([synthetic], nowMs);
    if (syntheticOnly.isFresh || syntheticOnly.candles.length !== 0) {
      throw new Error('Synthetic-only data must never be eligible for a live paper signal.');
    }
  });

  await runTest('SCHEDULER', 'collapsed Yahoo quote batches are rejected before strategy evaluation', () => {
    const nowMs = Date.parse('2026-11-02T15:00:00.000Z');
    const collapsed: Candle[] = Array.from({ length: 8 }, (_, index) => {
      const close = 1.1209 + index * 0.00001;
      const timestampMs = nowMs - (7 - index) * 60_000;
      return {
        symbol: 'EUR/USD',
        timestamp: new Date(timestampMs).toISOString(),
        timestampMs,
        open: close,
        high: close,
        low: close,
        close,
        volume: 0,
        source: 'yahoo' as const,
      };
    });
    const snapshot = getTrustedFreshCandleSnapshot(collapsed, nowMs);
    if (snapshot.isCandleStructureValid) {
      throw new Error('Collapsed Yahoo quote rows must fail the scheduler OHLC integrity gate.');
    }
    if (snapshot.isFresh || snapshot.candles.length !== 0) {
      throw new Error('Collapsed Yahoo quotes must never be passed as fresh OHLC strategy input.');
    }
    if (snapshot.newestCandle?.timestampMs !== nowMs) {
      throw new Error('The scheduler must retain the quote timestamp for diagnostics even when OHLC is ineligible.');
    }
    if (getTrustedMarketCandles(collapsed).length !== 0) {
      throw new Error('Collapsed Yahoo history must be excluded from the lifecycle and strategy candle maps.');
    }
  });

  await runTest('RESEARCH', 'Seeded evolutionary search is deterministic and dataset-bound', () => {
    const seed = 'reproducibility-test-seed';
    const first = createSeededRandom(seed);
    const second = createSeededRandom(seed);
    const sequenceA = Array.from({ length: 32 }, () => first());
    const sequenceB = Array.from({ length: 32 }, () => second());
    if (JSON.stringify(sequenceA) !== JSON.stringify(sequenceB)) {
      throw new Error('Identical seeds must produce identical random streams.');
    }
    if (sequenceA.some(value => value < 0 || value >= 1)) {
      throw new Error('Seeded random values must remain in [0, 1).');
    }
    const otherRandom = createSeededRandom('different-seed');
    const other = Array.from({ length: 32 }, () => otherRandom());
    if (JSON.stringify(sequenceA) === JSON.stringify(other)) {
      throw new Error('Different seeds should not produce the same random stream.');
    }

    const candles = makeM1TestCandles('EUR/USD', 120);
    const fingerprintA = fingerprintCandles(candles);
    const fingerprintB = fingerprintCandles(candles.map(candle => ({ ...candle })));
    if (fingerprintA !== fingerprintB) {
      throw new Error('Cloned identical candle streams must have identical fingerprints.');
    }
    const changed = candles.map((candle, index) =>
      index === 60 ? { ...candle, close: candle.close + 0.00001 } : candle
    );
    if (fingerprintA === fingerprintCandles(changed)) {
      throw new Error('A changed market price must change the dataset fingerprint.');
    }
    const derivedA = deriveResearchSeed('batch-1', 'EUR/USD', fingerprintA);
    const derivedB = deriveResearchSeed('batch-1', 'EUR/USD', fingerprintA);
    const derivedDifferentData = deriveResearchSeed('batch-1', 'EUR/USD', fingerprintCandles(changed));
    if (derivedA !== derivedB || derivedA === derivedDifferentData) {
      throw new Error('Research seeds must be stable for an exact run and change with its dataset.');
    }
    if (stableHash('signalforge') === stableHash('a-different-value')) {
      throw new Error('Distinct experiment metadata should not share the same stable hash.');
    }

    const candidateA = researchEngine.synthesizeInfiniteNovelStrategy(
      candles, 'EUR/USD', 7, [], 'repeatable-batch',
      false, createSeededRandom(derivedA),
      { researchSeed: derivedA, datasetFingerprint: fingerprintA }
    );
    const candidateB = researchEngine.synthesizeInfiniteNovelStrategy(
      candles, 'EUR/USD', 7, [], 'repeatable-batch',
      false, createSeededRandom(derivedA),
      { researchSeed: derivedA, datasetFingerprint: fingerprintA }
    );
    if (
      candidateA.genome?.signature !== candidateB.genome?.signature ||
      candidateA.optimalHorizonMinutes !== candidateB.optimalHorizonMinutes ||
      candidateA.sessionAffinity !== candidateB.sessionAffinity ||
      candidateA.id !== candidateB.id
    ) {
      throw new Error('The same search seed must reproduce the same genome, traits, and candidate identity.');
    }
    if (candidateA.researchSeed !== derivedA ||
        candidateA.datasetFingerprint !== fingerprintA ||
        candidateA.featureSchemaVersion !== 'causal-market-features-v1') {
      throw new Error('Generated candidates must carry their reproduction manifest.');
    }
  });

  await runTest('ML', 'Raw strategy scores become probabilities only after sufficient forward evidence', () => {
    const observations: Array<{ rawScore: number; outcome: 'WIN' | 'LOSS' }> = [];
    for (let bin = 0; bin < 10; bin++) {
      const rawScore = 0.50 + bin * 0.05;
      const winsInBin = 3 + bin;
      for (let sample = 0; sample < 20; sample++) {
        observations.push({
          rawScore,
          outcome: sample < winsInBin ? 'WIN' : 'LOSS',
        });
      }
    }

    const insufficient = calibratePredictionScore(0.8, observations.slice(0, 80));
    if (insufficient.status !== 'UNCALIBRATED' ||
        insufficient.probability !== null ||
        insufficient.sampleSize !== 80) {
      throw new Error('Calibration must abstain when fewer than 100 earlier outcomes are available.');
    }

    const lowScore = calibratePredictionScore(0.5, observations);
    const highScore = calibratePredictionScore(0.95, observations);
    if (lowScore.probability === null || highScore.probability === null) {
      throw new Error('A sufficiently large forward sample should produce calibrated probabilities.');
    }
    if (!(highScore.probability > lowScore.probability)) {
      throw new Error('Isotonic calibration must preserve monotonic score ordering.');
    }
    if (highScore.status !== 'OVERCONFIDENT' || highScore.probability >= 0.95) {
      throw new Error('A raw score materially above observed performance must be flagged as overconfident.');
    }
    if (
      lowScore.brierScore === null || highScore.brierScore === null ||
      lowScore.expectedCalibrationError === null ||
      highScore.expectedCalibrationError === null ||
      !Number.isFinite(lowScore.brierScore) ||
      !Number.isFinite(highScore.expectedCalibrationError)
    ) {
      throw new Error('Calibration diagnostics must include finite Brier and calibration-error values.');
    }

    let rejectedInvalidScore = false;
    try {
      calibratePredictionScore(1.2, observations);
    } catch {
      rejectedInvalidScore = true;
    }
    if (!rejectedInvalidScore) {
      throw new Error('Out-of-range raw scores must be rejected rather than silently calibrated.');
    }
  });

  await runTest('RESEARCH', 'Paper capital governor prioritizes survival over trade frequency', () => {
    const base = {
      currentEquity: 100,
      peakEquity: 100,
      dayStartingEquity: 100,
      openPositions: [],
      candidate: {
        symbol: 'EUR/USD',
        direction: 'BUY' as const,
        payoutPct: 80,
        winProbabilityLowerBound: 0.65,
        calibrationSampleSize: 200,
      },
    };

    const safe = assessPaperCapitalRisk(base);
    if (!safe.permitted || safe.reason !== 'ALLOCATED') {
      throw new Error('A sufficiently evidenced positive conservative edge should receive a tiny paper allocation.');
    }
    if (safe.suggestedStakeFraction > CONSERVATIVE_PAPER_RISK_POLICY.maximumStakeFractionPerTrade ||
        safe.suggestedStakeFraction > 0.0025) {
      throw new Error('Paper stake suggestion exceeded the strict per-contract capital cap.');
    }
    if (safe.projectedTotalOpenStakeFraction > CONSERVATIVE_PAPER_RISK_POLICY.maximumTotalOpenStakeFraction) {
      throw new Error('Paper portfolio risk exceeded its total open-stake ceiling.');
    }
    if (safe.conservativeWinProbability !== 0.65 ||
        safe.breakEvenWinProbability !== Number(payoutBreakEvenProbability(80).toFixed(4))) {
      throw new Error('Risk sizing must report the conservative probability and payout-adjusted break-even rate.');
    }

    const noEdge = assessPaperCapitalRisk({
      ...base,
      candidate: { ...base.candidate, winProbabilityLowerBound: 0.54 },
    });
    if (noEdge.permitted || noEdge.suggestedStakeFraction !== 0 || noEdge.reason !== 'NO_CONSERVATIVE_EDGE') {
      throw new Error('A conservative probability below payout break-even must produce zero stake.');
    }

    const immature = assessPaperCapitalRisk({
      ...base,
      candidate: { ...base.candidate, calibrationSampleSize: 99 },
    });
    if (immature.permitted || immature.suggestedStakeFraction !== 0 ||
        immature.reason !== 'INSUFFICIENT_CALIBRATION_EVIDENCE') {
      throw new Error('Insufficient calibrated history must abstain rather than guess.');
    }

    const badPayout = assessPaperCapitalRisk({
      ...base,
      candidate: { ...base.candidate, payoutPct: 79 },
    });
    if (badPayout.permitted || badPayout.reason !== 'PAYOUT_BELOW_FLOOR') {
      throw new Error('The capital governor must not relax the payout floor to chase returns.');
    }

    const drawdownStop = assessPaperCapitalRisk({
      ...base,
      currentEquity: 94,
      peakEquity: 100,
    });
    if (drawdownStop.permitted || drawdownStop.reason !== 'DRAWDOWN_LIMIT_REACHED') {
      throw new Error('A five-percent peak-to-equity drawdown must stop new paper allocations.');
    }

    const dailyStop = assessPaperCapitalRisk({
      ...base,
      currentEquity: 98,
      dayStartingEquity: 100,
    });
    if (dailyStop.permitted || dailyStop.reason !== 'DAILY_LOSS_LIMIT_REACHED') {
      throw new Error('The daily loss stop must prevent additional paper allocations.');
    }

    const correlated = assessPaperCapitalRisk({
      ...base,
      openPositions: [
        { symbol: 'EUR/USD', direction: 'BUY', stakeFraction: 0.0025 },
        { symbol: 'GBP/USD', direction: 'BUY', stakeFraction: 0.0025 },
      ],
      candidate: { ...base.candidate, symbol: 'AUD/USD' },
    });
    if (correlated.permitted || correlated.reason !== 'CURRENCY_CONCENTRATION_LIMIT_REACHED') {
      throw new Error('Highly correlated USD exposure must be rejected even when individual strategies look attractive.');
    }

    const alreadyFull = assessPaperCapitalRisk({
      ...base,
      openPositions: [
        { symbol: 'EUR/USD', direction: 'BUY', stakeFraction: 0.0025 },
        { symbol: 'GBP/JPY', direction: 'BUY', stakeFraction: 0.0025 },
        { symbol: 'AUD/CAD', direction: 'BUY', stakeFraction: 0.0025 },
      ],
    });
    if (alreadyFull.permitted || alreadyFull.reason !== 'OPEN_RISK_LIMIT_REACHED') {
      throw new Error('The portfolio open-risk ceiling must stop another position.');
    }
  });

  await runTest('RESEARCH', 'Opportunity schedules obey exact fresh T-3 timing and never defer the decision into the future', () => {
    const snapshotMs = Date.parse('2026-10-29T10:27:00.000Z');
    const nowMs = snapshotMs + 20_000;
    const valid = buildOpportunitySchedule(snapshotMs, 5, nowMs);
    if (!valid.valid || !valid.exactAdvanceWindow || !valid.withinProcessingWindow) {
      throw new Error('An eligible snapshot exactly three minutes before the 5m boundary should pass.');
    }
    if (valid.decisionTimeMs !== snapshotMs || valid.entryTimeMs !== Date.parse('2026-10-29T10:30:00.000Z')) {
      throw new Error('The opportunity schedule must use the observed candle close as its decision timestamp.');
    }
    const longExpiry = buildOpportunitySchedule(snapshotMs, 15, nowMs);
    if (!longExpiry.valid ||
        longExpiry.entryTimeMs !== valid.entryTimeMs ||
        longExpiry.expiryTimeMs !== valid.entryTimeMs + 15 * 60_000) {
      throw new Error('Changing opportunity expiry to 15m must keep the same M5 entry open and extend only the expiry time.');
    }
    const maxExpiry = buildOpportunitySchedule(snapshotMs, 30, nowMs);
    if (!maxExpiry.valid ||
        maxExpiry.entryTimeMs !== valid.entryTimeMs ||
        maxExpiry.expiryTimeMs !== valid.entryTimeMs + 30 * 60_000) {
      throw new Error('A 30m opportunity expiry must still start at the same M5 candle open.');
    }
    const misaligned = buildOpportunitySchedule(Date.parse('2026-10-29T10:28:00.000Z'), 5, nowMs + 60_000);
    if (misaligned.valid || misaligned.exactAdvanceWindow || !misaligned.reason?.includes('exact T')) {
      throw new Error('A non-T-3 snapshot must not be shifted forward to manufacture a valid schedule.');
    }
    const late = buildOpportunitySchedule(snapshotMs, 5, snapshotMs + 25_000);
    if (late.valid || late.withinProcessingWindow) {
      throw new Error('A snapshot processed at or after the strict 25-second deadline must be rejected.');
    }
    const future = buildOpportunitySchedule(snapshotMs, 5, snapshotMs - 1);
    if (future.valid || future.withinProcessingWindow) {
      throw new Error('A decision cannot be marked fresh before its candle snapshot exists.');
    }
  });

  await runTest('RESEARCH', 'Opportunity holdout is later, embargoed, non-overlapping and multiple-testing adjusted', () => {
    const startMs = Date.parse('2026-11-02T00:00:00.000Z');
    const candles: Candle[] = Array.from({ length: 1200 }, (_, index) => {
      const open = 1.1 + index * 0.00001;
      const close = open + 0.00001;
      const timestampMs = startMs + index * 60_000;
      return {
        symbol: 'EUR/USD',
        timestampMs,
        timestamp: new Date(timestampMs).toISOString(),
        open,
        high: close + 0.000002,
        low: open - 0.000002,
        close,
        volume: 100,
        source: 'imported',
      };
    });
    const holdoutStartIndex = 500;
    const rows = Array.from({ length: 1100 }, (_, offset) => ({
      index: 60 + offset,
      vector: Array.from({ length: 19 }, () => 0.1),
    }));
    const visited: number[] = [];
    const result = evaluateOpportunityHoldout(
      candles,
      rows,
      holdoutStartIndex,
      5,
      row => {
        visited.push(row.index);
        return 'BUY';
      }
    );

    if (!visited.length || visited.some(index => index < holdoutStartIndex)) {
      throw new Error('The holdout evaluator read a feature row from before its reserved chronological boundary.');
    }
    if (visited.length > 1 && visited.some((index, position) =>
      position > 0 && index - visited[position - 1] < 5
    )) {
      throw new Error('Holdout trades must not overlap within the selected expiry horizon.');
    }
    if (result.sampleSize < 100 || result.wins !== result.sampleSize || result.losses !== 0) {
      throw new Error('The independent holdout should count only the later, exact-expiry directional outcomes.');
    }
    if (result.lowerConfidenceBound === null ||
        result.lowerConfidenceBound <= binaryBreakEvenWinRate(80) ||
        result.expectedValueLowerBound === null ||
        result.expectedValueLowerBound <= 0) {
      throw new Error('The multiple-testing-adjusted lower bound must be used for any claimed edge.');
    }

    const noSignals = evaluateOpportunityHoldout(
      candles,
      rows,
      holdoutStartIndex,
      5,
      () => null
    );
    if (noSignals.sampleSize !== 0 || noSignals.lowerConfidenceBound !== null) {
      throw new Error('A candidate with no test triggers must remain unvalidated, not inherit the analogue sample.');
    }
  });

  await runTest('RESEARCH', 'Human direction revisions are separately audited and never overwrite the AI hypothesis', () => {
    // Simulate the exact candle-close moment deterministically; wall-clock test timing is irrelevant.
    let snapshotMs = Math.ceil((Date.now() + 60_000) / 60_000) * 60_000;
    let schedule = buildOpportunitySchedule(snapshotMs, 10, snapshotMs + 1_000);
    let scheduleSearchAttempts = 0;
    while ((!schedule.exactAdvanceWindow || !schedule.marketIntervalOpen) && scheduleSearchAttempts < 4320) {
      snapshotMs += 60_000;
      schedule = buildOpportunitySchedule(snapshotMs, 10, snapshotMs + 1_000);
      scheduleSearchAttempts++;
    }
    if (scheduleSearchAttempts >= 4320 || !schedule.valid) {
      throw new Error('Test could not locate a fresh exact T-3 open-FX decision window.');
    }
    const fixtureNowMs = snapshotMs + 1_000;
    const now = new Date(fixtureNowMs).toISOString();
    const validEntryMs = schedule.entryTimeMs;
    const terminalPrices = Array.from({ length: 120 }, (_, index) =>
      index < 80 ? 1.10100 + (index % 5) * 0.00001 : 1.09900 - (index % 5) * 0.00001
    );
    const original: TradeOpportunity = {
      id: 'opportunity-parent-test',
      batchId: 'opportunity-batch-test',
      symbol: 'EUR/USD',
      hypothesisType: 'TREND_CONTINUATION',
      hypothesisName: 'Test trend hypothesis',
      hypothesis: 'Test-only opportunity to exercise the human revision audit.',
      sourceKind: 'EXPLORATORY_HEURISTIC',
      direction: 'BUY',
      rawHypothesisScore: 0.4,
      activationThreshold: 0.16,
      horizonMinutes: 10,
      generatedAt: now,
      snapshotAt: new Date(snapshotMs).toISOString(),
      staleAfter: new Date(snapshotMs + 25_000).toISOString(),
      entryTimeUtc: new Date(validEntryMs).toISOString(),
      expiryTimeUtc: new Date(validEntryMs + 10 * 60_000).toISOString(),
      snapshotPrice: 1.10000,
      proposedEntryPrice: 1.10000,
      dataSource: 'imported',
      marketDataQuality: 95,
      datasetFingerprint: 'sha256:test',
      featureSchemaVersion: 'causal-market-features-v1',
      modelVersion: 'opportunity-research-test',
      marketFeatureVector: Array.from({ length: 19 }, () => 0),
      recentPriceHistory: [],
      forecast: {
        status: 'AVAILABLE',
        points: [],
        terminalPrices,
        analogueCount: 120,
        meanDistance: 0.12,
        winRate: 0.6667,
        lowerConfidenceBound: 0.59,
        payoutBreakEvenProbability: binaryBreakEvenWinRate(80),
        expectedValueLowerBound: 0.262,
      },
      audit: {
        status: 'SHORTLISTED',
        rankScore: 80,
        holdoutSampleSize: 120,
        holdoutWins: 112,
        holdoutLosses: 8,
        holdoutScratches: 0,
        holdoutWinRate: 112 / 120,
        holdoutLowerConfidenceBound: 0.70,
        holdoutExpectedValueLowerBound: 0.26,
        holdoutWindowStatus: 'FRESH',
        holdoutWindowStartUtc: new Date(validEntryMs - 10 * 60 * 1000).toISOString(),
        holdoutWindowEndUtc: new Date(validEntryMs).toISOString(),
        reasons: ['Test fixture'],
        counterEvidence: [],
        auditedAt: now,
      },
      humanDecision: { status: 'PENDING', decidedAt: now },
    };

    const revisedBuy = opportunityEngine.reviseDirection(original, 'BUY', original.proposedEntryPrice, fixtureNowMs);
    if (revisedBuy.id === original.id ||
        revisedBuy.direction !== 'BUY' ||
        revisedBuy.humanDecision.parentOpportunityId !== original.id) {
      throw new Error('A human revision must create a linked, separate opportunity record.');
    }
    if (revisedBuy.audit.status !== 'SHORTLISTED') {
      throw new Error('A direction with sufficient conservative historical evidence should remain shortlist-eligible.');
    }

    const revisedSell = opportunityEngine.reviseDirection(original, 'SELL', original.proposedEntryPrice, fixtureNowMs);
    if (revisedSell.audit.status !== 'INSUFFICIENT_EVIDENCE' ||
        revisedSell.audit.holdoutSampleSize !== 0 ||
        revisedSell.forecast.lowerConfidenceBound === null ||
        revisedSell.forecast.lowerConfidenceBound >= revisedBuy.forecast.lowerConfidenceBound!) {
      throw new Error('A human direction override must not reuse the original model direction\'s holdout approval.');
    }
    const changedEntry = opportunityEngine.reviseDirection(original, 'BUY', original.proposedEntryPrice + 0.00002, fixtureNowMs);
    if (changedEntry.audit.status !== 'INSUFFICIENT_EVIDENCE' ||
        changedEntry.audit.holdoutSampleSize !== 0) {
      throw new Error('A changed manual entry reference must receive fresh independent validation before shortlisting.');
    }
    if (original.direction !== 'BUY' || original.audit.status !== 'SHORTLISTED' ||
        original.humanDecision.status !== 'PENDING') {
      throw new Error('Human revision must never mutate the original AI hypothesis.');
    }
  });

  await runTest('RESEARCH', 'Loss forensics never promotes heuristic causes into facts', () => {
    const legacy: LossAutopsy = {
      id: 'autopsy_legacy-test',
      signalId: 'legacy-test',
      symbol: 'EUR/USD',
      direction: 'BUY',
      strategyName: 'Legacy heuristic strategy',
      entryPrice: 1.1,
      exitPrice: 1.099,
      marketSession: 'London',
      rootCause: 'SPREAD_EXPANSION_SLIPPAGE',
      rootCauseExplanation: 'Old heuristic asserted spread expansion caused the loss.',
      lessonsLearned: ['Reject all trades during this session.'],
      antidoteStrategyGeneId: 'fake-antidote',
      antidoteStrategyName: 'Unverified antidote',
      antidoteFormula: 'invented_formula(x)',
      antidoteOperator: 'tanh_polynomial',
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    const safe = sanitizeLossAutopsy(legacy);
    if (safe.rootCause !== 'OBSERVED_ADVERSE_SETTLEMENT' ||
        safe.evidenceStatus !== 'OBSERVATION_ONLY') {
      throw new Error('A legacy heuristic cause must be downgraded to an observation.');
    }
    if (!safe.legacyUnverifiedExplanation?.includes('spread expansion caused the loss')) {
      throw new Error('The old explanation should be retained only as explicitly unverified audit history.');
    }
    if (safe.antidoteStrategyGeneId || safe.antidoteStrategyName || safe.antidoteFormula || safe.antidoteOperator) {
      throw new Error('Unverified antidote artifacts must not remain active.');
    }
    if (JSON.stringify(safe.lessonsLearned) !== JSON.stringify(OBSERVATION_ONLY_LESSONS)) {
      throw new Error('An individual loss must not be converted into validated lessons.');
    }
    const repeated = sanitizeLossAutopsy(safe);
    if (repeated.legacyUnverifiedExplanation !== safe.legacyUnverifiedExplanation ||
        JSON.stringify(repeated.lessonsLearned) !== JSON.stringify(safe.lessonsLearned)) {
      throw new Error('Loss-evidence sanitization must be idempotent across restarts.');
    }
  });

  await runTest('MARKET_HOURS', 'Spot FX weekend closure follows New York time and DST', () => {
    const cases: Array<[string, boolean]> = [
      ['2026-10-30T20:59:00.000Z', true],  // Friday 16:59 EDT
      ['2026-10-30T21:00:00.000Z', false], // Friday 17:00 EDT
      ['2026-10-31T16:00:00.000Z', false], // Saturday
      ['2026-11-01T21:59:00.000Z', false], // Sunday 16:59 EST
      ['2026-11-01T22:00:00.000Z', true],  // Sunday 17:00 EST
    ];
    for (const [timestamp, expected] of cases) {
      const actual = isForexMarketOpenAt(timestamp);
      if (actual !== expected) {
        throw new Error(`${timestamp}: expected marketOpen=${expected}, received ${actual}.`);
      }
    }
    const closed = getForexMarketState('2026-10-31T16:00:00.000Z');
    if (closed.isOpen || closed.status !== 'WEEKEND_CLOSED') {
      throw new Error('Saturday must report the explicit weekend-closed state.');
    }
    const winterReopen = getForexMarketState('2026-11-01T21:59:00.000Z');
    if (!winterReopen.message.includes('Monday 3:30 AM IST') || /UTC|New York|ET/.test(winterReopen.message)) {
      throw new Error(`Weekend reopen must be displayed in IST only; received: ${winterReopen.message}`);
    }
    const summerReopen = getForexMarketState('2026-07-05T20:59:00.000Z');
    if (!summerReopen.message.includes('Monday 2:30 AM IST') || /UTC|New York|ET/.test(summerReopen.message)) {
      throw new Error(`DST-adjusted summer reopen must be displayed in IST only; received: ${summerReopen.message}`);
    }
    const session = getReportingSessionFromTimestamp('2026-11-02T19:00:00.000Z');
    if (!session.istRange.endsWith('IST') || !/AM|PM/.test(session.istRange) ||
        /UTC|ET/.test(session.hoursLabel)) {
      throw new Error('Session reporting labels must be readable IST-only times.');
    }
  });

  await runTest('MARKET_HOURS', 'Entry-to-expiry interval cannot cross the weekly FX close', () => {
    if (!isForexMarketIntervalOpen(
      Date.parse('2026-10-30T20:30:00.000Z'), // Friday 16:30 EDT
      Date.parse('2026-10-30T20:55:00.000Z')  // Friday 16:55 EDT
    )) {
      throw new Error('A contract fully contained before Friday close should remain eligible.');
    }
    if (isForexMarketIntervalOpen(
      Date.parse('2026-10-30T20:50:00.000Z'), // Friday 16:50 EDT
      Date.parse('2026-10-30T21:20:00.000Z')  // Friday 17:20 EDT
    )) {
      throw new Error('A contract expiring after Friday close must be rejected.');
    }
    if (isForexMarketIntervalOpen(
      Date.parse('2026-10-30T20:30:00.000Z'),
      Date.parse('2026-11-01T22:30:00.000Z')
    )) {
      throw new Error('An interval crossing the entire weekend must be rejected.');
    }
    if (!isForexMarketIntervalOpen(
      Date.parse('2026-11-01T22:10:00.000Z'), // Sunday 17:10 EST
      Date.parse('2026-11-01T22:25:00.000Z')
    )) {
      throw new Error('A short interval after the Sunday reopen should be eligible.');
    }
  });

  await runTest('MARKET_HOURS', 'Legacy weekend-created signals cannot be revived after the weekly reopen', () => {
    const fridayDecision = Date.parse('2026-10-30T20:40:00.000Z'); // Friday 16:40 EDT
    const fridayEntry = Date.parse('2026-10-30T20:45:00.000Z');
    const fridayExpiry = Date.parse('2026-10-30T20:55:00.000Z');
    if (!isForexSignalScheduleValid(fridayDecision, fridayEntry, fridayExpiry)) {
      throw new Error('A valid Friday decision and contract wholly before the weekly close should remain valid.');
    }
    const saturdayDecision = Date.parse('2026-10-31T16:00:00.000Z');
    const sundayEntry = Date.parse('2026-11-01T22:10:00.000Z');
    const sundayExpiry = Date.parse('2026-11-01T22:20:00.000Z');
    if (isForexSignalScheduleValid(saturdayDecision, sundayEntry, sundayExpiry)) {
      throw new Error('A signal predicted on Saturday must remain cancelled after the Sunday reopen.');
    }
    const sundayPreOpenDecision = Date.parse('2026-11-01T21:50:00.000Z'); // Sunday 16:50 EST
    if (isForexSignalScheduleValid(sundayPreOpenDecision, sundayEntry, sundayExpiry)) {
      throw new Error('A decision made before the Sunday reopen cannot carry into the new trading week.');
    }
    if (isForexSignalScheduleValid(fridayDecision, sundayEntry, sundayExpiry)) {
      throw new Error('A Friday decision cannot remain pending across the weekend and enter Sunday.');
    }
  });

  await runTest('MARKET_HOURS', 'Session attribution separates Asia, London, overlap, New York and late New York', () => {
    const cases: Array<[string, string]> = [
      ['2026-11-02T07:59:00.000Z', 'ASIA'],           // Monday 02:59 EST
      ['2026-11-02T08:00:00.000Z', 'LONDON'],         // Monday 03:00 EST
      ['2026-11-02T13:00:00.000Z', 'OVERLAP'],       // Monday 08:00 EST
      ['2026-11-02T17:00:00.000Z', 'NEW_YORK'],      // Monday 12:00 EST
      ['2026-11-02T19:00:00.000Z', 'LATE_NEW_YORK'], // Monday 14:00 EST
    ];
    for (const [timestamp, expected] of cases) {
      const actual = getReportingSessionFromTimestamp(timestamp).id;
      if (actual !== expected) {
        throw new Error(`${timestamp}: expected ${expected}, received ${actual}.`);
      }
    }
    const summerOverlap = getReportingSessionFromTimestamp('2026-07-06T12:00:00.000Z');
    const winterOverlap = getReportingSessionFromTimestamp('2026-11-02T13:00:00.000Z');
    if (summerOverlap.utcRange !== '12:00–16:00 UTC' || winterOverlap.utcRange !== '13:00–17:00 UTC') {
      throw new Error('Session UTC labels must follow the New York DST offset rather than a fixed UTC schedule.');
    }
    // Preserve the old classifier consumed by strategy sessionAffinity and regime logic.
    if (getSessionFromTimestamp('2026-11-02T19:00:00.000Z').id !== 'NEW_YORK') {
      throw new Error('Reporting-only session buckets must not change existing trading session-affinity semantics.');
    }
  });

  await runTest('DATA', 'Binary payout settlement (win, loss, push and payout floor)', () => {
    const win = calculateBinarySettlement('BUY', 1.10000, 1.10010, 80);
    if (win.outcome !== 'WIN' || win.netReturnUnits !== 0.8) {
      throw new Error('A winning binary contract must return +0.80 stake units at an 80% payout.');
    }
    const loss = calculateBinarySettlement('BUY', 1.10010, 1.10000, 80);
    if (loss.outcome !== 'LOSS' || loss.netReturnUnits !== -1) {
      throw new Error('A losing binary contract must return -1.00 stake units.');
    }
    const push = calculateBinarySettlement('SELL', 1.10000, 1.10000, 80);
    if (push.outcome !== 'SCRATCH' || push.netReturnUnits !== 0) {
      throw new Error('An exact strike tie must be recorded as a zero-return push.');
    }
    const lowPayout = calculateBinarySettlement('BUY', 1.1, 1.1001, 75);
    if (lowPayout.netReturnUnits !== 0.75) {
      throw new Error('Observed payout must be reflected exactly in the binary return.');
    }
  });

  await runTest('ML', 'Online Bayesian posterior updates exactly once per decisive outcome', () => {
    const prior = { alpha: 1, beta: 1 };
    const afterWin = updateBetaPosterior(prior, 'WIN');
    const afterLoss = updateBetaPosterior(afterWin, 'LOSS');
    const afterScratch = updateBetaPosterior(afterLoss, 'SCRATCH');
    if (afterWin.alpha !== 2 || afterWin.beta !== 1) {
      throw new Error('A WIN must increment only the Beta alpha parameter.');
    }
    if (afterLoss.alpha !== 2 || afterLoss.beta !== 2) {
      throw new Error('A LOSS must increment only the Beta beta parameter.');
    }
    if (afterScratch.alpha !== 2 || afterScratch.beta !== 2) {
      throw new Error('A SCRATCH must not alter the decisive-outcome posterior.');
    }
    if (!(bayesianUcbScore(afterLoss, 2) > 0 && bayesianUcbScore(afterLoss, 2) <= 2)) {
      throw new Error('Bayesian UCB score must be finite and bounded for a valid posterior.');
    }
  });

  await runTest('RESEARCH', 'Payout-aware confidence gates replace arbitrary accuracy targets', () => {
    const breakEven = binaryBreakEvenWinRate(80);
    if (Math.abs(breakEven - (1 / 1.8)) > 1e-10) {
      throw new Error('The 80% payout break-even rate must be exactly 1/1.8.');
    }
    const validationLower = wilsonLowerBound(150, 200);
    const adjustedTestLower = wilsonLowerBound(300, 400, 2.576);
    if (validationLower <= breakEven || adjustedTestLower <= breakEven) {
      throw new Error('Strong positive evidence must clear the payout-aware confidence bounds.');
    }
    const metrics = {
      sampleCount: 400,
      testScoredSampleSize: 400,
      trainScoredSampleSize: 200,
      validationScoredSampleSize: 200,
      trainWinRate: 0.72,
      validationWinRate: 0.75,
      testWinRate: 0.75,
      testBlockWinRates: [0.72, 0.74, 0.75],
      binaryPayoutPct: 80,
      expectedValueUnits: 0.35,
      profitFactor: 1.35,
      confidenceInterval95: [0.68, 0.81] as [number, number],
      multipleTestingLowerBound: adjustedTestLower,
    };
    if (!hasSufficientHistoricalApprovalEvidence(metrics, 'BACKTESTED', 400)) {
      throw new Error('A fully evidenced, payout-positive sample should pass the historical eligibility gate.');
    }
    if (hasSufficientHistoricalApprovalEvidence({
      ...metrics,
      multipleTestingLowerBound: breakEven,
    }, 'BACKTESTED', 400)) {
      throw new Error('A strategy that fails the multiple-comparison-adjusted holdout bound must not qualify.');
    }
    if (hasSufficientHistoricalApprovalEvidence({
      ...metrics,
      expectedValueUnits: -0.01,
    }, 'BACKTESTED', 400)) {
      throw new Error('Positive accuracy without positive payout-adjusted expectancy must not qualify.');
    }
  });

  await runTest('ML', 'historical approval diagnostics explain the exact failed gates without changing eligibility', () => {
    const breakEven = binaryBreakEvenWinRate(80);
    const adjustedTestLower = wilsonLowerBound(0.75 * 400, 400, 2.576);
    const evidence = {
      testScoredSampleSize: 400,
      trainScoredSampleSize: 200,
      validationScoredSampleSize: 200,
      trainWinRate: 0.72,
      validationWinRate: 0.75,
      testWinRate: 0.75,
      testBlockWinRates: [0.72, 0.74, 0.75],
      binaryPayoutPct: 80,
      expectedValueUnits: 0.35,
      profitFactor: 1.35,
      confidenceInterval95: [0.68, 0.81] as [number, number],
      multipleTestingLowerBound: adjustedTestLower,
    };
    const passingReasons = getHistoricalApprovalFailureReasons(evidence, 'BACKTESTED', 400);
    if (passingReasons.length !== 0) {
      throw new Error('A fully approved candidate must have no diagnostic blockers: ' + passingReasons.join(', '));
    }
    const failingReasons = getHistoricalApprovalFailureReasons({
      ...evidence,
      testScoredSampleSize: 120,
      binaryPayoutPct: 79,
      expectedValueUnits: -0.01,
      profitFactor: 0.9,
      multipleTestingLowerBound: breakEven,
    }, 'UNVALIDATED', 120);
    for (const required of [
      'ACCURACY_NOT_BACKTESTED',
      'TOTAL_SAMPLE_BELOW_300',
      'TEST_SCORED_SAMPLE_BELOW_300',
      'PAYOUT_BELOW_80',
      'EXPECTED_VALUE_NOT_POSITIVE',
      'PROFIT_FACTOR_BELOW_1_15',
      'MULTIPLE_TESTING_BOUND_NOT_ABOVE_BREAK_EVEN',
    ]) {
      if (!failingReasons.includes(required)) {
        throw new Error('Missing diagnostic reason ' + required + '; found ' + failingReasons.join(', '));
      }
    }
    if (hasSufficientHistoricalApprovalEvidence(evidence, 'BACKTESTED', 400) !==
        (passingReasons.length === 0)) {
      throw new Error('Diagnostic reason reporting must exactly match the existing historical eligibility decision.');
    }
  });

  await runTest('ML', 'Only strategies validated under the fixed M5-entry dynamic-expiry contract can qualify', () => {
    const searchBatchId = `fixed_m5_contract_test_${Date.now()}`;
    const candidate = researchEngine.synthesizeInfiniteNovelStrategy(
      [],
      'EUR/USD',
      999,
      [],
      searchBatchId,
      false,
      createSeededRandom(searchBatchId),
      {
        researchSeed: 'fixed-m5-entry-expiry-research-seed',
        datasetFingerprint: 'sha256:fixed-m5-entry-expiry-test',
      }
    );
    const adjustedTestLower = wilsonLowerBound(300, 400, 2.576);
    const validMetrics = {
      trainSampleSize: 200,
      trainScoredSampleSize: 200,
      validationSampleSize: 200,
      validationScoredSampleSize: 200,
      trainWinRate: 0.72,
      validationWinRate: 0.75,
      testWinRate: 0.75,
      testAccuracy: 0.75,
      testSampleSize: 400,
      testScoredSampleSize: 400,
      testWins: 300,
      testLosses: 100,
      binaryPayoutPct: 80,
      excludedZeroVolumeFlatCandles: 0,
      expectedValueUnits: 0.35,
      profitFactor: 1.35,
      confidenceInterval95: [0.68, 0.81] as [number, number],
      multipleTestingLowerBound: adjustedTestLower,
      testBlockWinRates: [0.72, 0.74, 0.75],
      trainPeriod: { start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z' },
      validationPeriod: { start: '2026-02-02T00:00:00.000Z', end: '2026-02-20T00:00:00.000Z' },
      testPeriod: { start: '2026-02-22T00:00:00.000Z', end: '2026-03-30T00:00:00.000Z' },
    };

    Object.assign(candidate, {
      status: 'PAPER_TRADING',
      accuracyStatus: 'BACKTESTED',
      verifiedAccuracy: 0.75,
      sampleCount: 400,
      backtestMetrics: validMetrics,
    });
    if (candidate.featureSchemaVersion !== FEATURE_SCHEMA_VERSION ||
        candidate.researchEngineVersion !== RESEARCH_ENGINE_VERSION) {
      throw new Error('A newly researched candidate must carry the current execution-contract version.');
    }

    const oldEngine = {
      ...candidate,
      id: `${candidate.id}_old_engine`,
      researchEngineVersion: 'research-engine-v1',
    };
    const oldFeatures = {
      ...candidate,
      id: `${candidate.id}_old_features`,
      featureSchemaVersion: 'causal-market-features-v0',
    };
    db.addSynthesizedStrategy(candidate);
    db.addSynthesizedStrategy(oldEngine);
    db.addSynthesizedStrategy(oldFeatures);

    const eligibleIds = new Set(db.getPaperTradingStrategies().map(gene => gene.id));
    if (!eligibleIds.has(candidate.id)) {
      throw new Error('A fully approved strategy evaluated under the current M5-entry contract should remain eligible.');
    }
    if (eligibleIds.has(oldEngine.id) || eligibleIds.has(oldFeatures.id)) {
      throw new Error('Old entry-contract historical results must not qualify under the new M5-entry execution rules.');
    }

    const diagnostics = db.getStrategyEligibilityDiagnostics();
    if ((diagnostics.historicalFailureCounts.RESEARCH_CONTRACT_VERSION_MISMATCH || 0) < 1 ||
        (diagnostics.historicalFailureCounts.FEATURE_SCHEMA_VERSION_MISMATCH || 0) < 1) {
      throw new Error('The old contract and feature-schema exclusions must be visible in strategy diagnostics.');
    }

    for (const gene of [candidate, oldEngine, oldFeatures]) {
      gene.status = 'REJECTED';
      db.updateSynthesizedStrategy(gene);
    }
  });

  await runTest('ML', 'Only strategies validated under fixed M5-entry dynamic-expiry contract can qualify', () => {
    const searchBatchId = `fixed_m5_contract_test_${Date.now()}`;
    const candidate = researchEngine.synthesizeInfiniteNovelStrategy(
      [],
      'EUR/USD',
      999,
      [],
      searchBatchId,
      false,
      createSeededRandom(searchBatchId),
      {
        researchSeed: 'fixed-m5-entry-expiry-research-seed',
        datasetFingerprint: 'sha256:fixed-m5-entry-expiry-test',
      }
    );
    const adjustedTestLower = wilsonLowerBound(300, 400, 2.576);
    const validMetrics = {
      trainSampleSize: 200,
      trainScoredSampleSize: 200,
      validationSampleSize: 200,
      validationScoredSampleSize: 200,
      trainWinRate: 0.72,
      validationWinRate: 0.75,
      testWinRate: 0.75,
      testAccuracy: 0.75,
      testSampleSize: 400,
      testScoredSampleSize: 400,
      testWins: 300,
      testLosses: 100,
      binaryPayoutPct: 80,
      excludedZeroVolumeFlatCandles: 0,
      expectedValueUnits: 0.35,
      profitFactor: 1.35,
      confidenceInterval95: [0.68, 0.81] as [number, number],
      multipleTestingLowerBound: adjustedTestLower,
      testBlockWinRates: [0.72, 0.74, 0.75],
      trainPeriod: { start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z' },
      validationPeriod: { start: '2026-02-02T00:00:00.000Z', end: '2026-02-20T00:00:00.000Z' },
      testPeriod: { start: '2026-02-22T00:00:00.000Z', end: '2026-03-30T00:00:00.000Z' },
    };

    Object.assign(candidate, {
      status: 'PAPER_TRADING',
      accuracyStatus: 'BACKTESTED',
      verifiedAccuracy: 0.75,
      sampleCount: 400,
      backtestMetrics: validMetrics,
    });
    if (candidate.featureSchemaVersion !== FEATURE_SCHEMA_VERSION ||
        candidate.researchEngineVersion !== RESEARCH_ENGINE_VERSION) {
      throw new Error('A newly researched candidate must carry the current execution-contract version.');
    }

    const oldEngine = {
      ...candidate,
      id: `${candidate.id}_old_engine`,
      researchEngineVersion: 'research-engine-v1',
    };
    const oldFeatures = {
      ...candidate,
      id: `${candidate.id}_old_features`,
      featureSchemaVersion: 'causal-market-features-v0',
    };
    db.addSynthesizedStrategy(candidate);
    db.addSynthesizedStrategy(oldEngine);
    db.addSynthesizedStrategy(oldFeatures);

    const eligibleIds = new Set(db.getPaperTradingStrategies().map(gene => gene.id));
    if (!eligibleIds.has(candidate.id)) {
      throw new Error('A fully approved strategy evaluated under the current M5-entry contract should remain eligible.');
    }
    if (eligibleIds.has(oldEngine.id) || eligibleIds.has(oldFeatures.id)) {
      throw new Error('Old entry-contract historical results must not qualify under the new M5-entry execution rules.');
    }

    const diagnostics = db.getStrategyEligibilityDiagnostics();
    if ((diagnostics.historicalFailureCounts.RESEARCH_CONTRACT_VERSION_MISMATCH || 0) < 1 ||
        (diagnostics.historicalFailureCounts.FEATURE_SCHEMA_VERSION_MISMATCH || 0) < 1) {
      throw new Error('The old contract and feature-schema exclusions must be visible in strategy diagnostics.');
    }

    for (const gene of [candidate, oldEngine, oldFeatures]) {
      gene.status = 'REJECTED';
      db.updateSynthesizedStrategy(gene);
    }
  });

  await runTest('RESEARCH', 'Trade outcomes cannot cross chronological partition boundaries', () => {
    const start = Date.parse('2026-01-01T00:00:00.000Z');
    const end = start + 10 * 60_000;
    if (!outcomeFitsResearchWindow(start + 2 * 60_000, 5, start, end)) {
      throw new Error('An outcome fully contained in a partition must be retained.');
    }
    if (outcomeFitsResearchWindow(start + 7 * 60_000, 5, start, end)) {
      throw new Error('A trade whose expiry crosses the partition end must be purged.');
    }
    if (outcomeFitsResearchWindow(start - 1, 5, start, end)) {
      throw new Error('A trade whose entry precedes the partition must be purged.');
    }
    if (!outcomeFitsResearchWindow(start + 5 * 60_000, 5, start, end)) {
      throw new Error('An outcome expiring exactly at the exclusive partition boundary is valid.');
    }
  });

  await runTest('RESEARCH', 'Previously inspected chronological holdout periods cannot be reused', () => {
    const windows = [{
      symbol: 'EUR/USD',
      startUtc: '2026-01-01T00:00:00.000Z',
      endUtc: '2026-02-01T00:00:00.000Z',
    }];
    const start = Date.parse('2026-01-31T23:00:00.000Z');
    const overlapEnd = Date.parse('2026-02-15T00:00:00.000Z');
    const nextStart = Date.parse('2026-02-01T00:00:00.000Z');
    const nextEnd = Date.parse('2026-03-01T00:00:00.000Z');
    const otherPair = 'GBP/USD';
    if (!doesResearchHoldoutOverlap(windows, 'EUR/USD', start, overlapEnd)) {
      throw new Error('A holdout interval overlapping one minute of a consumed window must be rejected.');
    }
    if (!doesResearchHoldoutOverlap(windows, 'EUR/USD', nextStart, nextEnd)) {
      throw new Error('A shared boundary must count as overlap to prevent duplicate candle grading.');
    }
    if (doesResearchHoldoutOverlap(windows, 'EUR/USD', Date.parse('2026-02-01T00:01:00Z'), nextEnd)) {
      throw new Error('A wholly future test interval must be available for a future research batch.');
    }
    if (doesResearchHoldoutOverlap(windows, otherPair, start, overlapEnd)) {
      throw new Error('Holdout reservations must be isolated by currency pair.');
    }
  });

  await runTest('ML', 'First-generation genomes have real empty lineage and no inert coefficients', () => {
    const gene = researchEngine.synthesizeInfiniteNovelStrategy(
      [],
      'EUR/USD',
      1,
      [],
      'test-first-generation',
      false
    );
    if (!gene.genome) throw new Error('A new candidate must contain an executable symbolic genome.');
    if (gene.parents.length !== 0) {
      throw new Error('A first-generation genome must not claim a fictional parent.');
    }
    if (gene.operatorParameters !== undefined || gene.nonLinearOperator !== undefined) {
      throw new Error('New symbolic genomes must not carry inactive legacy coefficients or operator labels.');
    }
    if (gene.accuracyStatus !== 'UNVALIDATED' || gene.verifiedAccuracy !== 0 || gene.sampleCount !== 0) {
      throw new Error('A newly generated genome must have no accuracy claim or test sample.');
    }
  });

  await runTest('ML', 'Each genome controls its own inherited activation threshold', () => {
    const candles = makeM1TestCandles('EUR/USD', 120);
    const candle = candles[candles.length - 1];
    const previous = candles[candles.length - 2];
    const closes = candles.map(item => item.close);
    const ema9 = researchEngine.calculateEMA(closes, 9);
    const ema21 = researchEngine.calculateEMA(closes, 21);
    const rsi14 = researchEngine.calculateRSI(closes, 14);
    const makeGene = (threshold: number): SynthesizedStrategyGene => ({
      id: 'threshold-' + threshold,
      name: 'Threshold test',
      code: '',
      generation: 1,
      mathematicalFormula: 'constant activation test',
      parents: [],
      mutationRate: 0.2,
      nonLinearOperator: 'tanh_polynomial',
      genome: {
        version: 1,
        expression: { kind: 'constant', value: 1.55 },
        activationThreshold: threshold,
        signature: 'constant-1.55-' + threshold,
        complexity: 1,
      },
      symbol: 'EUR/USD',
      optimalHorizonMinutes: 5,
      sessionAffinity: 'ALL',
      verifiedAccuracy: 0,
      sampleCount: 0,
      status: 'EXPERIMENTING',
      scientificHypothesis: 'Test threshold execution.',
      whyHumansMissThis: 'Not a trading candidate.',
      createdAt: new Date().toISOString(),
    });
    const permissive = researchEngine.evaluateSynthesizedGeneSignal(
      makeGene(0.64), candle, previous, closes, ema9, ema21, rsi14
    );
    const strict = researchEngine.evaluateSynthesizedGeneSignal(
      makeGene(0.70), candle, previous, closes, ema9, ema21, rsi14
    );
    if (!permissive.shouldTrigger) {
      throw new Error('The 0.64 genome threshold should admit an activation score near 0.65.');
    }
    if (strict.shouldTrigger) {
      throw new Error('The 0.70 genome threshold should reject the same activation score.');
    }
  });

  await runTest('RESEARCH', 'Historical promotion gate is payout-aware and confidence-adjusted', () => {
    const evidence = {
      sampleCount: 300,
      testScoredSampleSize: 300,
      trainScoredSampleSize: 180,
      validationScoredSampleSize: 180,
      trainWinRate: 0.64,
      validationWinRate: 0.67,
      testWinRate: 0.67,
      testBlockWinRates: [0.62, 0.67, 0.72],
      binaryPayoutPct: 80,
      expectedValueUnits: 0.206,
      profitFactor: 1.20,
      confidenceInterval95: [0.61, 0.72] as [number, number],
      multipleTestingLowerBound: 0.58,
    };
    if (!hasSufficientHistoricalApprovalEvidence(evidence, 'BACKTESTED', 300)) {
      throw new Error('A payout-positive sample whose multiplicity-adjusted lower bound clears break-even should qualify for paper testing.');
    }
    if (hasSufficientHistoricalApprovalEvidence(
      { ...evidence, multipleTestingLowerBound: 0.54 },
      'BACKTESTED',
      300
    )) {
      throw new Error('A sample whose multiplicity-adjusted lower bound does not clear payout break-even must be rejected.');
    }
    if (hasSufficientHistoricalApprovalEvidence(
      { ...evidence, binaryPayoutPct: 79 },
      'BACKTESTED',
      300
    )) {
      throw new Error('Historical approval must enforce the permanent 80% minimum payout floor.');
    }
    if (hasSufficientHistoricalApprovalEvidence(evidence, 'UNVALIDATED', 300)) {
      throw new Error('Candidates must never receive a historical approval from metrics without BACKTESTED status.');
    }
  });

  await runTest('ML', 'Mature forward evidence steers or removes genetic parents', () => {
    const discovery = {
      trainScoredTrades: 180,
      validationScoredTrades: 180,
      trainWinRate: 0.74,
      validationWinRate: 0.74,
      validationExpectedValueUnits: 0.20,
      validationProfitFactor: 1.35,
      minimumPayoutPct: 80,
    };
    const makeGenome = (id: string, feature: 'return_1' | 'return_3') => ({
      id,
      genome: {
        version: 1 as const,
        expression: { kind: 'feature' as const, feature },
        activationThreshold: 0.70,
        signature: id,
        complexity: 1,
      },
      discoveryMetrics: { ...discovery },
    });
    const strongPaper = {
      trades: 120,
      scoredTrades: 120,
      wins: 90,
      losses: 30,
      scratches: 0,
      winRate: 0.75,
      allTimeWinRate: 0.75,
      rollingWinRates: [],
      netReturnUnits: 30,
      minimumPayoutPct: 80,
      netPips: 0,
      profitFactor: 1.5,
      confidenceInterval95: [0.67, 0.82] as [number, number],
    };
    const matureStrong = { ...makeGenome('mature-strong', 'return_1'), paperMetrics: strongPaper };
    const smallNoisy = {
      ...makeGenome('small-noisy', 'return_3'),
      paperMetrics: {
        ...strongPaper,
        trades: 40,
        scoredTrades: 40,
        wins: 12,
        losses: 28,
        winRate: 0.30,
        netReturnUnits: -16,
        confidenceInterval95: [0.18, 0.45] as [number, number],
      },
    };
    const matureBad = {
      ...makeGenome('mature-bad', 'return_3'),
      paperMetrics: {
        ...strongPaper,
        wins: 55,
        losses: 45,
        winRate: 0.55,
        netReturnUnits: -2,
        profitFactor: 0.90,
        confidenceInterval95: [0.45, 0.64] as [number, number],
      },
    };
    if (!hasSufficientForwardParentEvidence(strongPaper)) {
      throw new Error('A genuinely positive mature paper sample should qualify as forward parent evidence.');
    }
    if (hasSufficientForwardParentEvidence(matureBad.paperMetrics)) {
      throw new Error('Negative or break-even paper performance must not qualify as parent evidence.');
    }
    if (!(evolutionaryParentFitness(matureStrong) > evolutionaryParentFitness(makeGenome('validation-only', 'return_3')))) {
      throw new Error('Mature positive forward evidence must influence parent ranking.');
    }
    const selected = selectEvolutionParents([matureStrong, smallNoisy, matureBad], 10);
    const selectedIds = new Set(selected.map(parent => parent.id));
    if (!selectedIds.has('small-noisy')) {
      throw new Error('A sub-100-outcome sample must not be allowed to overturn frozen discovery evidence.');
    }
    if (selectedIds.has('mature-bad')) {
      throw new Error('A mature negative forward record must remove that genome from reproduction.');
    }
  });

  await runTest('ML', 'Evolution preserves species and adapts mutation to population diversity', () => {
    const metrics = {
      trainScoredTrades: 180,
      validationScoredTrades: 180,
      trainWinRate: 0.74,
      validationWinRate: 0.74,
      validationExpectedValueUnits: 0.12,
      validationProfitFactor: 1.35,
      minimumPayoutPct: 80,
    };
    const features = [
      'return_1', 'return_3', 'return_5', 'return_13',
      'ema_spread', 'directional_efficiency', 'range_expansion',
    ] as const;
    const makeParent = (id: string, feature: typeof features[number]) => ({
      id,
      genome: {
        version: 1 as const,
        expression: { kind: 'feature' as const, feature },
        activationThreshold: 0.70,
        signature: id,
        complexity: 1,
      },
      discoveryMetrics: { ...metrics },
    });
    const homogeneous = Array.from({ length: 4 }, (_, index) => makeParent('same-' + index, 'return_1'));
    const diverse = features.slice(0, 4).map((feature, index) => makeParent('diverse-' + index, feature));
    const homogeneousRate = calculateAdaptiveMutationRate(homogeneous);
    const diverseRate = calculateAdaptiveMutationRate(diverse);
    if (!(homogeneousRate > diverseRate)) {
      throw new Error(`Low-diversity populations must receive stronger mutation pressure (same=${homogeneousRate}, diverse=${diverseRate}).`);
    }
    if (homogeneousRate < 0.12 || homogeneousRate > 0.36 || diverseRate < 0.12 || diverseRate > 0.36) {
      throw new Error('Adaptive mutation pressure must remain inside its safe configured bounds.');
    }
    const selected = selectEvolutionParents([
      ...homogeneous.slice(0, 2),
      ...diverse,
    ], 4);
    const species = new Set(selected.map(parent => genomeSpeciesKey(parent.genome)));
    if (species.size < 3) {
      throw new Error('Parent selection must protect distinct validated symbolic species before filling by fitness.');
    }
  });

  await runTest('ML', 'k-NN uses ten closest earlier trades and rejects future information', () => {
    const featureVector = Array(19).fill(0);
    const memory: EpisodicTradeMemory[] = Array.from({ length: 10 }, (_, index) => ({
      signalId: 'prior-' + index,
      symbol: 'EUR/USD',
      direction: 'BUY',
      ruleFamily: 'momentum_5',
      featureVector: [...featureVector],
      outcome: 'LOSS',
      netReturnUnits: -1,
      closedAt: new Date(Date.parse('2026-10-01T00:00:00.000Z') + index * 60_000).toISOString(),
    }));
    memory.push({
      signalId: 'future-win',
      symbol: 'EUR/USD',
      direction: 'BUY',
      ruleFamily: 'momentum_5',
      featureVector: [...featureVector],
      outcome: 'WIN',
      netReturnUnits: 0.8,
      closedAt: '2026-10-03T00:00:00.000Z',
    });
    memory.push({
      signalId: 'wrong-direction',
      symbol: 'EUR/USD',
      direction: 'SELL',
      ruleFamily: 'momentum_5',
      featureVector: [...featureVector],
      outcome: 'WIN',
      netReturnUnits: 0.8,
      closedAt: '2026-10-01T00:00:00.000Z',
    });
    const result = assessNearestNeighbors({
      symbol: 'EUR/USD',
      direction: 'BUY',
      ruleFamily: 'momentum_5',
      featureVector,
      predictionTimeUtc: '2026-10-02T00:00:00.000Z',
    }, memory);
    if (result.neighborsFound !== 10 || result.matches.some(item => item.signalId === 'future-win' || item.signalId === 'wrong-direction')) {
      throw new Error('k-NN must use exactly ten comparable, strictly earlier outcomes and exclude future/opposite-direction trades.');
    }
    if (result.status !== 'NEGATIVE_EXPECTANCY' || !result.veto || result.weightedExpectedReturnUnits !== -1) {
      throw new Error('A tightly matched negative-expectancy neighborhood must veto the candidate.');
    }
  });

  await runTest('ML', 'k-NN is neutral when data is scarce or similarity is weak', () => {
    const vector = Array(19).fill(0);
    const sparse: EpisodicTradeMemory[] = Array.from({ length: 9 }, (_, index) => ({
      signalId: 'sparse-' + index,
      symbol: 'GBP/USD',
      direction: 'SELL',
      ruleFamily: 'wick_reversal',
      featureVector: [...vector],
      outcome: 'LOSS',
      netReturnUnits: -1,
      closedAt: new Date(Date.parse('2026-10-01T00:00:00.000Z') + index * 60_000).toISOString(),
    }));
    const query = {
      symbol: 'GBP/USD',
      direction: 'SELL' as const,
      ruleFamily: 'wick_reversal',
      featureVector: vector,
      predictionTimeUtc: '2026-10-02T00:00:00.000Z',
    };
    const insufficient = assessNearestNeighbors(query, sparse);
    if (insufficient.veto || insufficient.status !== 'INSUFFICIENT_HISTORY') {
      throw new Error('Fewer than ten neighbors must not produce a veto.');
    }
    const distant = Array.from({ length: 10 }, (_, index) => ({
      ...sparse[index % sparse.length],
      signalId: 'distant-' + index,
      featureVector: Array(19).fill(1),
    }));
    const weak = assessNearestNeighbors(query, distant);
    if (weak.veto || weak.status !== 'WEAK_SIMILARITY') {
      throw new Error('Distant historical contexts must not be treated as equivalent setups.');
    }
  });

  await runTest('ML', 'Regime engine detects high-trend breakouts and low-volatility Asia', () => {
    const build = (mode: 'trend' | 'quiet'): Candle[] => {
      const rows: Candle[] = [];
      let price = 1.1;
      for (let i = 0; i < 80; i++) {
        const open = price;
        const delta = mode === 'trend'
          ? (i < 60 ? (i % 2 === 0 ? 0.00001 : -0.00001) : 0.00035)
          : (i < 60 ? (i % 2 === 0 ? 0.00008 : -0.00008) : (i % 2 === 0 ? 0.000001 : -0.000001));
        const close = open + delta;
        const halfRange = mode === 'trend'
          ? (i < 60 ? 0.00006 : 0.00075)
          : (i < 60 ? 0.0005 : 0.00001);
        rows.push({
          symbol: 'EUR/USD',
          timestamp: new Date(Date.parse('2026-10-01T00:00:00.000Z') + i * 60_000).toISOString(),
          timestampMs: Date.parse('2026-10-01T00:00:00.000Z') + i * 60_000,
          open,
          high: Math.max(open, close) + halfRange,
          low: Math.min(open, close) - halfRange,
          close,
          volume: 100,
          source: 'test_fixture',
        });
        price = close;
      }
      return rows;
    };
    const trend = classifyMarketRegime(build('trend'), 'LONDON');
    const quietAsia = classifyMarketRegime(build('quiet'), 'ASIA');
    if (trend.regime !== 'HIGH_TREND_BREAKOUT') {
      throw new Error('A strongly directional, expanding-ATR sequence should classify as HIGH_TREND_BREAKOUT; got ' + trend.regime);
    }
    if (quietAsia.regime !== 'LOW_VOL_ASIA') {
      throw new Error('A low-range Asian session should classify as LOW_VOL_ASIA; got ' + quietAsia.regime);
    }
    if (isStrategyRegimeCompatible('MEAN_REVERSION', trend.regime).allowed) {
      throw new Error('Mean reversion must be suppressed in a high-trend breakout.');
    }
    if (isStrategyRegimeCompatible('TREND', quietAsia.regime).allowed) {
      throw new Error('Trend breakout must be suppressed in low-volatility Asia.');
    }
  });

  await runTest('ML', 'Regime engine fails open only for unknown or mixed evidence', () => {
    const tooShort: Candle[] = [];
    const assessment = classifyMarketRegime(tooShort, 'ASIA');
    if (assessment.regime !== 'UNKNOWN') {
      throw new Error('Insufficient candles must produce UNKNOWN rather than a fabricated regime.');
    }
    if (!isStrategyRegimeCompatible('TREND', 'UNKNOWN').allowed) {
      throw new Error('Unknown regime must not invent a directional classification.');
    }
  });

  await runTest('ML', 'Evolutionary parent selection never uses holdout results', () => {
    const genome = {
      version: 1 as const,
      expression: { kind: 'feature' as const, feature: 'return_1' as const },
      activationThreshold: 0.7,
      signature: 'test',
      complexity: 1,
    };
    const candidate = (id: string, validationRate: number, validationEv: number, testEv: number) => ({
      id,
      genome: { ...genome, signature: id },
      discoveryMetrics: {
        trainScoredTrades: 200,
        validationScoredTrades: 200,
        trainWinRate: 0.72,
        validationWinRate: validationRate,
        validationExpectedValueUnits: validationEv,
        validationProfitFactor: 1.2,
        minimumPayoutPct: 80,
      },
      // This field must have no effect on selection. It represents an untouched holdout.
      backtestMetrics: { expectedValueUnits: testEv },
    });
    const validationWinner = candidate('validation-winner', 0.74, 0.18, -9);
    const holdoutWinner = candidate('holdout-only-winner', 0.61, -0.10, 12);
    const selected = selectEvolutionParents([holdoutWinner, validationWinner], 30);
    if (selected.length !== 1 || selected[0].id !== 'validation-winner') {
      throw new Error('Only candidates passing train/validation evidence may become evolutionary parents; holdout results must be ignored.');
    }
  });

  await runTest('ML', 'Genome style inference distinguishes trend and mean-reversion feature families', () => {
    const trend = {
      kind: 'binary' as const,
      operator: 'add' as const,
      left: { kind: 'feature' as const, feature: 'return_1' as const },
      right: {
        kind: 'binary' as const,
        operator: 'add' as const,
        left: { kind: 'feature' as const, feature: 'ema_spread' as const },
        right: { kind: 'feature' as const, feature: 'directional_efficiency' as const },
      },
    };
    const fade = {
      kind: 'binary' as const,
      operator: 'add' as const,
      left: { kind: 'feature' as const, feature: 'wick_imbalance' as const },
      right: {
        kind: 'binary' as const,
        operator: 'add' as const,
        left: { kind: 'feature' as const, feature: 'range_position_13' as const },
        right: { kind: 'feature' as const, feature: 'rsi_centered' as const },
      },
    };
    if (inferGenomeStyle(trend) !== 'TREND' || inferGenomeStyle(fade) !== 'MEAN_REVERSION') {
      throw new Error('Genome style must be derived from its actual executable feature tree.');
    }
  });

  // ==========================================
  // 1. DATA TESTS
  // ==========================================
  await runTest('DATA', 'Provider fallback preserves OHLC or read-only close-only market data', async () => {
    // A connected Yahoo FX endpoint may supply genuine Close observations while
    // its OHLC dimensions are collapsed. That is useful for charting but must not
    // be converted into synthetic candles just to satisfy an older non-empty-list test.
    const res = await dataFeedEngine.fetchCandles('EUR/USD', 50);
    const hasUsableOhlc = Array.isArray(res.candles) && res.candles.length >= 20;
    const hasUsableCloseOnly = Array.isArray(res.closeOnlySeries) && res.closeOnlySeries.length >= 20;
    if (!hasUsableOhlc && !hasUsableCloseOnly) {
      throw new Error(
        `Expected at least 20 genuine OHLC candles or close-only observations, got OHLC=${res.candles?.length || 0}, close-only=${res.closeOnlySeries?.length || 0}.`
      );
    }
    if (hasUsableCloseOnly && res.candles.some(candle => candle.source === 'synthetic')) {
      throw new Error('A connected close-only quote feed must not trigger synthetic OHLC fallback.');
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

  await runTest('ENTRY_EXIT', 'Signal factory rejects misaligned or late advance schedules', () => {
    const signalCandle: Candle = {
      symbol: 'EUR/USD',
      timestamp: '2026-10-29T10:11:00.000Z',
      timestampMs: Date.parse('2026-10-29T10:11:00.000Z'),
      open: 1.0850,
      high: 1.0860,
      low: 1.0840,
      close: 1.0855,
      volume: 100,
      source: 'test_fixture',
    };
    let rejected = false;
    try {
      entryExitEngine.createResearchSignal({
        symbol: 'EUR/USD',
        direction: 'BUY',
        signalCandle,
        ruleFamily: 'clock_guard_probe',
        expiryMinutes: 15,
        entryTimeframeMinutes: ENTRY_CANDLE_TIMEFRAME_MINUTES,
        candleOpenTimeUtc: '2030-01-01T00:15:00.000Z',
        confidence: 0.7,
        modelVersion: 'clock-guard-test',
      });
    } catch (error: any) {
      rejected = String(error.message).includes('exactly three minutes');
    }
    if (!rejected) {
      throw new Error('The signal factory must independently reject a timestamp that is not exactly T-3m.');
    }
  });

  await runTest('ENTRY_EXIT', 'Every signal targets the next M5 open; expiry horizons remain independent', () => {
    // 10:22:00 M1 close -> 10:25:00 M5 open, even though this is not a 10M/15M boundary.
    const firstEntryOpen = Date.parse('2026-10-29T10:25:00.000Z');
    const firstDecisionClose = firstEntryOpen - 3 * 60_000;
    const firstNow = firstDecisionClose + 20_000;
    const firstEligible = findEligibleStartTimeframes(firstNow, firstDecisionClose);
    if (firstEligible.length !== 1 || firstEligible[0].timeframeMinutes !== ENTRY_CANDLE_TIMEFRAME_MINUTES) {
      throw new Error('A valid T-3 decision must yield exactly one 5-minute entry schedule.');
    }
    if (firstEligible[0].entryTimeMs !== firstEntryOpen ||
        firstEligible[0].decisionTimeMs !== firstDecisionClose ||
        getNextCandleOpenMs(firstNow) !== firstEntryOpen) {
      throw new Error('The 5-minute entry schedule drifted from the exact T-3 boundary.');
    }

    // 10:27 M1 close -> 10:30 M5 open. It is also a 10/15/30 boundary,
    // but it must still produce one M5 entry schedule, never multiple entry TFs.
    const sharedBoundary = Date.parse('2026-10-29T10:30:00.000Z');
    const decisionClose = sharedBoundary - 3 * 60_000;
    const now = decisionClose + 20_000;
    const eligible = findEligibleStartTimeframes(now, decisionClose);
    if (eligible.length !== 1 || eligible[0].timeframeMinutes !== 5 ||
        eligible[0].entryTimeMs !== sharedBoundary) {
      throw new Error('A shared 5/10/15/30 boundary must still create only a 5-minute entry schedule.');
    }

    for (const expiry of EXPIRY_HORIZONS_MINUTES) {
      if (!isSupportedExpiryMinutes(expiry)) {
        throw new Error(`The dynamic expiry horizon ${expiry}m must remain selectable.`);
      }
    }
    if (isSupportedExpiryMinutes(6) || isSupportedExpiryMinutes(35)) {
      throw new Error('Expiry choices must remain within the supported 5–30 minute research horizons.');
    }

    if (findEligibleStartTimeframes(decisionClose + 25_000, decisionClose).length !== 0) {
      throw new Error('A signal processed after the strict 25-second decision-processing window must be rejected.');
    }
    if (findEligibleStartTimeframes(now + 60_000, decisionClose + 60_000).length !== 0) {
      throw new Error('A late signal must not be mislabeled as a three-minute advance signal.');
    }
  });

  await runTest('ENTRY_EXIT', 'Signal factory keeps M5 entry while selecting independent 5–30m expiry', () => {
    const signalCandle: Candle = {
      symbol: 'EUR/USD',
      timestamp: '2026-10-29T10:11:00.000Z',
      timestampMs: Date.parse('2026-10-29T10:11:00.000Z'),
      open: 1.0850,
      high: 1.0860,
      low: 1.0840,
      close: 1.0855,
      volume: 100,
      source: 'test_fixture',
    };

    for (const expiryMinutes of EXPIRY_HORIZONS_MINUTES) {
      const signal = entryExitEngine.createResearchSignal({
        symbol: 'EUR/USD',
        direction: 'BUY',
        signalCandle,
        ruleFamily: `test_m5_entry_expiry_${expiryMinutes}`,
        expiryMinutes,
        entryTimeframeMinutes: ENTRY_CANDLE_TIMEFRAME_MINUTES,
        confidence: 0.7,
        modelVersion: 'm5-entry-dynamic-expiry-test',
      });
      if (signal.entryTimeframeMinutes !== 5 || signal.expiryMinutes !== expiryMinutes) {
        throw new Error(`Expected M5 entry with independent ${expiryMinutes}m expiry.`);
      }
      const duration = Date.parse(signal.candleCloseTimeUtc!) - Date.parse(signal.candleOpenTimeUtc!);
      if (duration !== expiryMinutes * 60_000) {
        throw new Error(`Expiry ${expiryMinutes}m must start at the M5 open and close exactly after its duration.`);
      }
      if (Date.parse(signal.candleOpenTimeUtc!) % (5 * 60_000) !== 0) {
        throw new Error('Every test signal entry must align to an M5 candle boundary.');
      }
    }

    let rejected = false;
    try {
      entryExitEngine.createResearchSignal({
        symbol: 'EUR/USD',
        direction: 'BUY',
        signalCandle,
        ruleFamily: 'test_reject_non_m5_entry',
        expiryMinutes: 15,
        entryTimeframeMinutes: 15 as unknown as 5,
        confidence: 0.7,
        modelVersion: 'm5-entry-dynamic-expiry-test',
      });
    } catch (error: any) {
      rejected = String(error.message).includes('only on a 5-minute candle');
    }
    if (!rejected) {
      throw new Error('The signal factory must reject any new entry timeframe other than M5.');
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

  await runTest('ENTRY_EXIT', 'Missing binary expiry candle is not replaced by a later candle', () => {
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
      source: 'test_fixture',
    };
    const signal = entryExitEngine.createResearchSignal({
      symbol: 'EUR/USD',
      direction: 'BUY',
      signalCandle,
      ruleFamily: `test_missing_expiry_${Date.now()}`,
      expiryMinutes: 10,
      confidence: 0.7,
      modelVersion: 'vTest',
    });
    const entryCandle: Candle = {
      ...signalCandle,
      timestamp: new Date(baseTime + 60_000).toISOString(),
      timestampMs: baseTime + 60_000,
      open: 1.0859,
      high: 1.0868,
      low: 1.0855,
      close: 1.0865,
    };
    const laterCandle: Candle = {
      ...entryCandle,
      timestamp: new Date(baseTime + 12 * 60_000).toISOString(),
      timestampMs: baseTime + 12 * 60_000,
      open: 1.0865,
      high: 1.0870,
      low: 1.0860,
      close: 1.0867,
    };

    entryExitEngine.evaluateSignals({ 'EUR/USD': [signalCandle, entryCandle] } as any, true);
    entryExitEngine.evaluateSignals({ 'EUR/USD': [signalCandle, entryCandle, laterCandle] } as any, true);
    const settled = db.getSignalById(signal.id);
    if (!settled || settled.lifecycleState !== 'EXPIRED' || settled.outcomeResult !== 'CANCELLED') {
      throw new Error(`A missing exact expiry candle must expire unscored, got ${settled?.lifecycleState}/${settled?.outcomeResult}.`);
    }
    if (settled.netReturnUnits !== null) {
      throw new Error('A later candle must never be used to fabricate a binary settlement.');
    }
  });

  await runTest('ENTRY_EXIT', 'Overdue contract remains pending until the exact trusted expiry candle arrives', () => {
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
      source: 'test_fixture',
    };
    const signal = entryExitEngine.createResearchSignal({
      symbol: 'EUR/USD',
      direction: 'BUY',
      signalCandle,
      ruleFamily: `test_delayed_expiry_${Date.now()}`,
      expiryMinutes: 5,
      confidence: 0.7,
      modelVersion: 'vTest',
    });
    const expiryMs = Math.floor(Date.now() / 60_000) * 60_000 - 60_000;
    signal.lifecycleState = 'ACTIVE';
    signal.actualEntryTimeUtc = new Date(expiryMs - 5 * 60_000).toISOString();
    signal.actualEntryPrice = 1.0859;
    signal.entrySource = 'test_fixture';
    signal.plannedExitTimeUtc = new Date(expiryMs).toISOString();
    db.updateSignal(signal);

    entryExitEngine.evaluateSignals({} as any, true);
    const pending = db.getSignalById(signal.id);
    if (!pending || pending.lifecycleState !== 'EXIT_PENDING') {
      throw new Error(`Expected EXIT_PENDING with no feed, got ${pending?.lifecycleState}.`);
    }
    if (pending.outcomeResult === 'WIN' || pending.outcomeResult === 'LOSS' || pending.netReturnUnits !== null) {
      throw new Error('Missing market data must never be converted into a scored result.');
    }

    const exactExpiryCandle: Candle = {
      ...signalCandle,
      timestamp: new Date(expiryMs - 60_000).toISOString(),
      timestampMs: expiryMs - 60_000,
      open: 1.0860,
      high: 1.0864,
      low: 1.0858,
      close: 1.0862,
    };
    entryExitEngine.evaluateSignals({ 'EUR/USD': [exactExpiryCandle] } as any, true);
    const settled = db.getSignalById(signal.id);
    if (!settled || settled.lifecycleState !== 'CLOSED' || settled.outcomeResult !== 'WIN') {
      throw new Error(`Expected exact delayed bar to settle WIN, got ${settled?.lifecycleState}/${settled?.outcomeResult}.`);
    }
    if (settled.netReturnUnits !== 0.8) {
      throw new Error(`Expected payout-adjusted +0.8 stake units, got ${settled.netReturnUnits}.`);
    }
  });

  await runTest('ENTRY_EXIT', 'EXIT_PENDING is reconciled but does not consume an open-entry slot', () => {
    const signalCandle: Candle = {
      symbol: 'EUR/USD',
      timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
      timestampMs: Date.now() - 10 * 60_000,
      open: 1.0850,
      high: 1.0860,
      low: 1.0840,
      close: 1.0855,
      volume: 100,
      source: 'test_fixture',
    };
    const signal = entryExitEngine.createResearchSignal({
      symbol: 'EUR/USD',
      direction: 'BUY',
      signalCandle,
      ruleFamily: `test_exit_pending_capacity_${Date.now()}`,
      expiryMinutes: 5,
      confidence: 0.7,
      modelVersion: 'vTest',
    });
    signal.lifecycleState = 'EXIT_PENDING';
    signal.actualEntryTimeUtc = signalCandle.timestamp;
    signal.actualEntryPrice = signalCandle.close;
    signal.plannedExitTimeUtc = new Date(signalCandle.timestampMs + 5 * 60_000).toISOString();
    db.updateSignal(signal);

    if (db.getOpenSignals(true).some(item => item.id === signal.id)) {
      throw new Error('An already-expired EXIT_PENDING contract must not consume a new-entry capacity slot.');
    }
    if (!db.getSignalsAwaitingSettlement(true).some(item => item.id === signal.id)) {
      throw new Error('EXIT_PENDING must remain visible in the awaiting-settlement queue.');
    }
    if (!db.getActiveSignals(true).some(item => item.id === signal.id)) {
      throw new Error('EXIT_PENDING must remain available to the lifecycle reconciliation engine.');
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
  await runTest('ML', 'Research analyses M1 data but always enters M5 and settles at selected expiry', () => {
    const candles = makeM1TestCandles('EUR/USD', 3000);
    const expiryMinutes = 15;
    const samples = researchEngine.extractFeatures(candles, expiryMinutes);
    if (samples.length < 30) {
      throw new Error(`Expected enough eligible ${expiryMinutes}m expiry observations, received ${samples.length}.`);
    }
    for (const sample of samples.slice(0, 50)) {
      if (sample.entryTimeframeMinutes !== 5 ||
          sample.entryTimeMs % (5 * 60_000) !== 0) {
        throw new Error('Research samples must enter only on a 5-minute candle boundary.');
      }
      if (sample.expiryMinutes !== expiryMinutes ||
          sample.expiryTimeMs - sample.entryTimeMs !== expiryMinutes * 60_000) {
        throw new Error('The selected expiry horizon must be independent of the fixed M5 entry.');
      }
      if (sample.entryTimeMs - (sample.candle.timestampMs + 60_000) !== 180_000) {
        throw new Error('Research decision was not made exactly three minutes before the M5 entry.');
      }
      if (sample.exitCandleTimeMs + 60_000 !== sample.expiryTimeMs) {
        throw new Error('Research settlement used a candle after the exact expiry minute.');
      }
    }
  });

  await runTest('ML', 'Purged Walk-Forward Splits & Embargo Verification', () => {
    const candles = makeM1TestCandles('EUR/USD', 40000);
    const exp = researchEngine.runWalkForwardExperiment('EUR/USD', candles, 'momentum_5', 10, 1, { allowTestFixtures: true });

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

  await runTest('ML', 'Synthetic and test-fixture candles cannot be used for research claims', () => {
    const synthetic = dataFeedEngine.generateRealisticHistoricalCandles('EUR/USD', 1500);
    const testFixture = makeM1TestCandles('EUR/USD', 1500);
    for (const candles of [synthetic, testFixture]) {
      let rejected = false;
      try {
        researchEngine.runWalkForwardExperiment('EUR/USD', candles, 'momentum_5', 10, 1);
      } catch (error: any) {
        rejected = String(error.message).includes('Synthetic and test-fixture candles are not eligible');
      }
      if (!rejected) throw new Error('Synthetic or test-fixture candles were not rejected by the backtest engine.');
    }
  });

  await runTest('RESEARCH', 'Generated strategy remains unvalidated until historical testing', () => {
    const candles = dataFeedEngine.generateRealisticHistoricalCandles('EUR/USD', 100);
    const gene = researchEngine.synthesizeInfiniteNovelStrategy(candles, 'EUR/USD', 99);
    if (!gene.genome || gene.genome.version !== 1 || !gene.genome.signature || gene.genome.complexity < 1) {
      throw new Error('Generated candidate must contain a persisted executable symbolic genome.');
    }
    if (gene.verifiedAccuracy !== 0 || gene.sampleCount !== 0) {
      throw new Error('New candidate must not contain a fabricated accuracy or sample count.');
    }
    if (gene.status !== 'EXPERIMENTING' || gene.accuracyStatus !== 'UNVALIDATED') {
      throw new Error('New candidate must remain unvalidated and out of the promoted pool.');
    }
    const closes = candles.map(candle => candle.close);
    const evaluated = researchEngine.evaluateSynthesizedGeneSignal(
      gene,
      candles[99],
      candles[98],
      closes,
      closes,
      closes,
      closes.map(() => 50),
      99
    );
    if (!Number.isFinite(evaluated.conviction) || !['BUY', 'SELL'].includes(evaluated.direction)) {
      throw new Error('The saved symbolic genome must be executable by the live evaluator.');
    }
    if (!evaluated.rationale.includes('Symbolic genome score')) {
      throw new Error('The candidate was not evaluated through its symbolic genome.');
    }
  });

  await runTest('ML', 'Probabilistic Calibration & Brier Score Calculation', () => {
    const candles = makeM1TestCandles('USD/JPY', 12000);
    const exp = researchEngine.runWalkForwardExperiment(
      'USD/JPY',
      candles,
      'mean_reversion_20',
      5,
      1,
      { allowTestFixtures: true }
    );

    if (isNaN(exp.metrics.brierScore) || exp.metrics.brierScore < 0 || exp.metrics.brierScore > 1) {
      throw new Error(`Invalid Brier score: ${exp.metrics.brierScore}`);
    }
    if (!exp.metrics.confusionMatrix || exp.metrics.confusionMatrix.tp === undefined) {
      throw new Error('Missing confusion matrix');
    }
  });

  await runTest('RESEARCH', 'Skeptical Auditor Rejection of Overfitted Candidates', async () => {
    const candles = makeM1TestCandles('EUR/GBP', 40000);
    const exp = researchEngine.runWalkForwardExperiment('EUR/GBP', candles, 'wick_reversal', 15, 1, { allowTestFixtures: true });
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
