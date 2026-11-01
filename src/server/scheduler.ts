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
import { dataFeedEngine, getSessionFromTimestamp } from './dataFeeds.js';
import { db } from './db.js';
import { entryExitEngine } from './entryExitEngine.js';
import { researchEngine } from './researchEngine.js';
import { historicalDataStore } from './historicalData.js';
import {
  classifyMarketRegime,
  inferGenomeStyle,
  isStrategyRegimeCompatible,
} from './evolutionEngine.js';
import { findEligibleStartTimeframes } from './tradingClock.js';

export class AutonomousScheduler {
  private isRunningCycle = false;
  private autopilotTimer: NodeJS.Timeout | null = null;
  private autopilotIntervalMs = 20 * 1000; // Poll configured pairs every 20 seconds
  private currentGeneration = 1;
  private cycleCount = 0;

  constructor() {
    const existingGens = db.getGenerations();
    if (existingGens.length > 0) {
      this.currentGeneration = existingGens[0].generation + 1;
    }
  }

  public start() {
    if (this.autopilotTimer) return;
    console.log('[Autopilot] Starting SignalForge scheduled signal and research coordinator...');

    this.logMind(
      'MIND',
      `Research coordinator online. 20-second pulse across ${FOREX_PAIRS.length} configured currency pairs.`
    );

    // Initial warm pulse immediately
    setTimeout(() => {
      this.executeAutopilotPulse('WARMUP');
    }, 1500);

    // Continuous autonomous pulse every 20 seconds
    this.autopilotTimer = setInterval(() => {
      this.executeAutopilotPulse('AUTONOMOUS_PULSE');
    }, this.autopilotIntervalMs);
  }

  public stop() {
    if (this.autopilotTimer) {
      clearInterval(this.autopilotTimer);
      this.autopilotTimer = null;
      this.logMind('MIND', 'Autopilot pulse paused.');
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

              const { autopsy, antidoteGene } = researchEngine.conductForensicLossAutopsy(sig, lastCandle);
              sig.lossAutopsy = autopsy;
              db.addLossAutopsy(autopsy);
              db.updateSignal(sig);

              this.logMind(
                'AUDITOR',
                `🔬 [FORENSIC LOSS AUTOPSY & SELF-CORRECTION]: Investigated loss on ${sig.symbol} (${sig.direction}). Root Cause: ${autopsy.rootCause}. Lesson: ${autopsy.lessonsLearned[0]}. Autonomously Evolved Antidote: ${antidoteGene.name} (${antidoteGene.mathematicalFormula}) [UNVALIDATED — not eligible for live strategy promotion].`,
                sig.symbol,
                sig.id
              );
            } else {
              this.logMind(
                'EXECUTION',
                `Position closed for ${sig.symbol} ${sig.direction} at ${sig.actualExitPrice}. Net: ${
                  sig.netReturnPips! > 0 ? '+' : ''
                }${sig.netReturnPips} pips (${sig.outcomeResult}). Recorded as a forward paper observation ${tradeExp.id}.`,
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
          const eligibleSchedules = findEligibleStartTimeframes(nowMs, c.timestampMs + 60_000);
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
            if (evalResult.shouldTrigger && evalResult.conviction >= 0.80) {
              const memoryAssessment = db.assessEpisodicMemory({
                symbol,
                direction: evalResult.direction,
                ruleFamily: 'volatility_squeeze',
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
              confluenceStrategies: [gene.name, ...gene.parents, `${gene.nonLinearOperator} Activation`],
              confluenceScore: gene.parents.length + 1,
              isStackedStrategy: true,
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
              `🧬 [EVOLVED SYMBOLIC STRATEGY SIGNAL]: ${symbol} ${signal.direction} [${gene.name} · Dynamic Expiry: ${gene.optimalHorizonMinutes}m · Formula: ${gene.mathematicalFormula} · ${gene.verifiedAccuracy}% historical test WR (n=${gene.sampleCount}). ${gene.status === 'PAPER_TRADING' ? 'PAPER TRADING' : 'FORWARD APPROVED'}. Enters strictly at ${gene.optimalHorizonMinutes}M Candle Open (${signal.candleOpenTimeIst}).`,
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
