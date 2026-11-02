/**
 * SignalForge ML — Scheduled signal and research coordinator.
 * Collects market candles, manages causal signal lifecycles, validates candidates
 * on imported history, and records forward paper-trading outcomes.
 */

import { FOREX_PAIRS } from '../types/index.ts';
import type {
  AutopilotLog,
  AutonomousResearchPairState,
  Candle,
  EvolutionGeneration,
  ForexSymbol,
  ResearchExperiment,
  RuleFamily,
} from '../types/index.ts';
import { dataFeedEngine, getSessionFromTimestamp } from './dataFeeds.ts';
import { getForexMarketState, isForexMarketIntervalOpen } from './marketHours.ts';
import { db } from './db.ts';
import { entryExitEngine } from './entryExitEngine.ts';
import { researchEngine } from './researchEngine.ts';
import { historicalDataStore } from './historicalData.ts';
import {
  classifyMarketRegime,
  inferGenomeStyle,
  inferGenomeRuleFamily,
  isStrategyRegimeCompatible,
} from './evolutionEngine.ts';
import {
  ENTRY_CANDLE_TIMEFRAME_MINUTES,
  findEligibleStartTimeframes,
  isSupportedExpiryMinutes,
} from './tradingClock.ts';
import { FEATURE_SCHEMA_VERSION, RESEARCH_ENGINE_VERSION } from './researchReproducibility.ts';
import { getTrustedMarketCandles, isBatchCandleStructureValid } from '../utils/marketChart.ts';
import {
  assessResearchPairReadiness,
  assignResearchQueuePositions,
  AUTONOMOUS_RESEARCH_COOLDOWN_SECONDS,
  MINIMUM_RESEARCH_M1_CANDLES,
  RESEARCH_CANDIDATES_PER_BATCH,
  RESEARCH_HISTORY_WINDOW_LIMIT,
  selectNextResearchPair,
} from './researchQueue.ts';

export const MARKET_SENSE_CONCURRENCY = Math.max(1, FOREX_PAIRS.length);
export const AUTOPILOT_SCAN_INTERVAL_MS = 8_000;

const TRUSTED_MARKET_SOURCES = new Set(['biquote', 'dukascopy', 'yahoo', 'imported']);

export function getTrustedFreshCandleSnapshot(candles: Candle[], nowMs: number): {
  candles: Candle[];
  newestCandle: Candle | null;
  ageMs: number | null;
  isFresh: boolean;
  isCandleStructureValid: boolean;
} {
  const rawTrustedCandles = candles
    .filter(candle => TRUSTED_MARKET_SOURCES.has(candle.source))
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const isCandleStructureValid = isBatchCandleStructureValid(rawTrustedCandles);
  const trustedCandles = isCandleStructureValid
    ? getTrustedMarketCandles(rawTrustedCandles)
    : [];
  const newestCandle = trustedCandles[trustedCandles.length - 1] ||
    rawTrustedCandles[rawTrustedCandles.length - 1] || null;
  const ageMs = newestCandle ? nowMs - newestCandle.timestampMs : null;
  const isRecent = ageMs !== null && ageMs >= -60_000 && ageMs <= 120_000;
  return {
    candles: trustedCandles,
    newestCandle,
    ageMs,
    isFresh: isCandleStructureValid && isRecent,
    isCandleStructureValid,
  };
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R> | R,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Concurrency must be a positive integer.');
  }
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(items.length, concurrency) }, () => runWorker())
  );
  return results;
}

export class AutonomousScheduler {
  private isRunningCycle = false;
  private autopilotLoopActive = false;
  private autopilotTimer: NodeJS.Timeout | null = null;
  private nextAutopilotPulseAt: string | null = null;
  private autopilotWarmupTimer: NodeJS.Timeout | null = null;
  private autopilotIntervalMs = AUTOPILOT_SCAN_INTERVAL_MS; // Recheck inside the strict 25s T-3 decision window.
  private researchTimer: NodeJS.Timeout | null = null;
  private researchWarmupTimer: NodeJS.Timeout | null = null;
  private researchIntervalMs = AUTONOMOUS_RESEARCH_COOLDOWN_SECONDS * 1000; // One 300-candidate worker, with a one-minute inter-batch cooldown.
  private researchCoordinatorRunning = false;
  private nextResearchScanAt: string | null = null;
  private researchState: {
    status: 'IDLE' | 'SCANNING' | 'WAITING_FOR_HISTORY' | 'WAITING_FOR_NEW_HISTORY' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    symbol?: ForexSymbol;
    batchId?: string;
    startedAt?: string;
    finishedAt?: string;
    checkedAt?: string;
    nextScanAt?: string;
    completedCandidates: number;
    totalCandidates: number;
    historicalPasses: number;
    rejected: number;
    finalists: number;
    message: string;
    error?: string;
  } = {
    status: 'IDLE',
    completedCandidates: 0,
    totalCandidates: 300,
    historicalPasses: 0,
    rejected: 0,
    finalists: 0,
    message: 'Autonomous research coordinator has not started.',
  };
  private currentGeneration = 1;
  private cycleCount = 0;
  private lastPulseStartedAt: string | null = null;
  private lastPulseCompletedAt: string | null = null;
  private lastPulseTriggerSource: string | null = null;
  private lastPulseSkippedReason: string | null = null;
  private lastPulseError: string | null = null;
  private lastPulseResult: { durationMs: number; pairsProcessed: number; signalsCreated: number; signalsUpdated: number } | null = null;
  private lastPairDiagnostics: Array<{
    symbol: ForexSymbol;
    source: string;
    freshFeed: boolean;
    newestCandleAt: string | null;
    ageSeconds: number | null;
    candleCount: number;
    eligibleTimeframes: number[];
    eligibleStrategyPoolCount: number;
    sessionCompatibleStrategyCount: number;
    expiryCompatibleStrategyCount: number;
    strategiesEvaluated: number;
    regimeRejected: number;
    activationPassed: number;
    memoryVetoes: number;
    selectedExpiryMinutes: number | null;
    lastStrategyName: string | null;
    signalPersisted: boolean;
    signalCreationError: string | null;
    result: string;
  }> = [];
  private readonly lastDiagnosticLogAt = new Map<string, number>();

  constructor() {
    const existingGens = db.getGenerations();
    if (existingGens.length > 0) {
      this.currentGeneration = existingGens[0].generation + 1;
    }
    this.recoverInterruptedResearchQueue();
  }

  /**
   * Recover a worker interrupted by process replacement. Any already-reserved
   * holdout remains consumed; lastInspectedThroughUtc prevents replaying the
   * same full research window after a restart.
   */
  private recoverInterruptedResearchQueue(): void {
    const queue = db.getAutonomousResearchQueueState();
    if (!queue.currentSymbol) return;
    const pair = queue.pairs[queue.currentSymbol];
    if (pair && pair.lastBatchId) {
      const recorded = db.getGenerations().find(item => item.researchBatchId === pair.lastBatchId);
      if (recorded) {
        pair.lastBatchStatus = recorded.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED';
        pair.lastBatchFinishedAt = recorded.timestamp;
        pair.status = recorded.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED';
        pair.readinessMessage = recorded.summary;
      } else {
        pair.status = 'INTERRUPTED';
        pair.lastBatchStatus = 'INTERRUPTED';
        pair.lastBatchFinishedAt = new Date().toISOString();
        pair.lastError = 'Process restarted during the research batch. Partial candidates were not promoted; the inspected history window is not automatically replayed.';
        pair.readinessMessage = pair.lastError;
      }
      pair.updatedAt = new Date().toISOString();
    }
    const recoveredRecord = queue.currentSymbol
      ? db.getGenerations().find(item => item.researchBatchId === queue.pairs[queue.currentSymbol!]?.lastBatchId)
      : undefined;
    queue.currentSymbol = null;
    queue.lastBatchFinishedAt = new Date().toISOString();
    if (recoveredRecord?.status === 'COMPLETED') {
      queue.lastRunStatus = 'COMPLETED';
      queue.batchesCompleted++;
      queue.lastRunMessage = 'Recovered a batch whose generation record was safely committed before process replacement.';
    } else if (recoveredRecord?.status === 'FAILED') {
      queue.lastRunStatus = 'FAILED';
      queue.batchesFailed++;
      queue.lastRunMessage = 'Recovered a failed batch record; the pair history boundary remains consumed.';
    } else {
      queue.lastRunStatus = 'INTERRUPTED';
      queue.lastRunMessage = 'Recovered an interrupted research worker. Queue cursor and consumed history windows were preserved.';
    }
    queue.nextRunAt = new Date(Date.now() + this.researchIntervalMs).toISOString();
    db.setAutonomousResearchQueueState(queue, true);
  }

  public start() {
    if (this.autopilotLoopActive) return;
    this.autopilotLoopActive = true;
    console.log('[Autopilot] Starting SignalForge always-on 24/5 paper research service...');

    this.logMind(
      'MIND',
      `Always-on 24/5 service online. Market sensing repeats after each completed pulse with a ${this.autopilotIntervalMs / 1000}s cooldown; weekends remain monitored without fetching or creating trades. A persistent 20-pair research queue dispatches one 300-candidate batch at a time with a ${AUTONOMOUS_RESEARCH_COOLDOWN_SECONDS}s cooldown.`
    );

    this.autopilotWarmupTimer = setTimeout(() => {
      this.autopilotWarmupTimer = null;
      void this.runAutopilotLoop('WARMUP');
    }, 1500);

    // Schedule the next market pulse only after the previous one finishes.
    // This avoids overlapping callbacks and skipped scans when providers are slow.
    // Heavy 300-candidate searches remain isolated from market sensing.
    this.researchWarmupTimer = setTimeout(() => {
      this.researchWarmupTimer = null;
      void this.checkAutonomousEvolutionResearch();
    }, 90_000);
    this.researchTimer = setInterval(() => {
      void this.checkAutonomousEvolutionResearch();
    }, this.researchIntervalMs);
    this.nextResearchScanAt = new Date(Date.now() + this.researchIntervalMs).toISOString();
    this.researchState = {
      ...this.researchState,
      status: 'SCANNING',
      checkedAt: new Date().toISOString(),
      nextScanAt: this.nextResearchScanAt,
      message: 'Waiting for the first bounded imported-history eligibility scan.',
    };
  }

  public stop() {
    this.autopilotLoopActive = false;
    this.nextAutopilotPulseAt = null;
    if (this.autopilotWarmupTimer) {
      clearTimeout(this.autopilotWarmupTimer);
      this.autopilotWarmupTimer = null;
    }
    if (this.autopilotTimer) {
      clearTimeout(this.autopilotTimer);
      this.autopilotTimer = null;
    }
    if (this.researchWarmupTimer) {
      clearTimeout(this.researchWarmupTimer);
      this.researchWarmupTimer = null;
    }
    if (this.researchTimer) {
      clearInterval(this.researchTimer);
      this.researchTimer = null;
    }
    this.nextResearchScanAt = null;
    this.logMind('MIND', 'Autonomous market and research schedulers paused. Any already-running research batch is allowed to finish safely.');
  }

  private scheduleNextAutopilotPulse(triggerSource: string = 'AUTONOMOUS_PULSE') {
    if (!this.autopilotLoopActive) return;
    if (this.autopilotTimer) clearTimeout(this.autopilotTimer);
    this.nextAutopilotPulseAt = new Date(Date.now() + this.autopilotIntervalMs).toISOString();
    this.autopilotTimer = setTimeout(() => {
      this.autopilotTimer = null;
      void this.runAutopilotLoop(triggerSource);
    }, this.autopilotIntervalMs);
  }

  private async runAutopilotLoop(triggerSource: string): Promise<void> {
    if (!this.autopilotLoopActive) return;
    try {
      await this.executeAutopilotPulse(triggerSource);
    } catch (error: any) {
      this.lastPulseError = error?.message || String(error);
      this.lastPulseCompletedAt = new Date().toISOString();
      this.logMind('AUDITOR', `Market-sensing loop recovered from an unexpected error: ${this.lastPulseError}`);
    } finally {
      if (this.autopilotLoopActive) this.scheduleNextAutopilotPulse();
    }
  }

  public getAutopilotStatus() {
    const now = new Date();
    const market = getForexMarketState(now);
    const openSignals = db.getOpenSignals();
    const awaitingSettlement = db.getSignalsAwaitingSettlement();
    const eligibleStrategies = db.getPaperTradingStrategies();
    const strategyEligibility = db.getStrategyEligibilityDiagnostics();
    const reasonCounts = new Map<string, number>();
    for (const item of this.lastPairDiagnostics) {
      reasonCounts.set(item.result, (reasonCounts.get(item.result) || 0) + 1);
    }
    const lastPulseAtMs = this.lastPulseCompletedAt ? Date.parse(this.lastPulseCompletedAt) : null;
    const lastPulseAgeSeconds = lastPulseAtMs !== null && Number.isFinite(lastPulseAtMs)
      ? Math.max(0, Math.floor((now.getTime() - lastPulseAtMs) / 1000))
      : null;
    return {
      schedulerStarted: this.autopilotLoopActive,
      serviceMode: 'IN_PROCESS_PAPER_RESEARCH',
      nextPulseAt: this.nextAutopilotPulseAt,
      lastHeartbeatAt: this.lastPulseCompletedAt,
      lastPulseAgeSeconds,
      pulseHealthy: this.autopilotLoopActive && !this.lastPulseError && lastPulseAgeSeconds !== null && lastPulseAgeSeconds <= 45,
      warmupPending: !!this.autopilotWarmupTimer,
      cycleRunning: this.isRunningCycle,
      market,
      pulseIntervalSeconds: this.autopilotIntervalMs / 1000,
      lastPulseStartedAt: this.lastPulseStartedAt,
      lastPulseCompletedAt: this.lastPulseCompletedAt,
      lastPulseTriggerSource: this.lastPulseTriggerSource,
      lastPulseSkippedReason: this.lastPulseSkippedReason,
      lastPulseError: this.lastPulseError,
      lastPulseResult: this.lastPulseResult,
      openSignalsCount: openSignals.length,
      verifyingSignalsCount: awaitingSettlement.length,
      unresolvedSignalsCount: openSignals.length + awaitingSettlement.length,
      maxConcurrentOpenSignals: 4,
      availableOpenSlots: Math.max(0, 4 - openSignals.length),
      paperStrategiesEligible: eligibleStrategies.length,
      storedStrategyCandidates: db.getSynthesizedStrategies().length,
      strategyEligibility,
      strategyReadiness: eligibleStrategies.length > 0 ? 'READY' : 'NO_HISTORICALLY_QUALIFIED_STRATEGY',
      promotedStrategies: eligibleStrategies.filter(item => item.status === 'PROMOTED_ACTIVE').length,
      freshPairs: this.lastPairDiagnostics.filter(item => item.freshFeed).length,
      pairsScanned: this.lastPairDiagnostics.length,
      blockedPairReasons: [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })),
      pairDiagnostics: this.lastPairDiagnostics,
      checkedAt: now.toISOString(),
    };
  }

  public getEvolutionResearchState() {
    return {
      ...this.researchState,
      nextScanAt: this.nextResearchScanAt,
      batchRunning: this.researchCoordinatorRunning || researchEngine.isEvolutionBatchRunning(),
      scanIntervalMinutes: this.researchIntervalMs / 60_000,
      marketPulseSeconds: this.autopilotIntervalMs / 1000,
      requiredNewM1Candles: MINIMUM_RESEARCH_M1_CANDLES,
      historyWindowLimit: RESEARCH_HISTORY_WINDOW_LIMIT,
      candidatesPerBatch: RESEARCH_CANDIDATES_PER_BATCH,
      maxConcurrentResearchBatches: 1,
      queue: db.getAutonomousResearchQueueState(),
      queueSummary: (() => {
        const pairs = Object.values(db.getAutonomousResearchQueueState().pairs);
        return {
          totalPairs: FOREX_PAIRS.length,
          ready: pairs.filter(item => item && ['READY', 'QUEUED'].includes(item.status)).length,
          running: pairs.filter(item => item?.status === 'RUNNING').length,
          waitingForHistory: pairs.filter(item => item && ['NO_HISTORY', 'INSUFFICIENT_HISTORY', 'LOW_CONTINUITY'].includes(item.status)).length,
          waitingForNewHistory: pairs.filter(item => item?.status === 'WAITING_FOR_NEW_HISTORY').length,
          completed: pairs.filter(item => item?.lastBatchStatus === 'COMPLETED').length,
          failed: pairs.filter(item => item?.lastBatchStatus === 'FAILED').length,
        };
      })(),
    };
  }

  /**
   * Autonomous evolutionary search, separated from market polling.
   * A pair is eligible only with 60k usable new M1 bars since its last inspected
   * holdout, so a failed or repeated batch cannot silently reuse old outcomes.
   */
  private async checkAutonomousEvolutionResearch(): Promise<void> {
    if (this.researchCoordinatorRunning || researchEngine.isEvolutionBatchRunning()) return;
    this.researchCoordinatorRunning = true;
    const checkedAt = new Date().toISOString();
    let queue = db.getAutonomousResearchQueueState();
    const nowMs = Date.now();

    // Respect the persisted cooldown after a completed/failed batch, including
    // process restarts. A single CPU/memory-heavy evolutionary worker is allowed.
    const nextRunMs = queue.nextRunAt ? Date.parse(queue.nextRunAt) : NaN;
    if (Number.isFinite(nextRunMs) && nextRunMs > nowMs) {
      this.nextResearchScanAt = queue.nextRunAt;
      this.researchCoordinatorRunning = false;
      return;
    }

    this.nextResearchScanAt = new Date(nowMs + this.researchIntervalMs).toISOString();
    queue.lastScanAt = checkedAt;
    queue.nextRunAt = this.nextResearchScanAt;
    queue.lastRunStatus = 'SCANNING';
    queue.lastRunMessage = 'Assessing history volume, candle continuity and unconsumed research windows for every currency pair.';
    let anyHistory = false;
    let anyUsableHistory = false;
    let eligibleSymbols = new Set<ForexSymbol>();

    try {
      this.researchState = {
        ...this.researchState,
        status: 'SCANNING',
        checkedAt,
        nextScanAt: this.nextResearchScanAt,
        message: 'Scanning all 20 pairs using bounded monthly history reads. Exactly one eligible pair can run a 300-candidate batch at a time.',
        error: undefined,
      };

      // First pass is metadata-only from the scheduler's perspective: the store
      // streams one month partition at a time and never keeps all 20 histories
      // resident in memory.
      for (const symbol of FOREX_PAIRS) {
        const previous = queue.pairs[symbol];
        const previousHoldoutEndMs = db.getLatestResearchHoldoutEndMs(symbol);
        const lastInspectedThroughMs = previous?.lastInspectedThroughUtc
          ? Date.parse(previous.lastInspectedThroughUtc)
          : null;
        const consumedThroughMs = Math.max(
          previousHoldoutEndMs ?? 0,
          Number.isFinite(lastInspectedThroughMs) ? lastInspectedThroughMs! : 0,
        );
        const stats = historicalDataStore.getStats(
          symbol,
          consumedThroughMs > 0 ? consumedThroughMs - 5_000 : null,
        );
        if (stats.count > 0) anyHistory = true;
        if (stats.usableM1Count > 0) anyUsableHistory = true;

        const readiness = assessResearchPairReadiness(
          stats,
          previousHoldoutEndMs,
          Number.isFinite(lastInspectedThroughMs) ? lastInspectedThroughMs : null,
          stats.usableM1CandlesSince,
        );
        if (readiness.status === 'READY') eligibleSymbols.add(symbol);

        const nextPair: AutonomousResearchPairState = {
          symbol,
          status: readiness.status,
          historyCount: stats.count,
          usableM1Count: stats.usableM1Count,
          zeroVolumeFlatRows: stats.zeroVolumeFlatRows,
          continuityRatio: stats.continuityRatio,
          firstTimestamp: stats.firstTimestamp,
          lastTimestamp: stats.lastTimestamp,
          monthsStored: stats.monthsStored,
          sources: stats.sources,
          previousHoldoutEndUtc: previousHoldoutEndMs
            ? new Date(previousHoldoutEndMs).toISOString()
            : null,
          lastInspectedThroughUtc: previous?.lastInspectedThroughUtc ?? null,
          genuinelyNewM1Candles: readiness.genuinelyNewM1Candles,
          queuePosition: null,
          lastBatchId: previous?.lastBatchId ?? null,
          lastBatchStartedAt: previous?.lastBatchStartedAt ?? null,
          lastBatchFinishedAt: previous?.lastBatchFinishedAt ?? null,
          lastBatchCompletedCandidates: previous?.lastBatchCompletedCandidates ?? 0,
          lastBatchHistoricalPasses: previous?.lastBatchHistoricalPasses ?? 0,
          lastBatchRejected: previous?.lastBatchRejected ?? 0,
          lastBatchFinalists: previous?.lastBatchFinalists ?? 0,
          lastBatchStatus: previous?.lastBatchStatus ?? null,
          lastError: previous?.lastError ?? null,
          readinessMessage: readiness.readinessMessage,
          updatedAt: checkedAt,
        };
        queue.pairs[symbol] = nextPair;
      }

      const positions = assignResearchQueuePositions(
        FOREX_PAIRS,
        queue.nextPairIndex,
        eligibleSymbols,
      );
      for (const [symbol, position] of positions.entries()) {
        const pair = queue.pairs[symbol]!;
        pair.status = 'QUEUED';
        pair.queuePosition = position;
        pair.updatedAt = checkedAt;
      }

      const selection = selectNextResearchPair(
        FOREX_PAIRS,
        queue.nextPairIndex,
        eligibleSymbols,
      );

      if (!selection) {
        const allNoHistory = FOREX_PAIRS.every(symbol =>
          queue.pairs[symbol]?.status === 'NO_HISTORY'
        );
        const waitingForNewHistory = FOREX_PAIRS.filter(symbol =>
          queue.pairs[symbol]?.status === 'WAITING_FOR_NEW_HISTORY'
        ).length;
        const insufficient = FOREX_PAIRS.filter(symbol =>
          ['INSUFFICIENT_HISTORY', 'LOW_CONTINUITY'].includes(queue.pairs[symbol]?.status || '')
        ).length;
        const status = !anyHistory || !anyUsableHistory
          ? 'WAITING_FOR_HISTORY'
          : waitingForNewHistory > 0
            ? 'WAITING_FOR_NEW_HISTORY'
            : 'WAITING_FOR_HISTORY';
        const message = allNoHistory
          ? 'No imported M1 history exists for any pair. Import at least 60,000 usable, continuous M1 candles for each pair you want researched.'
          : `No pair is currently eligible. ${waitingForNewHistory} pair(s) are waiting for 60,000 genuinely new M1 candles; ${insufficient} pair(s) need more usable history or better continuity. Previously inspected windows are never recycled.`;

        queue.currentSymbol = null;
        queue.lastScanFinishedAt = new Date().toISOString();
        queue.lastRunStatus = 'WAITING';
        queue.lastRunMessage = message;
        queue.nextRunAt = new Date(Date.now() + this.researchIntervalMs).toISOString();
        this.nextResearchScanAt = queue.nextRunAt;
        db.setAutonomousResearchQueueState(queue, true);

        this.researchState = {
          ...this.researchState,
          status,
          checkedAt,
          nextScanAt: queue.nextRunAt,
          completedCandidates: 0,
          totalCandidates: RESEARCH_CANDIDATES_PER_BATCH,
          historicalPasses: 0,
          rejected: 0,
          finalists: 0,
          message,
        };
        return;
      }

      const { symbol } = selection;
      const pair = queue.pairs[symbol]!;
      const candles = historicalDataStore.getLatestCandles(symbol, RESEARCH_HISTORY_WINDOW_LIMIT);
      const usableWindow = candles.filter(candle =>
        TRUSTED_MARKET_SOURCES.has(candle.source) &&
        !(candle.volume === 0 &&
          candle.open === candle.high &&
          candle.high === candle.low &&
          candle.low === candle.close)
      );
      let consecutiveMinuteSteps = 0;
      for (let index = 1; index < usableWindow.length; index++) {
        if (Math.abs(
          (usableWindow[index].timestampMs - usableWindow[index - 1].timestampMs) - 60_000
        ) <= 5_000) consecutiveMinuteSteps++;
      }
      const windowContinuity = consecutiveMinuteSteps / Math.max(1, usableWindow.length - 1);

      // A pair may have 60k candles in its full archive while its bounded latest
      // research window is still insufficient. Check before consuming any window.
      if (usableWindow.length < MINIMUM_RESEARCH_M1_CANDLES ||
          windowContinuity < 0.75 ||
          candles.some(candle => candle.source === 'synthetic' || candle.source === 'test_fixture')) {
        pair.status = usableWindow.length < MINIMUM_RESEARCH_M1_CANDLES
          ? 'INSUFFICIENT_HISTORY'
          : 'LOW_CONTINUITY';
        pair.queuePosition = null;
        // A failed preflight did not inspect candidate outcomes or reserve a holdout.
        // Do not advance lastInspectedThroughUtc here; that would incorrectly force
        // this pair to wait for another 60,000 candles before it can be retried.
        pair.readinessMessage = usableWindow.length < MINIMUM_RESEARCH_M1_CANDLES
          ? `Latest ${RESEARCH_HISTORY_WINDOW_LIMIT.toLocaleString()}-candle research window contains only ${usableWindow.length.toLocaleString()} usable M1 rows; at least ${MINIMUM_RESEARCH_M1_CANDLES.toLocaleString()} are required.`
          : `Latest research window continuity is ${(windowContinuity * 100).toFixed(1)}%; at least 75% is required. No holdout was consumed.`;
        pair.updatedAt = new Date().toISOString();
        queue.nextPairIndex = selection.nextPairIndex;
        queue.currentSymbol = null;
        queue.lastScanFinishedAt = new Date().toISOString();
        queue.lastRunStatus = 'WAITING';
        queue.lastRunMessage = `${symbol} failed latest-window preflight; it remains visible in the queue and the next pair will get the next turn.`;
        queue.nextRunAt = new Date(Date.now() + this.researchIntervalMs).toISOString();
        this.nextResearchScanAt = queue.nextRunAt;
        db.setAutonomousResearchQueueState(queue, true);
        this.researchState = {
          ...this.researchState,
          status: 'WAITING_FOR_HISTORY',
          checkedAt,
          nextScanAt: queue.nextRunAt,
          message: queue.lastRunMessage,
        };
        return;
      }

      const latestInspectedMs = usableWindow[usableWindow.length - 1].timestampMs;
      const latestCandidateGeneration = db.getSynthesizedStrategies().reduce(
        (maximum, gene) => Math.max(maximum, gene.generation || 0),
        0
      );
      const latestBatchGeneration = db.getGenerations().reduce(
        (maximum, generation) => Math.max(maximum, generation.generation || 0),
        0
      );
      const batchGeneration = Math.max(
        latestCandidateGeneration,
        latestBatchGeneration,
        this.currentGeneration - 1,
      ) + 1;
      const batchId = `autonomous_${symbol.replace('/', '')}_${Date.now().toString(36)}`;
      const startedAt = new Date().toISOString();

      // Persist the consumed data boundary and queue cursor before the expensive
      // worker starts, so a process restart cannot silently replay this window.
      queue.nextPairIndex = selection.nextPairIndex;
      queue.currentSymbol = symbol;
      queue.lastBatchStartedAt = startedAt;
      queue.batchesStarted++;
      queue.lastRunStatus = 'RUNNING';
      queue.lastRunMessage = `Researching ${symbol}: 300 candidates, one worker, no holdout reuse.`;
      // No next-run time is advertised while the worker is still running.
      queue.nextRunAt = null;
      pair.status = 'RUNNING';
      pair.queuePosition = 0;
      pair.lastInspectedThroughUtc = new Date(latestInspectedMs).toISOString();
      pair.lastBatchId = batchId;
      pair.lastBatchStartedAt = startedAt;
      pair.lastBatchFinishedAt = null;
      pair.lastBatchCompletedCandidates = 0;
      pair.lastBatchHistoricalPasses = 0;
      pair.lastBatchRejected = 0;
      pair.lastBatchFinalists = 0;
      pair.lastBatchStatus = null;
      pair.lastError = null;
      pair.readinessMessage = 'A dedicated 300-candidate batch is running on this pair. The same history window will not be replayed after interruption.';
      pair.updatedAt = startedAt;
      db.setAutonomousResearchQueueState(queue, true);
      this.nextResearchScanAt = null;

      const latestResearchGeneration = Math.max(
        latestCandidateGeneration,
        latestBatchGeneration,
        this.currentGeneration - 1,
      ) + 1;
      const actualBatchGeneration = Math.max(batchGeneration, latestResearchGeneration);
      this.researchState = {
        status: 'RUNNING',
        symbol,
        batchId,
        startedAt,
        checkedAt,
        nextScanAt: queue.nextRunAt,
        completedCandidates: 0,
        totalCandidates: RESEARCH_CANDIDATES_PER_BATCH,
        historicalPasses: 0,
        rejected: 0,
        finalists: 0,
        message: `Running 10 generations × 30 symbolic candidates for ${symbol}. The queue keeps every other pair in order while this single worker runs.`,
      };
      this.logMind('SCIENTIST', `Autonomous multi-pair research started for ${symbol}: 300 candidates; queue cursor persisted; single-worker resource guard active.`, symbol);

      try {
        const results = await researchEngine.runNovelStrategySearchBatch(
          symbol,
          candles,
          batchId,
          actualBatchGeneration,
          progress => {
            this.researchState = {
              ...this.researchState,
              completedCandidates: progress.completed,
              historicalPasses: progress.passedHistorical,
              rejected: progress.rejected,
              finalists: progress.replicationFinalists,
              message: `${symbol}: ${progress.completed}/300 candidates; ${progress.passedHistorical} historical passes, ${progress.rejected} rejected, ${progress.replicationFinalists} replication finalists. Other pairs remain queued.`,
            };
            if (progress.completed % 10 === 0 || progress.completed === RESEARCH_CANDIDATES_PER_BATCH) {
              pair.lastBatchCompletedCandidates = progress.completed;
              pair.lastBatchHistoricalPasses = progress.passedHistorical;
              pair.lastBatchRejected = progress.rejected;
              pair.lastBatchFinalists = progress.replicationFinalists;
              pair.updatedAt = new Date().toISOString();
              db.setAutonomousResearchQueueState(queue);
            }
          }
        );
        const finishedAt = new Date().toISOString();
        const consumedHoldout = db.getResearchHoldoutWindow(batchId);
        const passed = results.filter(gene => gene.status === 'PAPER_TRADING').length;
        const rejected = results.filter(gene => gene.status === 'REJECTED').length;
        const bestValidation = results
          .filter(gene => gene.discoveryMetrics)
          .sort((a, b) =>
            (b.discoveryMetrics!.validationExpectedValueUnits - a.discoveryMetrics!.validationExpectedValueUnits) ||
            (b.discoveryMetrics!.validationWinRate - a.discoveryMetrics!.validationWinRate)
          )[0];
        const batchRecord: EvolutionGeneration = {
          generation: actualBatchGeneration,
          timestamp: finishedAt,
          totalExperiments: results.length,
          acceptedCount: passed,
          rejectedCount: rejected,
          topExperimentId: null,
          bestF1Score: 0,
          summary: `Autonomous symbolic search ${batchId} completed for ${symbol}: ${results.length} candidates generated; ${passed} passed payout-aware historical gates; ${rejected} rejected; ${results.length - passed - rejected} lacked sufficient evidence. Historical passage is not forward approval.`,
          lessonsLearned: [
            `Ten genetic generations were evaluated using causal features; ${this.researchState.finalists} finalists were selected before the one-time untouched holdout was inspected.`,
            bestValidation
              ? `Highest discovery validation expectancy was ${bestValidation.discoveryMetrics!.validationExpectedValueUnits.toFixed(4)} stake units/trade, with ${(bestValidation.discoveryMetrics!.validationWinRate * 100).toFixed(1)}% observed WR (n=${bestValidation.discoveryMetrics!.validationScoredTrades}).`
              : 'No candidate produced a usable validation record.',
            'Only candidates passing payout-aware train/validation and multiple-comparison-adjusted holdout checks may enter forward paper trading. No broker execution is enabled.',
          ],
          researchBatchId: batchId,
          researchSeed: results[0]?.researchSeed,
          datasetFingerprint: results[0]?.datasetFingerprint,
          featureSchemaVersion: results[0]?.featureSchemaVersion ?? FEATURE_SCHEMA_VERSION,
          researchEngineVersion: results[0]?.researchEngineVersion ?? RESEARCH_ENGINE_VERSION,
          status: 'COMPLETED',
          symbol,
          bestValidationExpectedValueUnits: bestValidation?.discoveryMetrics?.validationExpectedValueUnits ?? 0,
          holdoutPeriod: consumedHoldout
            ? { start: consumedHoldout.startUtc, end: consumedHoldout.endUtc }
            : undefined,
        };
        db.addGeneration(batchRecord);
        db.saveStateSync();
        this.currentGeneration = actualBatchGeneration + 10;
        const summary = batchRecord.summary;

        pair.status = 'COMPLETED';
        pair.lastBatchFinishedAt = finishedAt;
        pair.lastBatchCompletedCandidates = results.length;
        pair.lastBatchHistoricalPasses = passed;
        pair.lastBatchRejected = rejected;
        pair.lastBatchFinalists = this.researchState.finalists;
        pair.lastBatchStatus = 'COMPLETED';
        pair.previousHoldoutEndUtc = consumedHoldout?.endUtc ?? pair.previousHoldoutEndUtc;
        pair.readinessMessage = summary;
        pair.lastError = null;
        pair.updatedAt = finishedAt;
        pair.queuePosition = null;

        queue.currentSymbol = null;
        queue.lastBatchFinishedAt = finishedAt;
        queue.lastScanFinishedAt = finishedAt;
        queue.batchesCompleted++;
        queue.lastRunStatus = 'COMPLETED';
        queue.lastRunMessage = summary;
        queue.nextRunAt = new Date(Date.now() + this.researchIntervalMs).toISOString();
        this.nextResearchScanAt = queue.nextRunAt;
        db.setAutonomousResearchQueueState(queue, true);

        this.researchState = {
          status: 'COMPLETED',
          symbol,
          batchId,
          startedAt,
          finishedAt,
          checkedAt: finishedAt,
          nextScanAt: queue.nextRunAt,
          completedCandidates: results.length,
          totalCandidates: RESEARCH_CANDIDATES_PER_BATCH,
          historicalPasses: passed,
          rejected,
          finalists: this.researchState.finalists,
          message: summary,
        };
        this.logMind('AUDITOR', summary, symbol);
      } catch (error: any) {
        const finishedAt = new Date().toISOString();
        const consumedHoldout = db.getResearchHoldoutWindow(batchId);
        const alreadyRecorded = db.getGenerations().some(record => record.researchBatchId === batchId);
        if (!alreadyRecorded) {
          const failedRecord: EvolutionGeneration = {
            generation: actualBatchGeneration,
            timestamp: finishedAt,
            totalExperiments: this.researchState.completedCandidates,
            acceptedCount: this.researchState.historicalPasses,
            rejectedCount: this.researchState.rejected,
            topExperimentId: null,
            bestF1Score: 0,
            summary: `Autonomous research batch ${batchId} failed for ${symbol} at ${this.researchState.completedCandidates}/300 candidates. No partial run is called successful. ${consumedHoldout ? 'Reserved holdout remains permanently consumed.' : 'No holdout had been reserved.'} Error: ${error?.message || 'Unknown research failure'}`,
            lessonsLearned: [
              `Partial batch: ${this.researchState.completedCandidates}/300 candidates; ${this.researchState.historicalPasses} historical passes, ${this.researchState.rejected} rejected.`,
              consumedHoldout
                ? `Consumed holdout: ${consumedHoldout.startUtc} to ${consumedHoldout.endUtc}; do not reuse.`
                : 'No holdout was reserved before the failure.',
            ],
            researchBatchId: batchId,
            status: 'FAILED',
            symbol,
            bestValidationExpectedValueUnits: 0,
            holdoutPeriod: consumedHoldout
              ? { start: consumedHoldout.startUtc, end: consumedHoldout.endUtc }
              : undefined,
          };
          db.addGeneration(failedRecord);
          db.saveStateSync();
        }

        const message = error?.message || 'Unknown research failure';
        pair.status = 'FAILED';
        pair.lastBatchFinishedAt = finishedAt;
        pair.lastBatchCompletedCandidates = this.researchState.completedCandidates;
        pair.lastBatchHistoricalPasses = this.researchState.historicalPasses;
        pair.lastBatchRejected = this.researchState.rejected;
        pair.lastBatchFinalists = this.researchState.finalists;
        pair.lastBatchStatus = 'FAILED';
        pair.previousHoldoutEndUtc = consumedHoldout?.endUtc ?? pair.previousHoldoutEndUtc;
        pair.lastError = message;
        pair.readinessMessage = `Batch failed. Its inspected history boundary remains consumed; wait for new history before another attempt. ${message}`;
        pair.updatedAt = finishedAt;
        pair.queuePosition = null;

        queue.currentSymbol = null;
        queue.lastBatchFinishedAt = finishedAt;
        queue.lastScanFinishedAt = finishedAt;
        queue.batchesFailed++;
        queue.lastRunStatus = 'FAILED';
        queue.lastRunMessage = `${symbol} batch failed; the pair remains visible and will only re-enter after new unconsumed M1 history is available. ${message}`;
        queue.nextRunAt = new Date(Date.now() + this.researchIntervalMs).toISOString();
        this.nextResearchScanAt = queue.nextRunAt;
        db.setAutonomousResearchQueueState(queue, true);

        this.researchState = {
          status: 'FAILED',
          symbol,
          batchId,
          startedAt,
          finishedAt,
          checkedAt: finishedAt,
          nextScanAt: queue.nextRunAt,
          completedCandidates: this.researchState.completedCandidates,
          totalCandidates: RESEARCH_CANDIDATES_PER_BATCH,
          historicalPasses: this.researchState.historicalPasses,
          rejected: this.researchState.rejected,
          finalists: this.researchState.finalists,
          message: 'The batch failed; no incomplete run was promoted and its inspected window will not be replayed.',
          error: message,
        };
        this.logMind('AUDITOR', `Autonomous research batch failed for ${symbol}: ${message}.`, symbol);
      }
    } catch (error: any) {
      const finishedAt = new Date().toISOString();
      queue.lastScanFinishedAt = finishedAt;
      queue.currentSymbol = null;
      queue.lastRunStatus = 'FAILED';
      queue.lastRunMessage = error?.message || 'The multi-pair queue scan failed.';
      queue.nextRunAt = new Date(Date.now() + this.researchIntervalMs).toISOString();
      this.nextResearchScanAt = queue.nextRunAt;
      db.setAutonomousResearchQueueState(queue, true);
      this.researchState = {
        ...this.researchState,
        status: 'FAILED',
        checkedAt: finishedAt,
        nextScanAt: queue.nextRunAt,
        message: 'The multi-pair research queue scan failed; market sensing remains independent.',
        error: error?.message || 'Unknown queue scan failure',
      };
      this.logMind('AUDITOR', `Autonomous multi-pair research scan failed: ${error?.message || 'Unknown failure'}.`);
    } finally {
      this.researchCoordinatorRunning = false;
    }
  }

  private logMind(
    role: AutopilotLog['role'],
    message: string,
    symbol?: ForexSymbol,
    signalId?: string
  ) {
    const now = Date.now();
    let dedupeKey: string | null = null;
    let throttleMs = 60_000;

    const regimeGate = message.match(/^\[REGIME GATE\] Suppressed evolved candidate ([^:]+):/);
    if (regimeGate) {
      // One stable diagnostic per pair/genome per five minutes. The measured
      // regime values may change each pulse; they do not justify 20 repeated alerts.
      dedupeKey = `REGIME_GATE:${symbol || 'UNKNOWN'}:${regimeGate[1]}`;
      throttleMs = 5 * 60_000;
    } else {
      const memoryVeto = message.match(/^\[EPISODIC MEMORY VETO\] ([A-Z]{3}\/[A-Z]{3}) (BUY|SELL)/);
      if (memoryVeto) {
        dedupeKey = `MEMORY_VETO:${memoryVeto[1]}:${memoryVeto[2]}`;
        throttleMs = 60_000;
      }
    }

    if (dedupeKey) {
      const previousAt = this.lastDiagnosticLogAt.get(dedupeKey);
      if (previousAt !== undefined && now - previousAt < throttleMs) return;
      this.lastDiagnosticLogAt.set(dedupeKey, now);
      if (this.lastDiagnosticLogAt.size > 2_000) {
        for (const [key, timestamp] of this.lastDiagnosticLogAt) {
          if (now - timestamp > 10 * 60_000) this.lastDiagnosticLogAt.delete(key);
        }
      }
    }

    db.addAutopilotLog({
      id: `log_${now}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date(now).toISOString(),
      role,
      message,
      symbol,
      signalId,
    });
  }

  /**
   * Continuous Autonomous Autopilot Pulse:
   * Senses market -> Evaluates active signals -> Scans for setups -> Emits signals -> Evolves models.
   */
  public async executeAutopilotPulse(triggerSource: string = 'AUTOPILOT'): Promise<{
    durationMs: number;
    pairsProcessed: number;
    signalsCreated: number;
    signalsUpdated: number;
    experimentsRun: number;
    topExperiment: ResearchExperiment | null;
  }> {
    if (this.isRunningCycle) {
      this.lastPulseSkippedReason = 'PREVIOUS_PULSE_STILL_RUNNING';
      return {
        durationMs: 0,
        pairsProcessed: 0,
        signalsCreated: 0,
        signalsUpdated: 0,
        experimentsRun: 0,
        topExperiment: null,
      };
    }

    const pulseNow = new Date();
    this.lastPulseStartedAt = pulseNow.toISOString();
    this.lastPulseTriggerSource = triggerSource;
    this.lastPulseSkippedReason = null;
    this.lastPulseError = null;
    const cancelledSignals = entryExitEngine.cancelSignalsOutsideForexWeek();
    if (cancelledSignals.length > 0) {
      this.logMind(
        'AUDITOR',
        `[MARKET HOURS CLEANUP] Cancelled ${cancelledSignals.length} legacy signal(s) with weekend-invalid decision/entry/expiry times. No outcomes were scored.`
      );
    }
    const marketState = getForexMarketState(Date.now());
    if (!marketState.isOpen) {
      // Do not fetch feeds, evaluate pending contracts, or create signals outside the FX week.
      this.lastPulseSkippedReason = 'FOREX_MARKET_CLOSED';
      this.lastPulseCompletedAt = new Date().toISOString();
      this.lastPulseResult = { durationMs: 0, pairsProcessed: 0, signalsCreated: 0, signalsUpdated: 0 };
      this.lastPairDiagnostics = [];
      return {
        durationMs: 0,
        pairsProcessed: 0,
        signalsCreated: 0,
        signalsUpdated: 0,
        experimentsRun: 0,
        topExperiment: null,
      };
    }

    this.isRunningCycle = true;
    const startTime = Date.now();
    this.cycleCount++;

    try {
      const lifecycleCandlesMap: Record<ForexSymbol, Candle[]> = {} as any;
      const freshCandlesMap: Record<ForexSymbol, Candle[]> = {} as any;
      const trustedSources = TRUSTED_MARKET_SOURCES;
      const strategyPool = db.getPaperTradingStrategies().sort((a, b) =>
        Number(b.status === 'PROMOTED_ACTIVE') - Number(a.status === 'PROMOTED_ACTIVE') ||
        db.getStrategyBayesianUcbScore(b.id) - db.getStrategyBayesianUcbScore(a.id)
      );
      const pairDiagnostics = FOREX_PAIRS.map(symbol => ({
        symbol,
        source: 'none',
        freshFeed: false,
        newestCandleAt: null as string | null,
        ageSeconds: null as number | null,
        candleCount: 0,
        eligibleTimeframes: [] as number[],
        eligibleStrategyPoolCount: strategyPool.length,
        sessionCompatibleStrategyCount: 0,
        expiryCompatibleStrategyCount: 0,
        strategiesEvaluated: 0,
        regimeRejected: 0,
        activationPassed: 0,
        memoryVetoes: 0,
        selectedExpiryMinutes: null as number | null,
        lastStrategyName: null as string | null,
        signalPersisted: false,
        signalCreationError: null as string | null,
        result: 'FEED_NOT_CHECKED',
      }));

      // Sense independent currency pairs concurrently with a hard ceiling.
      // A slow provider on one pair no longer blocks the rest of the 24/5 watchlist.
      await mapWithConcurrency(FOREX_PAIRS, MARKET_SENSE_CONCURRENCY, async (symbol, index) => {
        freshCandlesMap[symbol] = [];
        const pairDiagnostic = pairDiagnostics[index];
        const readTrustedHistory = () => getTrustedMarketCandles(
          db.getCandles(symbol, 5000).filter(c => trustedSources.has(c.source))
        );
        lifecycleCandlesMap[symbol] = readTrustedHistory();

        try {
          const res = await dataFeedEngine.fetchCandles(symbol, 100);
          // The feed bridge may append synthetic continuity bars after a genuine
          // provider candle. Judge freshness from the newest trusted candle, not
          // from the synthetic tail, and never pass synthetic bars to signal logic.
          const feedSnapshot = getTrustedFreshCandleSnapshot(res.candles, Date.now());
          const newest = feedSnapshot.newestCandle;
          const ageMs = feedSnapshot.ageMs;
          const isRealFreshFeed = feedSnapshot.isFresh;

          pairDiagnostic.source = res.source;
          pairDiagnostic.newestCandleAt = newest?.timestamp || null;
          pairDiagnostic.ageSeconds = ageMs === null ? null : Math.round(ageMs / 1000);
          pairDiagnostic.freshFeed = isRealFreshFeed;
          lifecycleCandlesMap[symbol] = readTrustedHistory();
          freshCandlesMap[symbol] = isRealFreshFeed ? feedSnapshot.candles : [];
          pairDiagnostic.candleCount = freshCandlesMap[symbol].length;
          pairDiagnostic.result = res.closeOnlySeries.length >= 2 && !isRealFreshFeed
            ? 'CLOSE_ONLY_FEED_INELIGIBLE_FOR_STRATEGIES'
            : !feedSnapshot.isCandleStructureValid
              ? 'COLLAPSED_OHLC_FEED_INELIGIBLE_FOR_STRATEGIES'
              : !isRealFreshFeed
                ? 'NO_FRESH_TRUSTED_M1_FEED'
                : freshCandlesMap[symbol].length < 35
                  ? 'INSUFFICIENT_FRESH_M1_CANDLES'
                  : 'FRESH_FEED_READY';
        } catch (err: any) {
          pairDiagnostic.result = 'FEED_FETCH_FAILED';
          console.error(`[Autopilot] Sensing failed for ${symbol}:`, err.message);
        }
      });

      // 2. Step lifecycle engine from retained genuine candles, even when the
      // latest feed is stale. Fresh data remains mandatory for new signals.
      const updatedSignals = entryExitEngine.evaluateSignals(lifecycleCandlesMap);
      if (updatedSignals.length > 0) {
        for (const sig of updatedSignals) {
          if (sig.lifecycleState === 'ACTIVE') {
            this.logMind(
              'EXECUTION',
              `Causal trigger confirmed for ${sig.symbol} ${sig.direction} at ${sig.actualEntryPrice}. Expiry clock running (${sig.expiryMinutes}m).`,
              sig.symbol,
              sig.id
            );
          } else if (sig.lifecycleState === 'CLOSED') {
            const tradeExp = db.recordForwardObservation(sig);
            db.recordStrategyOutcome(sig);

            // Closed-trade forensic diagnosis; generated antidotes remain unvalidated.
            // Every loss counts: investigate causal root-cause and evolve antidote strategy
            if (sig.outcomeResult === 'LOSS') {
              const expiryCandle = lifecycleCandlesMap[sig.symbol]?.find(
                candle => candle.timestamp === sig.actualExitTimeUtc
              );
              if (expiryCandle) {
                const autopsy = researchEngine.recordLossObservation(sig, expiryCandle);
                sig.lossAutopsy = autopsy;
                db.addLossAutopsy(autopsy);
                db.updateSignal(sig);
              }

              this.logMind(
                'AUDITOR',
                expiryCandle
                  ? `[LOSS OBSERVATION RECORDED]: ${sig.symbol} ${sig.direction} settled as LOSS. The exact expiry candle was added to diagnostics and the forward ledger.`
                  : `[LOSS RECORDED]: ${sig.symbol} ${sig.direction} settled as LOSS, but the exact expiry candle is unavailable for diagnostics. No replacement candle was fabricated.`,
                sig.symbol,
                sig.id
              );
            } else {
              this.logMind(
                'EXECUTION',
                `Paper contract closed for ${sig.symbol} ${sig.direction} at ${sig.actualExitPrice}. Payout-adjusted return: ${(sig.netReturnUnits ?? 0) > 0 ? '+' : ''}${(sig.netReturnUnits ?? 0).toFixed(3)} stake units (${sig.outcomeResult}). Recorded as forward paper observation ${tradeExp.id}.`,
                sig.symbol,
                sig.id
              );
            }
          } else if (sig.lifecycleState === 'AMBIGUOUS') {
            this.logMind(
              'AUDITOR',
              `Marked ${sig.symbol} setup as AMBIGUOUS: both trigger & invalidation levels penetrated within 1m bar. Zero lookahead assumption enforced.`,
              sig.symbol,
              sig.id
            );
          }
        }
      }

      // 3. Evolved-genome paper discovery only. The shared trading clock and
      // signal factory enforces exactly T-3m before M5 entry and a separate 5–30m expiry.
      const createdSignals: any[] = [];
      // EXIT_PENDING contracts remain eligible for candle reconciliation but do
      // not consume a new-entry slot once their scheduled expiry has passed.
      const currentActive = db.getOpenSignals();
      const activeSymbols = new Set(currentActive.map(s => s.symbol));
      const diagnosticBySymbol = new Map(pairDiagnostics.map(item => [item.symbol, item]));
      const activeSession = getSessionFromTimestamp(new Date());
      for (const diagnostic of pairDiagnostics) {
        diagnostic.sessionCompatibleStrategyCount = strategyPool.filter(gene =>
          (!gene.symbol || gene.symbol === diagnostic.symbol) &&
          (gene.sessionAffinity === 'ALL' || gene.sessionAffinity === activeSession.id)
        ).length;
      }

      const nowMs = Date.now();

      // Signals are emitted only from a fully closed M1 bar at T-3 minutes
      // for the selected 5/10/15/20/25/30-minute entry candle.
      if (currentActive.length + createdSignals.length < 4) {
        for (const symbol of FOREX_PAIRS) {
          const pairDiagnostic = diagnosticBySymbol.get(symbol);
          if (currentActive.length + createdSignals.length >= 4) {
            if (pairDiagnostic) pairDiagnostic.result = 'GLOBAL_OPEN_SIGNAL_CAP_REACHED';
            continue;
          }
          // Pair exclusivity applies only while an entry is waiting or a contract is open.
          if (activeSymbols.has(symbol)) {
            if (pairDiagnostic) pairDiagnostic.result = 'PAIR_ALREADY_HAS_OPEN_SIGNAL';
            continue;
          }

          const candles = (freshCandlesMap[symbol] || []).filter(candle =>
            candle.source !== 'synthetic' && candle.timestampMs + 60_000 <= nowMs
          );
          if (candles.length < 35) {
            if (pairDiagnostic?.freshFeed) pairDiagnostic.result = 'INSUFFICIENT_FRESH_M1_CANDLES';
            continue;
          }

          const c = candles[candles.length - 1];
          const eligibleSchedules = findEligibleStartTimeframes(nowMs, c.timestampMs + 60_000)
            .filter(schedule => isForexMarketIntervalOpen(
              schedule.entryTimeMs,
              schedule.entryTimeMs + schedule.timeframeMinutes * 60_000
            ));
          if (pairDiagnostic) pairDiagnostic.eligibleTimeframes = eligibleSchedules.map(item => item.timeframeMinutes);
          if (eligibleSchedules.length === 0) {
            if (pairDiagnostic) pairDiagnostic.result = 'NO_T_MINUS_3_ENTRY_WINDOW';
            continue;
          }
          const prev = candles[candles.length - 2];
          // Technical indicators
          const closes = candles.map(k => k.close);
          const ema9 = researchEngine.calculateEMA(closes, 9);
          const ema21 = researchEngine.calculateEMA(closes, 21);
          const rsi14 = researchEngine.calculateRSI(closes, 14);
          const marketFeatureVector = researchEngine.extractCausalFeatureVector(
            c, prev, closes, ema9, ema21, rsi14, closes.length - 1
          );
          const regimeAssessment = classifyMarketRegime(candles, activeSession.id);
          db.updateMarketRegime(symbol, activeSession.id, regimeAssessment);

          // -------------------------------------------------------------
          // Evaluate evolved symbolic candidates using their stored executable genomes.
          // Checks if an evolved, multi-dimensional quantitative formula
          // with non-linear polynomial operators triggers on this candle
          // -------------------------------------------------------------
          const promotedGenes = strategyPool;
          // There is one execution candle only: the next aligned M5 open.
          // Strategy horizon is expiry duration, independent of that entry candle.
          const selectedSchedule = eligibleSchedules[0];
          if (!selectedSchedule) continue;

          const pairAndSessionGenes = promotedGenes.filter(gene =>
            (!gene.symbol || gene.symbol === symbol) &&
            (gene.sessionAffinity === 'ALL' || gene.sessionAffinity === activeSession.id)
          );
          const expiryCompatibleGenes = pairAndSessionGenes.filter(gene =>
            isSupportedExpiryMinutes(gene.optimalHorizonMinutes) &&
            isForexMarketIntervalOpen(
              selectedSchedule.entryTimeMs,
              selectedSchedule.entryTimeMs + gene.optimalHorizonMinutes * 60_000
            )
          );

          if (pairDiagnostic) {
            pairDiagnostic.expiryCompatibleStrategyCount = expiryCompatibleGenes.length;
          }
          if (expiryCompatibleGenes.length === 0) {
            if (pairDiagnostic) {
              pairDiagnostic.result = pairAndSessionGenes.length > 0
                ? 'NO_VALID_EXPIRY_WINDOW_BEFORE_MARKET_CLOSE'
                : 'NO_QUALIFIED_PAIR_SESSION_EXPIRY_STRATEGY';
            }
            continue;
          }
          let regimeRejected = false;
          let memoryVetoed = false;
          let strategyEvaluated = false;
          let novelGeneCandidate: {
            gene: typeof promotedGenes[0];
            direction: 'BUY' | 'SELL';
            conviction: number;
            rationale: string;
          } | null = null;

          for (const gene of expiryCompatibleGenes) {
            // The gene's optimal horizon is the independently validated expiry,
            // not the entry candle size. Every candidate enters at the same M5 open.
            if (pairDiagnostic) pairDiagnostic.selectedExpiryMinutes = gene.optimalHorizonMinutes;
            const geneStyle = inferGenomeStyle(gene.genome?.expression);
            const regimeGate = isStrategyRegimeCompatible(geneStyle, regimeAssessment.regime);
            if (!regimeGate.allowed) {
              regimeRejected = true;
              if (pairDiagnostic) pairDiagnostic.regimeRejected++;
              this.logMind(
                'AUDITOR',
                '[REGIME GATE] Suppressed evolved candidate ' + gene.id + ': ' + regimeGate.reason +
                  ' Regime=' + regimeAssessment.regime + ', ER=' +
                  (regimeAssessment.directionalEfficiency?.toFixed(3) ?? 'n/a') + ', ATR ratio=' +
                  (regimeAssessment.atrRatio?.toFixed(3) ?? 'n/a') + '.',
                symbol
              );
              continue;
            }
            strategyEvaluated = true;
            if (pairDiagnostic) {
              pairDiagnostic.strategiesEvaluated++;
              pairDiagnostic.lastStrategyName = gene.name;
            }
            const evalResult = researchEngine.evaluateSynthesizedGeneSignal(
              gene,
              c,
              prev,
              closes,
              ema9,
              ema21,
              rsi14
            );
            if (evalResult.shouldTrigger) {
              if (pairDiagnostic) pairDiagnostic.activationPassed++;
              const memoryAssessment = db.assessEpisodicMemory({
                symbol,
                direction: evalResult.direction,
                ruleFamily: inferGenomeRuleFamily(gene.genome?.expression),
                featureVector: marketFeatureVector,
                predictionTimeUtc: new Date().toISOString(),
              });
              if (memoryAssessment.veto) {
                memoryVetoed = true;
                if (pairDiagnostic) pairDiagnostic.memoryVetoes++;
                this.logMind(
                  'AUDITOR',
                  '[EPISODIC MEMORY VETO] ' + symbol + ' ' + evalResult.direction +
                    ' suppressed by ' + memoryAssessment.neighborsFound + ' earlier similar outcomes; weighted EV=' +
                    memoryAssessment.weightedExpectedReturnUnits?.toFixed(3) + ' stake units. ' +
                    memoryAssessment.reason,
                  symbol
                );
                continue;
              }
              novelGeneCandidate = {
                gene,
                direction: evalResult.direction,
                conviction: evalResult.conviction,
                rationale: evalResult.rationale,
              };
              break;
            }
          }

          if (novelGeneCandidate) {
            const gene = novelGeneCandidate.gene;
            const entryOpenUtc = new Date(selectedSchedule.entryTimeMs).toISOString();
            const duplicateForEntry = db.getSignals().find(existing =>
              existing.symbol === symbol && existing.candleOpenTimeUtc === entryOpenUtc
            );
            if (duplicateForEntry) {
              if (pairDiagnostic) pairDiagnostic.result = 'ENTRY_CANDLE_ALREADY_RECORDED';
              continue;
            }
            let signal: ReturnType<typeof entryExitEngine.createResearchSignal>;
            try {
              signal = entryExitEngine.createResearchSignal({
              symbol,
              direction: novelGeneCandidate.direction,
              signalCandle: c,
              ruleFamily: 'volatility_squeeze',
              expiryMinutes: gene.optimalHorizonMinutes,
              entryTimeframeMinutes: ENTRY_CANDLE_TIMEFRAME_MINUTES,
              candleOpenTimeUtc: new Date(selectedSchedule.entryTimeMs).toISOString(),
              candleCloseTimeUtc: new Date(selectedSchedule.entryTimeMs + gene.optimalHorizonMinutes * 60_000).toISOString(),
              confidence: novelGeneCandidate.conviction,
              modelVersion: `v3.1-evolutionary-genome`,
              strategyName: gene.name,
              strategyId: gene.id,
              strategyWinRate: gene.verifiedAccuracy,
              strategyHistoricalSampleSize: gene.sampleCount,
              strategyEvidenceStatus: gene.accuracyStatus,
              strategyForwardApproved: gene.status === 'PROMOTED_ACTIVE',
              confluenceStrategies: [...gene.parents],
              confluenceScore: 0,
              isStackedStrategy: false,
              isNovelAiSynthesized: true,
              synthesizedGeneId: gene.id,
              mathematicalFormula: gene.mathematicalFormula,
              whyHumansMissThis: gene.whyHumansMissThis,
              paperOnly: true,
              marketFeatureVector,
              notes: gene.status !== 'PROMOTED_ACTIVE'
                ? `[PAPER ONLY] Historical candidate has not completed forward approval. ${gene.mathematicalFormula}`
                : `[PAPER ONLY — FORWARD EVIDENCE GATE PASSED; NO BROKER EXECUTION] ${gene.mathematicalFormula} | ${gene.whyHumansMissThis}`,
              });
            } catch (error: any) {
              const message = error?.message || String(error);
              if (pairDiagnostic) {
                pairDiagnostic.result = 'SIGNAL_CREATION_REJECTED';
                pairDiagnostic.signalCreationError = message;
              }
              this.logMind('AUDITOR', `Signal factory rejected ${symbol} ${gene.name}: ${message}`, symbol);
              continue;
            }

            createdSignals.push(signal);
            activeSymbols.add(symbol);
            if (pairDiagnostic) pairDiagnostic.signalPersisted = true;

            this.logMind(
              'SCIENTIST',
              `🧬 [EVOLVED SYMBOLIC STRATEGY SIGNAL]: ${symbol} ${signal.direction} [${gene.name} · Dynamic Expiry: ${gene.optimalHorizonMinutes}m · Formula: ${gene.mathematicalFormula} · ${gene.verifiedAccuracy}% historical test WR (n=${gene.sampleCount}). ${gene.status === 'PAPER_TRADING' ? 'PAPER TRADING' : 'FORWARD PAPER GATE PASSED · PAPER ONLY'}. Enters strictly at ${ENTRY_CANDLE_TIMEFRAME_MINUTES}M Candle Open (${signal.candleOpenTimeIst}); expires after ${gene.optimalHorizonMinutes}m.`,
              symbol,
              signal.id
            );
            if (pairDiagnostic) pairDiagnostic.result = 'SIGNAL_CREATED';
            break; // Single high-conviction signal per pulse
          }

          if (pairDiagnostic && pairDiagnostic.result === 'FRESH_FEED_READY') {
            pairDiagnostic.result = memoryVetoed
              ? 'EPISODIC_MEMORY_VETO'
              : regimeRejected && !strategyEvaluated
                ? 'REGIME_GATE_REJECTED'
                : strategyEvaluated
                  ? 'NO_STRATEGY_TRIGGER'
                  : 'NO_ELIGIBLE_STRATEGY_TRIGGER';
          }

          // No hand-written fallback is permitted. If no evolved, historically
          // qualified genome triggers, the system abstains for this pair/window.

        }
      }

      if (currentActive.length + createdSignals.length >= 4) {
        for (const diagnostic of pairDiagnostics) {
          if (diagnostic.result === 'FRESH_FEED_READY') diagnostic.result = 'GLOBAL_OPEN_SIGNAL_CAP_REACHED';
        }
      }

      // The scheduler does not repeatedly inspect a fixed historical holdout.
      // Only the one-time 300-candidate, validation-ranked research batch may
      // open a pair's final test interval. Online paper outcomes continue to
      // update posterior beliefs and episodic memory on every settled signal.
      const experimentsRun: ResearchExperiment[] = [];
      const topExp: ResearchExperiment | null = null;

      const durationMs = Date.now() - startTime;
      this.lastPairDiagnostics = pairDiagnostics;
      this.lastPulseCompletedAt = new Date().toISOString();
      this.lastPulseResult = {
        durationMs,
        pairsProcessed: pairDiagnostics.filter(item => item.freshFeed).length,
        signalsCreated: createdSignals.length,
        signalsUpdated: updatedSignals.length,
      };
      db.logCronRun(
        durationMs,
        'SUCCESS',
        `Autopilot pulse #${this.cycleCount} executed in ${durationMs}ms. ${createdSignals.length} signals generated, ${updatedSignals.length} active updated.`
      );

      return {
        durationMs,
        pairsProcessed: pairDiagnostics.filter(item => item.freshFeed).length,
        signalsCreated: createdSignals.length,
        signalsUpdated: updatedSignals.length,
        experimentsRun: experimentsRun.length,
        topExperiment: topExp,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      this.lastPulseError = err.message || String(err);
      this.lastPulseCompletedAt = new Date().toISOString();
      this.lastPulseResult = { durationMs, pairsProcessed: 0, signalsCreated: 0, signalsUpdated: 0 };
      db.logCronRun(durationMs, 'ERROR', `Autopilot pulse error: ${err.message}`);
      return {
        durationMs,
        pairsProcessed: 0,
        signalsCreated: 0,
        signalsUpdated: 0,
        experimentsRun: 0,
        topExperiment: null,
      };
    } finally {
      this.isRunningCycle = false;
    }
  }

  // Alias for manual triggers to maintain backwards compatibility
  public executeFullResearchCycle(triggerSource: string = 'MANUAL') {
    return this.executeAutopilotPulse(triggerSource);
  }
}

export const autonomousScheduler = new AutonomousScheduler();
