/**
 * SignalForge ML — Scheduled signal and research coordinator.
 * Collects market candles, manages causal signal lifecycles, validates candidates
 * on imported history, and records forward paper-trading outcomes.
 */

import {
  AutopilotLog,
  Candle,
  EvolutionGeneration,
  FOREX_PAIRS,
  ForexSymbol,
  ResearchExperiment,
  RuleFamily,
} from '../types/index.js';
import { dataFeedEngine } from './dataFeeds.js';
import { getForexMarketState, isForexMarketIntervalOpen, getSessionFromTimestamp } from './marketHours.js';
import { db } from './db.js';
import { entryExitEngine } from './entryExitEngine.js';
import { researchEngine } from './researchEngine.js';
import { historicalDataStore } from './historicalData.js';
import {
  classifyMarketRegime,
  inferGenomeStyle,
  inferGenomeRuleFamily,
  isStrategyRegimeCompatible,
} from './evolutionEngine.js';
import { findEligibleStartTimeframes } from './tradingClock.js';

export class AutonomousScheduler {
  private isRunningCycle = false;
  private autopilotTimer: NodeJS.Timeout | null = null;
  private autopilotWarmupTimer: NodeJS.Timeout | null = null;
  private autopilotIntervalMs = 20 * 1000; // Market sensing only; never run genetic search on this pulse.
  private researchTimer: NodeJS.Timeout | null = null;
  private researchWarmupTimer: NodeJS.Timeout | null = null;
  private researchIntervalMs = 15 * 60 * 1000; // One bounded check every fifteen minutes.
  private researchCoordinatorRunning = false;
  private nextResearchPairIndex = 0;
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

  constructor() {
    const existingGens = db.getGenerations();
    if (existingGens.length > 0) {
      this.currentGeneration = existingGens[0].generation + 1;
    }
  }

  public start() {
    if (this.autopilotTimer || this.researchTimer) return;
    console.log('[Autopilot] Starting SignalForge scheduled signal and research coordinator...');

    this.logMind(
      'MIND',
      `Research coordinator online. Market sensing runs every 20 seconds; evolutionary research checks imported history every 15 minutes.`
    );

    this.autopilotWarmupTimer = setTimeout(() => {
      this.autopilotWarmupTimer = null;
      void this.executeAutopilotPulse('WARMUP');
    }, 1500);

    this.autopilotTimer = setInterval(() => {
      void this.executeAutopilotPulse('AUTONOMOUS_PULSE');
    }, this.autopilotIntervalMs);

    // Heavy 300-candidate searches are deliberately isolated from the 20s signal loop.
    this.researchWarmupTimer = setTimeout(() => {
      this.researchWarmupTimer = null;
      void this.checkAutonomousEvolutionResearch();
    }, 90_000);
    this.researchTimer = setInterval(() => {
      void this.checkAutonomousEvolutionResearch();
    }, this.researchIntervalMs);
    this.nextResearchScanAt = new Date(Date.now() + 90_000).toISOString();
    this.researchState = {
      ...this.researchState,
      status: 'SCANNING',
      checkedAt: new Date().toISOString(),
      nextScanAt: this.nextResearchScanAt,
      message: 'Waiting for the first bounded imported-history eligibility scan.',
    };
  }

  public stop() {
    if (this.autopilotWarmupTimer) {
      clearTimeout(this.autopilotWarmupTimer);
      this.autopilotWarmupTimer = null;
    }
    if (this.autopilotTimer) {
      clearInterval(this.autopilotTimer);
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

  public getEvolutionResearchState() {
    return {
      ...this.researchState,
      nextScanAt: this.nextResearchScanAt,
      batchRunning: this.researchCoordinatorRunning || researchEngine.isEvolutionBatchRunning(),
      scanIntervalMinutes: this.researchIntervalMs / 60_000,
      marketPulseSeconds: this.autopilotIntervalMs / 1000,
      requiredNewM1Candles: 60_000,
      historyWindowLimit: 120_000,
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
    this.nextResearchScanAt = new Date(Date.now() + this.researchIntervalMs).toISOString();
    let anyHistory = false;
    let hasPriorHoldout = false;

    try {
      this.researchState = {
        ...this.researchState,
        status: 'SCANNING',
        checkedAt,
        nextScanAt: this.nextResearchScanAt,
        message: 'Checking imported M1 history and unused chronological windows. No synthetic candles are eligible.',
        error: undefined,
      };

      let selected: { symbol: ForexSymbol; candles: Candle[] } | null = null;
      for (let offset = 0; offset < FOREX_PAIRS.length; offset++) {
        const index = (this.nextResearchPairIndex + offset) % FOREX_PAIRS.length;
        const symbol = FOREX_PAIRS[index];
        const candles = historicalDataStore.getLatestCandles(symbol, 120_000);
        if (candles.length > 0) anyHistory = true;
        if (candles.length < 60_000) continue;

        const previousHoldoutEndMs = db.getLatestResearchHoldoutEndMs(symbol);
        if (previousHoldoutEndMs !== null) {
          hasPriorHoldout = true;
          const genuinelyNewBars = candles.filter(candle =>
            candle.timestampMs >= previousHoldoutEndMs - 5_000
          ).length;
          if (genuinelyNewBars < 60_000) continue;
        }

        selected = { symbol, candles };
        this.nextResearchPairIndex = (index + 1) % FOREX_PAIRS.length;
        break;
      }

      if (!selected) {
        const status = !anyHistory ? 'WAITING_FOR_HISTORY' : 'WAITING_FOR_NEW_HISTORY';
        const message = !anyHistory
          ? 'No imported M1 history is available. Import at least 60,000 genuine one-minute candles for a pair.'
          : hasPriorHoldout
            ? 'Existing pairs have already used their current holdout. Another batch waits for 60,000 genuinely newer M1 candles; previous test windows are never recycled.'
            : 'Imported histories are below the 60,000-candle research minimum. No undersampled search was started.';
        this.researchState = {
          ...this.researchState,
          status,
          checkedAt,
          nextScanAt: this.nextResearchScanAt,
          completedCandidates: 0,
          historicalPasses: 0,
          rejected: 0,
          finalists: 0,
          message,
        };
        return;
      }

      const { symbol, candles } = selected;
      const latestCandidateGeneration = db.getSynthesizedStrategies().reduce(
        (maximum, gene) => Math.max(maximum, gene.generation || 0),
        0
      );
      const latestBatchGeneration = db.getGenerations().reduce(
        (maximum, generation) => Math.max(maximum, generation.generation || 0),
        0
      );
      const batchGeneration = Math.max(latestCandidateGeneration, latestBatchGeneration, this.currentGeneration - 1) + 1;
      const batchId = `autonomous_${symbol.replace('/', '')}_${Date.now().toString(36)}`;
      const startedAt = new Date().toISOString();
      this.researchState = {
        status: 'RUNNING',
        symbol,
        batchId,
        startedAt,
        checkedAt,
        nextScanAt: this.nextResearchScanAt,
        completedCandidates: 0,
        totalCandidates: 300,
        historicalPasses: 0,
        rejected: 0,
        finalists: 0,
        message: `Running 10 generations × 30 symbolic candidates for ${symbol}. Validation ranks the finalists; the reserved test window is opened only once.`,
      };
      this.logMind('SCIENTIST', `Autonomous evolutionary batch started for ${symbol}. 300 candidates across ten generations; only unused imported M1 history is eligible.`, symbol);

      try {
        const results = await researchEngine.runNovelStrategySearchBatch(
          symbol,
          candles,
          batchId,
          batchGeneration,
          progress => {
            this.researchState = {
              ...this.researchState,
              completedCandidates: progress.completed,
              historicalPasses: progress.passedHistorical,
              rejected: progress.rejected,
              finalists: progress.replicationFinalists,
              message: `Generation search ${progress.completed}/300. ${progress.passedHistorical} historical passes; ${progress.rejected} rejected; ${progress.replicationFinalists} pre-registered holdout finalists.`,
            };
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
          generation: batchGeneration,
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
          status: 'COMPLETED',
          symbol,
          bestValidationExpectedValueUnits: bestValidation?.discoveryMetrics?.validationExpectedValueUnits ?? 0,
          holdoutPeriod: consumedHoldout
            ? { start: consumedHoldout.startUtc, end: consumedHoldout.endUtc }
            : undefined,
        };
        db.addGeneration(batchRecord);
        db.saveStateSync();
        this.currentGeneration = batchGeneration + 10;
        this.researchState = {
          status: 'COMPLETED',
          symbol,
          batchId,
          startedAt,
          finishedAt,
          checkedAt,
          nextScanAt: this.nextResearchScanAt,
          completedCandidates: results.length,
          totalCandidates: 300,
          historicalPasses: passed,
          rejected,
          finalists: this.researchState.finalists,
          message: batchRecord.summary,
        };
        this.logMind('AUDITOR', batchRecord.summary, symbol);
      } catch (error: any) {
        const finishedAt = new Date().toISOString();
        const consumedHoldout = db.getResearchHoldoutWindow(batchId);
        const alreadyRecorded = db.getGenerations().some(record => record.researchBatchId === batchId);
        if (!alreadyRecorded) {
          const failedRecord: EvolutionGeneration = {
            generation: batchGeneration,
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
        this.researchState = {
          status: 'FAILED',
          symbol,
          batchId,
          startedAt,
          finishedAt,
          checkedAt,
          nextScanAt: this.nextResearchScanAt,
          completedCandidates: this.researchState.completedCandidates,
          totalCandidates: 300,
          historicalPasses: this.researchState.historicalPasses,
          rejected: this.researchState.rejected,
          finalists: this.researchState.finalists,
          message: 'The batch failed; no incomplete run was promoted.',
          error: error?.message || 'Unknown research failure',
        };
        this.logMind('AUDITOR', `Autonomous research batch failed for ${symbol}: ${error?.message || 'Unknown failure'}.`, symbol);
      }
    } catch (error: any) {
      this.researchState = {
        ...this.researchState,
        status: 'FAILED',
        checkedAt,
        nextScanAt: this.nextResearchScanAt,
        message: 'The autonomous research scan itself failed; the signal loop remains independent.',
        error: error?.message || 'Unknown scan failure',
      };
      this.logMind('AUDITOR', `Autonomous research scan failed: ${error?.message || 'Unknown failure'}.`);
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
    db.addAutopilotLog({
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
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
      return {
        durationMs: 0,
        pairsProcessed: 0,
        signalsCreated: 0,
        signalsUpdated: 0,
        experimentsRun: 0,
        topExperiment: null,
      };
    }

    if (this.isRunningCycle) {
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
      const candlesMap: Record<ForexSymbol, Candle[]> = {} as any;
      let totalCandlesFetched = 0;

      // 1. Autonomous Market Sensing across all 8 forex pairs
      for (const symbol of FOREX_PAIRS) {
        try {
          const res = await dataFeedEngine.fetchCandles(symbol, 100);
          const newest = res.candles[res.candles.length - 1];
          const ageMs = newest ? Date.now() - newest.timestampMs : Infinity;
          const isRealFreshFeed =
            res.source !== 'synthetic' &&
            !!newest &&
            newest.source !== 'synthetic' &&
            ['biquote', 'dukascopy', 'yahoo', 'imported'].includes(newest.source) &&
            ageMs >= -60_000 &&
            ageMs <= 120_000;
          // The feed bridge may append random synthetic candles. Never allow those
          // candles (or stale prices) into signal generation or execution evaluation.
          candlesMap[symbol] = isRealFreshFeed
            ? res.candles.filter(c => c.source !== 'synthetic')
            : [];
          totalCandlesFetched += candlesMap[symbol].length;
        } catch (err: any) {
          console.error(`[Autopilot] Sensing failed for ${symbol}:`, err.message);
        }
      }

      // 2. Step Causal Entry/Exit Engine for active trades
      const updatedSignals = entryExitEngine.evaluateSignals(candlesMap);
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
              const lastCandle = candlesMap[sig.symbol]?.[candlesMap[sig.symbol].length - 1] || ({
                close: sig.actualExitPrice || sig.actualEntryPrice || 0,
                high: sig.actualExitPrice || sig.actualEntryPrice || 0,
                low: sig.actualExitPrice || sig.actualEntryPrice || 0,
                open: sig.actualEntryPrice || 0,
                volume: 100,
                timestamp: new Date().toISOString(),
                timestampMs: Date.now(),
                source: 'dukascopy',
                symbol: sig.symbol,
              } as Candle);

              const autopsy = researchEngine.recordLossObservation(sig, lastCandle);
              sig.lossAutopsy = autopsy;
              db.addLossAutopsy(autopsy);
              db.updateSignal(sig);

              this.logMind(
                'AUDITOR',
                `[LOSS OBSERVATION RECORDED]: ${sig.symbol} ${sig.direction} settled as LOSS. No causal explanation or strategy was invented. The outcome was added to the genome's forward ledger, Bayesian posterior and episodic memory.`,
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
      // signal factory enforce exactly T-3m and matching 5–30m entry/expiry.
      const createdSignals: any[] = [];
      const currentActive = db.getActiveSignals();
      const activeSymbols = new Set(currentActive.map(s => s.symbol));
      const activeSession = getSessionFromTimestamp(new Date());

      const nowMs = Date.now();

      // Signals are emitted only from a fully closed M1 bar at T-3 minutes
      // for the selected 5/10/15/20/25/30-minute entry candle.
      if (currentActive.length + createdSignals.length < 4) {
        for (const symbol of FOREX_PAIRS) {
          if (currentActive.length + createdSignals.length >= 4) break;
          // Strict Pair Isolation: If this pair already has an active or pending signal, NEVER create another!
          if (activeSymbols.has(symbol)) {
            continue;
          }

          const candles = (candlesMap[symbol] || []).filter(candle =>
            candle.source !== 'synthetic' && candle.timestampMs + 60_000 <= nowMs
          );
          if (candles.length < 35) continue;

          const c = candles[candles.length - 1];
          const eligibleSchedules = findEligibleStartTimeframes(nowMs, c.timestampMs + 60_000)
            .filter(schedule => isForexMarketIntervalOpen(
              schedule.entryTimeMs,
              schedule.entryTimeMs + schedule.timeframeMinutes * 60_000
            ));
          if (eligibleSchedules.length === 0) continue;
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
          const promotedGenes = db.getPaperTradingStrategies().sort((a, b) =>
            Number(b.status === 'PROMOTED_ACTIVE') - Number(a.status === 'PROMOTED_ACTIVE') ||
            db.getStrategyBayesianUcbScore(b.id) - db.getStrategyBayesianUcbScore(a.id)
          );
          const eligibleTimeframeSet = new Set(eligibleSchedules.map(item => item.timeframeMinutes));
          const eligibleGene = promotedGenes.find(gene =>
            (!gene.symbol || gene.symbol === symbol) &&
            (gene.sessionAffinity === 'ALL' || gene.sessionAffinity === activeSession.id) &&
            eligibleTimeframeSet.has(gene.optimalHorizonMinutes)
          );
          const selectedEntryTimeframe = eligibleGene?.optimalHorizonMinutes ?? eligibleSchedules[0].timeframeMinutes;
          const selectedSchedule = eligibleSchedules.find(item =>
            item.timeframeMinutes === selectedEntryTimeframe
          );
          if (!selectedSchedule) continue;
          let novelGeneCandidate: {
            gene: typeof promotedGenes[0];
            direction: 'BUY' | 'SELL';
            conviction: number;
            rationale: string;
          } | null = null;

          for (const gene of promotedGenes) {
            // The train/test horizon and the live entry candle must be identical.
            if (gene.optimalHorizonMinutes !== selectedEntryTimeframe) continue;
            // Forward verification must use the same pair whose historical data
            // established the candidate's edge; never cross-apply a single-pair model.
            if (gene.symbol && gene.symbol !== symbol) continue;
            if (gene.sessionAffinity !== 'ALL' && gene.sessionAffinity !== activeSession.id) {
              continue;
            }
            const geneStyle = inferGenomeStyle(gene.genome?.expression);
            const regimeGate = isStrategyRegimeCompatible(geneStyle, regimeAssessment.regime);
            if (!regimeGate.allowed) {
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
              const memoryAssessment = db.assessEpisodicMemory({
                symbol,
                direction: evalResult.direction,
                ruleFamily: inferGenomeRuleFamily(gene.genome?.expression),
                featureVector: marketFeatureVector,
                predictionTimeUtc: new Date().toISOString(),
              });
              if (memoryAssessment.veto) {
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
            const signal = entryExitEngine.createResearchSignal({
              symbol,
              direction: novelGeneCandidate.direction,
              signalCandle: c,
              ruleFamily: 'volatility_squeeze',
              expiryMinutes: gene.optimalHorizonMinutes,
              entryTimeframeMinutes: gene.optimalHorizonMinutes,
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

            createdSignals.push(signal);
            activeSymbols.add(symbol);

            this.logMind(
              'SCIENTIST',
              `🧬 [EVOLVED SYMBOLIC STRATEGY SIGNAL]: ${symbol} ${signal.direction} [${gene.name} · Dynamic Expiry: ${gene.optimalHorizonMinutes}m · Formula: ${gene.mathematicalFormula} · ${gene.verifiedAccuracy}% historical test WR (n=${gene.sampleCount}). ${gene.status === 'PAPER_TRADING' ? 'PAPER TRADING' : 'FORWARD PAPER GATE PASSED · PAPER ONLY'}. Enters strictly at ${gene.optimalHorizonMinutes}M Candle Open (${signal.candleOpenTimeIst}).`,
              symbol,
              signal.id
            );
            break; // Single high-conviction signal per pulse
          }

          // No hand-written fallback is permitted. If no evolved, historically
          // qualified genome triggers, the system abstains for this pair/window.

        }
      }

      // The scheduler does not repeatedly inspect a fixed historical holdout.
      // Only the one-time 300-candidate, validation-ranked research batch may
      // open a pair's final test interval. Online paper outcomes continue to
      // update posterior beliefs and episodic memory on every settled signal.
      const experimentsRun: ResearchExperiment[] = [];
      const topExp: ResearchExperiment | null = null;

      const durationMs = Date.now() - startTime;
      db.logCronRun(
        durationMs,
        'SUCCESS',
        `Autopilot pulse #${this.cycleCount} executed in ${durationMs}ms. ${createdSignals.length} signals generated, ${updatedSignals.length} active updated.`
      );

      return {
        durationMs,
        pairsProcessed: Object.keys(candlesMap).length,
        signalsCreated: createdSignals.length,
        signalsUpdated: updatedSignals.length,
        experimentsRun: experimentsRun.length,
        topExperiment: topExp,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
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
