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

      // 3. Autonomous Setup Discovery: exact 3-minute advance on 5–30m entry candles
      // HUMAN STRICT RULE: Signals must ONLY be generated strictly within the 3-minute advance window!
      // A 5-minute advance signal is dangerous to accuracy because the setup candle has barely formed.
      // At 3 minutes advance (:32, :37, :42, etc.), 2 full minutes of candle volume and price discovery
      // have settled, providing maximum mathematical conviction.
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
          const range = Math.max(0.00008, c.high - c.low);
          const body = Math.abs(c.close - c.open);
          const bodyRatio = body / range;
          const upperWick = c.high - Math.max(c.open, c.close);
          const lowerWick = Math.min(c.open, c.close) - c.low;
          const isJpy = symbol.includes('JPY');
          const pipScale = isJpy ? 0.01 : 0.0001;

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

          const lastEma9 = ema9[ema9.length - 1];
          const lastEma21 = ema21[ema21.length - 1];
          const prevEma9 = ema9[ema9.length - 2] || lastEma9;
          const prevEma21 = ema21[ema21.length - 2] || lastEma21;
          const lastRsi = rsi14[rsi14.length - 1] || 50;

          // 20-period Moving Average and Extremes
          const recent20 = candles.slice(-20);
          const sma20 = recent20.reduce((acc, k) => acc + k.close, 0) / 20;
          const deviationPips = (c.close - sma20) / pipScale;
          const high20 = Math.max(...candles.slice(-20, -1).map(k => k.high));
          const low20 = Math.min(...candles.slice(-20, -1).map(k => k.low));

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
              paperOnly: gene.status !== 'PROMOTED_ACTIVE',
              marketFeatureVector,
              notes: gene.status !== 'PROMOTED_ACTIVE'
                ? `[PAPER ONLY — NOT APPROVED FOR ACTIONABLE TRADING] Forward validation sample. ${gene.mathematicalFormula}`
                : `[APPROVED AFTER 300 HISTORICAL + 300 FORWARD OUTCOMES]: ${gene.mathematicalFormula} | Edge: ${gene.whyHumansMissThis}`,
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

          // -------------------------------------------------------------
          // Multi-Strategy Stacking: Detect Bullish vs Bearish Confluence
          // Stack technical confluences to form a research signal. Historical and live
          // outcome performance are measured separately; confluence count is not a win rate.
          // -------------------------------------------------------------
          const buyConfluences: string[] = [];
          const sellConfluences: string[] = [];

          // 1. Momentum / EMA Alignment
          if (lastEma9 > lastEma21 && (c.close > c.open || lastEma9 - lastEma21 > prevEma9 - prevEma21)) {
            buyConfluences.push('EMA 9/21 Trend Breakout');
          }
          if (lastEma9 < lastEma21 && (c.close < c.open || lastEma21 - lastEma9 > prevEma21 - prevEma9)) {
            sellConfluences.push('EMA 9/21 Trend Breakdown');
          }

          // 2. Liquidity Wick Rejection
          if (lowerWick / range > 0.42) {
            buyConfluences.push(`Liquidity Wick Sweep (${((lowerWick / range) * 100).toFixed(0)}%)`);
          }
          if (upperWick / range > 0.42) {
            sellConfluences.push(`Liquidity Wick Sweep (${((upperWick / range) * 100).toFixed(0)}%)`);
          }

          // 3. Statistical Mean Reversion
          if (deviationPips < -5.5) {
            buyConfluences.push(`Mean Reversion (-${Math.abs(deviationPips).toFixed(1)} Pips)`);
          }
          if (deviationPips > 5.5) {
            sellConfluences.push(`Mean Reversion (+${deviationPips.toFixed(1)} Pips)`);
          }

          // 4. RSI Extremes
          if (lastRsi < 36) {
            buyConfluences.push(`RSI Oversold (${lastRsi})`);
          }
          if (lastRsi > 64) {
            sellConfluences.push(`RSI Overbought (${lastRsi})`);
          }

          // 5. Volatility Breakout
          if (c.close >= high20 || (bodyRatio > 0.60 && c.close > c.open)) {
            buyConfluences.push('20-Bar High Expansion');
          }
          if (c.close <= low20 || (bodyRatio > 0.60 && c.close < c.open)) {
            sellConfluences.push('20-Bar Low Expansion');
          }

          // 6. Session Alignment
          if (activeSession.id === 'OVERLAP' || activeSession.id === 'LONDON') {
            if (buyConfluences.length >= 1) buyConfluences.push(`${activeSession.shortName} Volume Flow`);
            if (sellConfluences.length >= 1) sellConfluences.push(`${activeSession.shortName} Volume Flow`);
          }

          // Select candidate setup ONLY IF Confluence Score >= 2 (Strict Stacking Requirement)
          let candidate: {
            direction: 'BUY' | 'SELL';
            confluence: string[];
            confluenceScore: number;
          } | null = null;

          if (buyConfluences.length >= 2 && buyConfluences.length > sellConfluences.length) {
            candidate = {
              direction: 'BUY',
              confluence: buyConfluences,
              confluenceScore: buyConfluences.length,
            };
          } else if (sellConfluences.length >= 2 && sellConfluences.length > buyConfluences.length) {
            candidate = {
              direction: 'SELL',
              confluence: sellConfluences,
              confluenceScore: sellConfluences.length,
            };
          }

          if (candidate) {
            // Dynamically assign optimal expiry across 5m, 10m, 15m, 20m, 25m, 30m
            const dynamicExpiry: 5 | 10 | 15 | 20 | 25 | 30 = selectedEntryTimeframe;
            let ruleFamily = 'mean_reversion_20';
            let strategyName = '';

            const hasMomentum = candidate.confluence.some(item => item.includes('Trend') || item.includes('Expansion'));
            const hasWick = candidate.confluence.some(item => item.includes('Wick'));
            const hasMeanRev = candidate.confluence.some(item => item.includes('Mean Reversion'));
            const hasRsi = candidate.confluence.some(item => item.includes('RSI'));

            if (hasMomentum && !hasMeanRev && bodyRatio > 0.60) {
              // 5 Min: High-velocity momentum surge (Single candle expansion)
              ruleFamily = 'momentum_5';
              strategyName = `Stacked: 5-Min Momentum + ${hasWick ? 'Wick Rejection' : 'Volume Expansion'}`;
            } else if (hasWick && (hasMomentum || hasRsi)) {
              // 10 Min: Liquidity Wick Sweep + 2-Candle Retest
              ruleFamily = 'wick_reversal';
              strategyName = `Stacked: 10-Min Liquidity Wick + ${hasRsi ? 'RSI Reversal' : 'Trend Retest'}`;
            } else if (hasMeanRev && hasRsi) {
              // 15 Min: Statistical Mean Reversion + RSI Extreme Pullback
              ruleFamily = 'mean_reversion_20';
              strategyName = 'Stacked: 15-Min Mean Reversion + RSI Divergence';
            } else if (hasMomentum && candidate.confluence.some(item => item.includes('20-Bar'))) {
              // 20 Min: Volatility Range Breakout (4-candle expansion)
              ruleFamily = 'range_breakout';
              strategyName = 'Stacked: 20-Min Volatility Range Breakout';
            } else if (hasMeanRev && hasWick) {
              // 25 Min: Structural Swing Reversal (5-candle channel bounce)
              ruleFamily = 'volatility_squeeze';
              strategyName = 'Stacked: 25-Min Structural Swing Reversal';
            } else {
              // 30 Min: Macro Session Trend Continuation (6-candle session flow)
              ruleFamily = 'order_flow_imbalance';
              strategyName = `Stacked: 30-Min ${activeSession.shortName} Macro Trend Flow`;
            }

            // Deterministic signal-strength score from rule confluence; not a calibrated probability.
            const confidence = Number(
              Math.min(0.92, 0.77 + (candidate.confluenceScore - 2) * 0.05).toFixed(2)
            );

            const candidateStyle = (
              ruleFamily.includes('mean_reversion') ||
              ruleFamily.includes('wick_reversal') ||
              strategyName.toLowerCase().includes('swing reversal')
            ) ? 'MEAN_REVERSION' : 'TREND';
            const candidateRegimeGate = isStrategyRegimeCompatible(candidateStyle, regimeAssessment.regime);
            if (!candidateRegimeGate.allowed) {
              this.logMind(
                'AUDITOR',
                '[REGIME GATE] Suppressed ' + ruleFamily + ' setup for ' + symbol + ': ' +
                  candidateRegimeGate.reason + ' Regime=' + regimeAssessment.regime + '.',
                symbol
              );
              continue;
            }
            const candidateMemory = db.assessEpisodicMemory({
              symbol,
              direction: candidate.direction,
              ruleFamily,
              featureVector: marketFeatureVector,
              predictionTimeUtc: new Date().toISOString(),
            });
            if (candidateMemory.veto) {
              this.logMind(
                'AUDITOR',
                '[EPISODIC MEMORY VETO] ' + symbol + ' ' + candidate.direction +
                  ' ' + ruleFamily + ' suppressed by ' + candidateMemory.neighborsFound +
                  ' earlier similar outcomes; weighted EV=' +
                  candidateMemory.weightedExpectedReturnUnits?.toFixed(3) + ' stake units.',
                symbol
              );
              continue;
            }

            const signal = entryExitEngine.createResearchSignal({
              symbol,
              direction: candidate.direction,
              signalCandle: c,
              ruleFamily,
              expiryMinutes: dynamicExpiry,
              entryTimeframeMinutes: selectedEntryTimeframe,
              candleOpenTimeUtc: new Date(selectedSchedule.entryTimeMs).toISOString(),
              candleCloseTimeUtc: new Date(selectedSchedule.entryTimeMs + dynamicExpiry * 60_000).toISOString(),
              confidence,
              modelVersion: `v2.5-stacked-rules`,
              strategyName,
              strategyId: `stacked:${ruleFamily}:${dynamicExpiry}`,
              confluenceStrategies: candidate.confluence,
              confluenceScore: candidate.confluenceScore,
              isStackedStrategy: true,
              paperOnly: true,
              marketFeatureVector,
              notes: `[PAPER ONLY — NOT APPROVED FOR ACTIONABLE TRADING] Confluence: [${candidate.confluence.join(' · ')}]. Dynamic ${dynamicExpiry}m entry candle and expiry strictly aligned (${activeSession.name}).`,
            });

            createdSignals.push(signal);
            activeSymbols.add(symbol);

            this.logMind(
              'SCIENTIST',
              `3-Min Advance Stacked Signal: ${symbol} ${candidate.direction} [${strategyName} · Entry Candle: ${selectedEntryTimeframe}m · Expiry: ${dynamicExpiry}m · Confluence: ${candidate.confluenceScore} Models]. Enters strictly at ${selectedEntryTimeframe}M Candle Open (${signal.candleOpenTimeIst}).`,
              symbol,
              signal.id
            );
            break; // Single high-conviction setup per pulse to prevent burst clutter
          }
        }
      }

      // 4. Autonomous ML Walk-Forward Experimentation (every 3rd pulse)
      const experimentsRun: ResearchExperiment[] = [];
      let topExp: ResearchExperiment | null = null;

      if (this.cycleCount % 3 === 0) {
        const testPair: ForexSymbol =
          FOREX_PAIRS[this.cycleCount % FOREX_PAIRS.length];
        const testCandles = historicalDataStore.getCandles(testPair);

        if (testCandles.length >= 10_000 && testCandles.every(c => c.source !== 'synthetic')) {
          const rule: RuleFamily =
            this.cycleCount % 2 === 0 ? 'momentum_5' : 'mean_reversion_20';
          const horizon = (5 * ((this.cycleCount % 5) + 1));

          try {
            const exp = researchEngine.runWalkForwardExperiment(
              testPair,
              testCandles,
              rule,
              horizon,
              this.currentGeneration
            );
            await researchEngine.generateTrinityReviews(exp);
            experimentsRun.push(exp);
            topExp = exp;

            this.logMind(
              'AUDITOR',
              `Audited ${testPair} [${rule}] ${horizon}m walk-forward model. Test Acc: ${(
                exp.metrics.testAccuracy * 100
              ).toFixed(1)}%, Brier: ${exp.metrics.brierScore}, Verdict: ${exp.auditorVerdict}.`,
              testPair
            );
          } catch (e: any) {
            // Quiet skip
          }
        }
      }

      // Symbolic candidates are generated only through the dedicated 300-candidate
      // historical search API. Do not create random unvalidated genes every live pulse
      // or repeatedly backtest one candidate against the same imported dataset.

      // 5. Generational Evolution Synthesis (every 10 pulses)
      if (this.cycleCount % 10 === 0 && experimentsRun.length > 0) {
        const allExps = db.getExperiments().filter(e => e.experimentType !== 'LIVE_TRADE' && e.experimentType !== 'FORWARD_OBSERVATION').slice(0, 10);
        const accepted = allExps.filter(e => e.auditorVerdict === 'ACCEPTED').length;
        const rejected = allExps.filter(e => e.auditorVerdict === 'REJECTED').length;
        const bestF1 = allExps.length > 0
          ? Math.max(...allExps.map(e => e.metrics.f1Score))
          : 0;
        const latestExperiment = allExps[0] || null;

        const gen: EvolutionGeneration = {
          generation: this.currentGeneration,
          timestamp: new Date().toISOString(),
          totalExperiments: allExps.length,
          acceptedCount: accepted,
          rejectedCount: rejected,
          topExperimentId: latestExperiment?.id || null,
          bestF1Score: bestF1,
          summary: allExps.length > 0
            ? `Generation ${this.currentGeneration}: ${allExps.length} historical experiments reviewed; ${accepted} accepted, ${rejected} rejected. Best recorded F1: ${bestF1.toFixed(3)}.`
            : `Generation ${this.currentGeneration}: no eligible historical experiments were available; no performance conclusion recorded.`,
          lessonsLearned: latestExperiment
            ? [
                `Latest run: ${latestExperiment.symbol} ${latestExperiment.ruleFamily}, ${latestExperiment.horizonMinutes}m; test sample n=${latestExperiment.metrics.sampleSize}.`,
                `Out-of-sample EV ${latestExperiment.metrics.expectedValuePips.toFixed(2)} pips; PF ${latestExperiment.metrics.profitFactor.toFixed(2)} after modeled spread.`,
              ]
            : ['No empirical lesson recorded because no qualifying historical experiment was available.'],
        };
        db.addGeneration(gen);
        this.currentGeneration++;
        this.logMind(
          'MIND',
          `Autonomous research generation #${gen.generation} evolved. Best F1: ${bestF1.toFixed(3)}.`
        );
      }

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
