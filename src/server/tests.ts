/**
 * SignalForge ML — Comprehensive Automated Verification Test Suite
 * Executes real tests across Data Ingestion, ML Pipeline, Causal Entry/Exit Engine,
 * Research Trinity Audits, and System State.
 */

import { Candle, ForexSymbol, ResearchSignal, SynthesizedStrategyGene, VerificationTestResult } from '../types/index.js';
import { dataFeedEngine } from './dataFeeds.js';
import { db } from './db.js';
import { entryExitEngine } from './entryExitEngine.js';
import { researchEngine } from './researchEngine.js';
import { calculateBinarySettlement } from './binarySettlement.js';
import {
  assessNearestNeighbors,
  bayesianUcbScore,
  selectEvolutionParents,
  classifyMarketRegime,
  inferGenomeStyle,
  isStrategyRegimeCompatible,
  updateBetaPosterior,
  EpisodicTradeMemory,
  calculateAdaptiveMutationRate,
  genomeSpeciesKey,
  hasSufficientForwardParentEvidence,
  hasSufficientHistoricalApprovalEvidence,
  evolutionaryParentFitness,
  binaryBreakEvenWinRate,
  wilsonLowerBound,
  outcomeFitsResearchWindow,
  doesResearchHoldoutOverlap,
} from './evolutionEngine.js';
import { findEligibleStartTimeframes, getNextCandleOpenMs } from './tradingClock.js';
import { getForexMarketState, getSessionFromTimestamp, isForexMarketIntervalOpen, isForexMarketOpenAt, isForexSignalScheduleValid } from './marketHours.js';

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
    const fridayDecisionSundayEntry = Date.parse('2026-11-01T22:10:00.000Z');
    if (isForexSignalScheduleValid(fridayDecisionSundayEntry, sundayEntry, sundayExpiry)) {
      throw new Error('A prediction cannot claim validity if its decision timestamp is closed.');
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
      const actual = getSessionFromTimestamp(timestamp).id;
      if (actual !== expected) {
        throw new Error(`${timestamp}: expected ${expected}, received ${actual}.`);
      }
    }
    const summerOverlap = getSessionFromTimestamp('2026-07-06T12:00:00.000Z');
    const winterOverlap = getSessionFromTimestamp('2026-11-02T13:00:00.000Z');
    if (summerOverlap.utcRange !== '12:00–16:00 UTC' || winterOverlap.utcRange !== '13:00–17:00 UTC') {
      throw new Error('Session UTC labels must follow the New York DST offset rather than a fixed UTC schedule.');
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
        entryTimeframeMinutes: 15,
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

  await runTest('ENTRY_EXIT', 'Exact three-minute schedule across 5–30 minute entry candles', () => {
    const entryOpen = Date.parse('2026-10-29T10:30:00.000Z');
    const decisionClose = entryOpen - 3 * 60_000;
    const now = decisionClose + 20_000;
    const eligible = findEligibleStartTimeframes(now, decisionClose);
    const timeframes = eligible.map(item => item.timeframeMinutes);
    for (const required of [5, 10, 15, 30]) {
      if (!timeframes.includes(required as any)) {
        throw new Error(`Expected ${required}m entry timeframe to be eligible at the same 10:30 boundary.`);
      }
    }
    if (timeframes.includes(20) || timeframes.includes(25)) {
      throw new Error('A timeframe without a boundary exactly three minutes ahead must not be eligible.');
    }
    for (const item of eligible) {
      if (item.entryTimeMs !== entryOpen || item.decisionTimeMs !== decisionClose) {
        throw new Error('The live clock contract drifted away from the exact T-3m entry boundary.');
      }
      if (getNextCandleOpenMs(now, item.timeframeMinutes) !== entryOpen) {
        throw new Error('Entry boundary calculation disagrees with eligibility output.');
      }
    }
    if (findEligibleStartTimeframes(decisionClose + 25_000, decisionClose).length !== 0) {
      throw new Error('A signal processed after the strict 25-second decision-processing window must be rejected.');
    }
    if (findEligibleStartTimeframes(now + 60_000, decisionClose + 60_000).length !== 0) {
      throw new Error('A late signal must not be mislabeled as a three-minute advance signal.');
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
  await runTest('ML', 'Research uses the same N-minute entry and exact expiry candle', () => {
    const candles = makeM1TestCandles('EUR/USD', 3000);
    const samples = researchEngine.extractFeatures(candles, 15);
    if (samples.length < 30) {
      throw new Error(`Expected enough eligible 15m observations, received ${samples.length}.`);
    }
    for (const sample of samples.slice(0, 50)) {
      if (sample.entryTimeframeMinutes !== 15 || sample.entryTimeMs % (15 * 60_000) !== 0) {
        throw new Error('Research sample is not aligned to its 15-minute starting candle.');
      }
      if (sample.entryTimeMs - (sample.candle.timestampMs + 60_000) !== 180_000) {
        throw new Error('Research decision was not made exactly three minutes before entry.');
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
