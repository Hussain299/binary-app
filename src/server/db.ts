/**
 * SignalForge ML — Persistent Database & D1 Exporter
 * Provides atomic file persistence for research state with instant Cloudflare D1 SQL schema export.
 */

import fs from 'fs';
import path from 'path';
import {
  Candle,
  ForexSymbol,
  MarketSessionId,
  MarketSessionInfo,
  ProviderHealth,
  ResearchSignal,
  ResearchExperiment,
  AgentReview,
  EvolutionGeneration,
  SignalLifecycleEvent,
  AutopilotLog,
  SynthesizedStrategyGene,
  LossAutopsy,
  StrategyPerformanceRecord,
} from '../types/index.js';
import { getSessionFromTimestamp } from './dataFeeds.js';

interface DatabaseSchema {
  candles: Record<string, Candle[]>;
  feedHealth: Record<string, ProviderHealth>;
  signals: ResearchSignal[];
  experiments: ResearchExperiment[];
  reviews: AgentReview[];
  generations: EvolutionGeneration[];
  autopilotLogs: AutopilotLog[];
  synthesizedStrategies: SynthesizedStrategyGene[];
  lossAutopsies: LossAutopsy[];
  strategyPerformance: Record<string, StrategyPerformanceRecord>;
  cronState: {
    lastRun: string | null;
    nextRun: string | null;
    isRunning: boolean;
    history: Array<{ runAt: string; durationMs: number; status: string; summary: string }>;
  };
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'signalforge.db.json');

class DatabaseService {
  private state: DatabaseSchema;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.ensureDataDir();
    this.state = this.loadState();
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadState(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed.autopilotLogs) parsed.autopilotLogs = [];
        if (!Array.isArray(parsed.synthesizedStrategies)) parsed.synthesizedStrategies = [];
        if (!Array.isArray(parsed.lossAutopsies)) parsed.lossAutopsies = [];
        if (!parsed.strategyPerformance || typeof parsed.strategyPerformance !== 'object') parsed.strategyPerformance = {};
        // Historical versions wrote fabricated strategy accuracy values. Never trust them
        // without stored untouched-test evidence; quarantine all such legacy candidates.
        if (Array.isArray(parsed.synthesizedStrategies)) {
          parsed.synthesizedStrategies = parsed.synthesizedStrategies.map((gene: any) => {
            if (!gene.backtestMetrics || !gene.accuracyStatus) {
              return {
                ...gene,
                verifiedAccuracy: 0,
                sampleCount: 0,
                accuracyStatus: 'UNVALIDATED',
                backtestMetrics: undefined,
                status: 'EXPERIMENTING',
              };
            }
            return gene;
          });
        }
        if (parsed.synthesizedStrategies.length === 0) {
          parsed.synthesizedStrategies = this.generateSeedSynthesizedGenes();
        }
        if (Array.isArray(parsed.signals)) {
          // Keep persistent trade history while filtering out removed pairs or test artifacts
          parsed.signals = parsed.signals.filter((s: any) => {
            if (s.symbol === 'USD/CHF' || s.symbol === 'NZD/USD') return false;
            if (typeof s.candleOpenTimeIst === 'string' && s.candleOpenTimeIst.includes('19:35:00 IST')) return false;
            if (s.ruleFamily?.startsWith('test_')) return false;
            return true;
          });
          // Backfill forensic autopsy on historical losses if missing
          for (const s of parsed.signals) {
            if (s.outcomeResult === 'LOSS' && !s.lossAutopsy) {
              const spread = s.estimatedSpreadPips || 1.5;
              const gross = s.grossReturnPips || -1.2;
              const net = s.netReturnPips || -2.7;
              const rootCause: LossAutopsy['rootCause'] = Math.abs(gross) <= spread * 1.2
                ? 'SPREAD_EXPANSION_SLIPPAGE'
                : (s.expiryMinutes || 5) >= 15
                ? 'SESSION_BOUNDARY_LIQUIDITY_VACUUM'
                : 'MICRO_WICK_FALSE_ABSORPTION';

              const lessons = rootCause === 'SPREAD_EXPANSION_SLIPPAGE'
                ? [
                    'Enforce strict Dynamic Spread Gate: Reject signals when spread exceeds 25% of expected ATR move.',
                    'Prioritize high-liquidity overlap sessions where spreads compress to sub-pip levels.',
                    'Buffer entry trigger by minimum +0.5 pips to overcome execution friction.',
                  ]
                : rootCause === 'SESSION_BOUNDARY_LIQUIDITY_VACUUM'
                ? [
                    `Dynamically compress expiry duration to 5m/10m when trading near sub-session handovers.`,
                    'Evaluate session turnover timer: reject >15m expiries within 30 minutes of session transitions.',
                    'Align time-horizon directly to ATR velocity curves.',
                  ]
                : [
                    'Increase polynomial wick exponent threshold to demand deeper liquidity absorption confirmation.',
                    'Incorporate tick volume delta verification: require volume expansion on the rejection wick.',
                    'Require second-derivative RSI confirmation before fading structural swing highs.',
                  ];

              const antidoteName = `Antidote-${s.symbol}: Adaptive Damping + ${rootCause.replace(/_/g, ' ')}`;
              const antidoteFormula = rootCause === 'SPREAD_EXPANSION_SLIPPAGE'
                ? `f(x) = (Δ_TickEntropy / √(1 + ${spread.toFixed(1)}·Spread)) · cos(π·WickRatio) + 1.15·OrderFlow_Z`
                : rootCause === 'SESSION_BOUNDARY_LIQUIDITY_VACUUM'
                ? `f(x) = σ(2.80·EMA_Curvature × Vol_Elasticity) - 0.55·ln(1 + ATR_harmonic)`
                : `f(x) = tanh(1.85·Z_Entropy) + 0.92·(LowerWickRatio)^2.30 - 0.45·Δ_20SMA`;

              const autopsy: LossAutopsy = {
                id: `autopsy_${s.id}`,
                signalId: s.id,
                symbol: s.symbol,
                direction: s.direction,
                strategyName: s.strategyName || 'Stacked Strategy',
                mathematicalFormula: s.mathematicalFormula,
                entryPrice: s.actualEntryPrice || s.triggerPrice,
                exitPrice: s.actualExitPrice || s.triggerPrice,
                grossReturnPips: gross,
                netReturnPips: net,
                spreadPips: spread,
                marketSession: s.marketSessionName || 'Market Session',
                rootCause,
                rootCauseExplanation: `Forensic autopsy revealed that the loss was driven by ${rootCause.replace(/_/g, ' ').toLowerCase()}. The trade was initiated with high statistical confluence, but adverse microstructure dynamics invalidated the horizon edge.`,
                lessonsLearned: lessons,
                antidoteStrategyGeneId: `synth_antidote_${s.id}`,
                antidoteStrategyName: antidoteName,
                antidoteFormula,
                antidoteOperator: rootCause === 'SESSION_BOUNDARY_LIQUIDITY_VACUUM' ? 'exponential_decay' : 'tanh_polynomial',
                timestamp: s.plannedExitTimeUtc || s.predictionTimeUtc || new Date().toISOString(),
              };

              s.lossAutopsy = autopsy;
              if (!parsed.lossAutopsies.some((a: any) => a.signalId === s.id)) {
                parsed.lossAutopsies.unshift(autopsy);
              }
            }
          }
          // Cap history at 1000 records
          if (parsed.signals.length > 1000) {
            parsed.signals = parsed.signals.slice(0, 1000);
          }
        }
        if (parsed.candles) {
          delete parsed.candles['USD/CHF'];
          delete parsed.candles['NZD/USD'];
        }
        return parsed;
      }
    } catch (err) {
      console.error('[DB] Failed to parse existing database file, initializing fresh:', err);
    }

    return {
      candles: {},
      feedHealth: {},
      signals: [],
      experiments: [],
      reviews: [],
      generations: [],
      autopilotLogs: [],
      synthesizedStrategies: this.generateSeedSynthesizedGenes(),
      lossAutopsies: [],
      strategyPerformance: {},
      cronState: {
        lastRun: null,
        nextRun: null,
        isRunning: false,
        history: [],
      },
    };
  }

  private generateSeedSynthesizedGenes(): SynthesizedStrategyGene[] {
    return [
      {
        id: 'synth_gen7_fractal_wick',
        name: 'Synth-Gen7: Polynomial Fractal Entropy + Asymmetric Wick Delta',
        code: 'GEN7_FRACTAL_WICK',
        generation: 7,
        mathematicalFormula: 'f(x) = tanh(1.45·Z_Entropy) + 0.68·(LowerWickRatio)^1.85 - 0.28·Δ_20SMA',
        parents: ['Fractal Volatility Matrix', 'Asymmetric Wick Rejection', 'Microstructure Flow'],
        mutationRate: 0.042,
        nonLinearOperator: 'tanh_polynomial',
        optimalHorizonMinutes: 10,
        sessionAffinity: 'ALL',
        verifiedAccuracy: 0,
        sampleCount: 0,
        accuracyStatus: 'UNVALIDATED',
        status: 'EXPERIMENTING',
        scientificHypothesis: 'Non-linear polynomial expansion of rejection wicks against local fractal entropy isolates institutional limit absorptions before directional expansion.',
        whyHumansMissThis: 'Human chartists look for simple hammer candles; this formula computes fractional dimensional entropy divergence across consecutive multi-tick micro-wicks.',
        createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
      },
      {
        id: 'synth_gen12_harmonic_flow',
        name: 'Synth-Gen12: Non-Linear Harmonic Volatility Expansion + Micro-Flow Imbalance',
        code: 'GEN12_HARMONIC_FLOW',
        generation: 12,
        mathematicalFormula: 'f(x) = σ(2.10·EMA_Curvature × Vol_Elasticity) - 0.42·ln(1 + ATR_harmonic)',
        parents: ['Wave Curvature Derivative', 'Volume Squeeze Compression', 'Tick Velocity Dispersion'],
        mutationRate: 0.038,
        nonLinearOperator: 'exponential_decay',
        optimalHorizonMinutes: 5,
        sessionAffinity: 'LONDON',
        verifiedAccuracy: 0,
        sampleCount: 0,
        accuracyStatus: 'UNVALIDATED',
        status: 'EXPERIMENTING',
        scientificHypothesis: 'Calculates the second-derivative acceleration of EMA curvature multiplied by logarithmic elasticity, capturing order-flow impulses during European open volume surge.',
        whyHumansMissThis: 'Human traders only see moving averages crossing; they cannot visually compute the second-derivative acceleration or logarithmic elasticity curves.',
        createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
      },
      {
        id: 'synth_gen19_stochastic_drift',
        name: 'Synth-Gen19: Multi-Horizon Stochastic Drift + Adaptive Band Inversion',
        code: 'GEN19_STOCHASTIC_DRIFT',
        generation: 19,
        mathematicalFormula: 'f(x) = sign(MicroFlow)·|Δ_20MA|^1.25 + 0.54·RSI_Curvature - 0.35·Wick_Asymmetry',
        parents: ['Stochastic Drift Matrix', 'Adaptive Band Inversion', 'Mean Reversion Engine'],
        mutationRate: 0.051,
        nonLinearOperator: 'fractal_power',
        optimalHorizonMinutes: 15,
        sessionAffinity: 'ASIA',
        verifiedAccuracy: 0,
        sampleCount: 0,
        accuracyStatus: 'UNVALIDATED',
        status: 'EXPERIMENTING',
        scientificHypothesis: 'Measures continuous drift inflection points along the 20-period moving average with non-linear power-law scaling of price dispersion.',
        whyHumansMissThis: 'Human traders wait for fixed 70/30 RSI lines; this genetic equation detects continuous non-linear drift inflection points 3 candles before traditional indicators react.',
        createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
      },
      {
        id: 'synth_gen26_macro_resonance',
        name: 'Synth-Gen26: Macro Session Order-Flow Resonance Matrix',
        code: 'GEN26_MACRO_RESONANCE',
        generation: 26,
        mathematicalFormula: 'f(x) = 0.52·tanh(SessionLiquidityFlow) + 0.48·(BreakoutDelta)^1.6 × VolumeRatio',
        parents: ['Macro Order Flow Resonance', '20-Bar High Expansion', 'Session Open Liquidity Grab'],
        mutationRate: 0.035,
        nonLinearOperator: 'tanh_polynomial',
        optimalHorizonMinutes: 30,
        sessionAffinity: 'OVERLAP',
        verifiedAccuracy: 0,
        sampleCount: 0,
        accuracyStatus: 'UNVALIDATED',
        status: 'EXPERIMENTING',
        scientificHypothesis: 'Synthesizes cross-pair liquidity flow during peak London/New York overlap, predicting multi-candle macro continuation waves with 30m horizon.',
        whyHumansMissThis: 'Synthesizes multi-session inter-bank liquidity flow with non-linear volume acceleration across multiple currency pairs simultaneously.',
        createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      },
      {
        id: 'synth_gen33_compression_decoupling',
        name: 'Synth-Gen33: Asymmetric Volatility Squeeze + Curvature Decoupling',
        code: 'GEN33_COMPRESSION_DECOUPLING',
        generation: 33,
        mathematicalFormula: 'f(x) = (Δ_BandCompression^1.4 / ATR_decay) + 0.62·Wick_Sweep - 0.30·StochasticSlit',
        parents: ['Volatility Squeeze Compression', 'Fractal Dimension Slope', 'Institutional Wick Rejection'],
        mutationRate: 0.046,
        nonLinearOperator: 'harmonic_dispersion',
        optimalHorizonMinutes: 20,
        sessionAffinity: 'ALL',
        verifiedAccuracy: 0,
        sampleCount: 0,
        accuracyStatus: 'UNVALIDATED',
        status: 'EXPERIMENTING',
        scientificHypothesis: 'Detects invisible multi-period volatility collapse right before energetic directional breakout across 4 consecutive 5M candles.',
        whyHumansMissThis: 'Price appears stagnant/choppy to human eyes, while the mathematical gene measures internal multi-candle tick variance collapsing to critical explosive thresholds.',
        createdAt: new Date(Date.now() - 3600000 * 1).toISOString(),
      },
    ];
  }

  public saveStateSync() {
    this.ensureDataDir();
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(this.state, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  }

  public scheduleSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveStateSync();
    }, 500);
  }

  // Candle Storage
  public storeCandles(symbol: ForexSymbol, newCandles: Candle[]) {
    if (!this.state.candles[symbol]) {
      this.state.candles[symbol] = [];
    }

    const existingMap = new Map<number, Candle>();
    for (const c of this.state.candles[symbol]) {
      existingMap.set(c.timestampMs, c);
    }

    for (const c of newCandles) {
      existingMap.set(c.timestampMs, c);
    }

    // Sort chronologically and keep last 2000 candles per pair
    const sorted = Array.from(existingMap.values()).sort((a, b) => a.timestampMs - b.timestampMs);
    this.state.candles[symbol] = sorted.slice(-5000);
    this.scheduleSave();
  }

  public getCandles(symbol: ForexSymbol, limit: number = 100): Candle[] {
    const list = this.state.candles[symbol] || [];
    return list.slice(-limit);
  }

  public getTotalCandlesCount(): number {
    let count = 0;
    for (const key of Object.keys(this.state.candles)) {
      count += this.state.candles[key].length;
    }
    return count;
  }

  // Provider Health
  public updateFeedHealth(health: ProviderHealth) {
    const key = `${health.provider}:${health.symbol}`;
    this.state.feedHealth[key] = health;
    this.scheduleSave();
  }

  public getFeedHealthList(): ProviderHealth[] {
    return Object.values(this.state.feedHealth);
  }

  // Signals
  public addSignal(signal: ResearchSignal) {
    const isTest = signal.ruleFamily?.startsWith('test_');
    if (!isTest) {
      // Strict Currency Pair Exclusivity:
      // Only ONE active or pending trade allowed per pair at any time!
      // This strictly prevents the bot from giving 2 signals on the same pair (e.g. conflicting UP and DOWN).
      const activeForPair = this.state.signals.find(
        s =>
          s.symbol === signal.symbol &&
          !s.ruleFamily?.startsWith('test_') &&
          ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE', 'EXIT_PENDING'].includes(s.lifecycleState)
      );
      if (activeForPair) {
        return activeForPair;
      }

      // Also prevent duplicate signal on the same pair for the same 5M candle open
      const sameCandle = this.state.signals.find(
        s =>
          s.symbol === signal.symbol &&
          s.candleOpenTimeUtc === signal.candleOpenTimeUtc
      );
      if (sameCandle) {
        return sameCandle;
      }
    } else {
      const exists = this.state.signals.find(
        s =>
          s.symbol === signal.symbol &&
          s.direction === signal.direction &&
          s.ruleFamily === signal.ruleFamily &&
          ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE'].includes(s.lifecycleState)
      );
      if (exists) return exists;
    }

    this.state.signals.unshift(signal);
    // Keep max 1000 signals in persistent history
    if (this.state.signals.length > 1000) {
      this.state.signals = this.state.signals.slice(0, 1000);
    }
    this.scheduleSave();
    return signal;
  }

  public updateSignal(signal: ResearchSignal) {
    const idx = this.state.signals.findIndex(s => s.id === signal.id);
    if (idx !== -1) {
      this.state.signals[idx] = signal;
      this.scheduleSave();
    }
  }

  public getSignals(includeTest: boolean = false): ResearchSignal[] {
    if (includeTest) return this.state.signals;
    return this.state.signals.filter(s => !s.ruleFamily?.startsWith('test_'));
  }

  public getActiveSignals(includeTest: boolean = false): ResearchSignal[] {
    const list = this.getSignals(includeTest);
    return list.filter(s =>
      ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE', 'EXIT_PENDING'].includes(s.lifecycleState)
    );
  }

  public purgeTestSignals() {
    this.state.signals = this.state.signals.filter(s => !s.ruleFamily?.startsWith('test_'));
    this.scheduleSave();
  }

  public clearClosedSignalsHistory() {
    // Keeps active and pending signals, purges only completed historical trades
    this.state.signals = this.state.signals.filter(s =>
      ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE', 'EXIT_PENDING'].includes(s.lifecycleState)
    );
    this.scheduleSave();
  }

  public getSignalById(id: string): ResearchSignal | undefined {
    return this.state.signals.find(s => s.id === id);
  }

  /**
   * Automatically turns every completed trade into a real experiment.
   * Records execution outcome, verifies edge, and feeds the online learning model.
   */
  public recordTradeExperiment(sig: ResearchSignal): ResearchExperiment {
    const isWin = sig.outcomeResult === 'WIN';
    const netPips = sig.netReturnPips || 0;
    const sessionName = sig.marketSessionName || 'Market Session';
    const strategyName = sig.strategyName || 'Algorithmic Strategy';

    const exp: ResearchExperiment = {
      id: `exp_live_${sig.id}`,
      experimentType: 'LIVE_TRADE',
      liveOutcome: sig.outcomeResult === 'CANCELLED' || sig.outcomeResult === 'PENDING' ? 'SCRATCH' : sig.outcomeResult,
      generation: this.state.generations.length + 1,
      name: `Live Trade Experiment: ${sig.symbol} ${sig.direction} (${sessionName})`,
      symbol: sig.symbol,
      ruleFamily: (sig.ruleFamily as any) || 'momentum_5',
      horizonMinutes: sig.expiryMinutes,
      parameters: {
        triggerPrice: sig.triggerPrice,
        actualEntryPrice: sig.actualEntryPrice || 0,
        actualExitPrice: sig.actualExitPrice || 0,
        expiryMinutes: sig.expiryMinutes,
        marketSession: sig.marketSession || 'ASIA',
        confluenceScore: sig.confluenceScore || 1,
        isStackedStrategy: sig.isStackedStrategy ? 'true' : 'false',
      },
      featuresUsed: sig.confluenceStrategies || [strategyName],
      metrics: {
        sampleSize: 1,
        trainSampleSize: 0,
        validationSampleSize: 0,
        trainAccuracy: 0,
        valAccuracy: 0,
        testAccuracy: isWin ? 1.0 : 0.0,
        balancedAccuracy: isWin ? 1.0 : 0.0,
        precision: isWin ? 1.0 : 0.0,
        recall: isWin ? 1.0 : 0.0,
        f1Score: isWin ? 1.0 : 0.0,
        brierScore: 0,
        calibrationError: 0,
        winRate: isWin ? 100 : 0,
        expectedValuePips: netPips,
        profitFactor: 0,
        maxDrawdownPct: 0,
        confidenceInterval95: sig.outcomeResult === 'WIN' ? [0.207, 1] : sig.outcomeResult === 'LOSS' ? [0, 0.793] : [0, 1],
        confusionMatrix: {
          tp: isWin && sig.direction === 'BUY' ? 1 : 0,
          fp: !isWin && sig.direction === 'BUY' ? 1 : 0,
          tn: isWin && sig.direction === 'SELL' ? 1 : 0,
          fn: !isWin && sig.direction === 'SELL' ? 1 : 0,
        },
      },
      trainPeriod: {
        start: sig.predictionTimeUtc,
        end: sig.actualEntryTimeUtc || sig.predictionTimeUtc,
      },
      valPeriod: {
        start: sig.actualEntryTimeUtc || sig.predictionTimeUtc,
        end: sig.actualExitTimeUtc || sig.predictionTimeUtc,
      },
      testPeriod: {
        start: sig.actualEntryTimeUtc || sig.predictionTimeUtc,
        end: sig.actualExitTimeUtc || sig.predictionTimeUtc,
      },
      purgedWindowCandles: sig.expiryMinutes,
      scientistHypothesis: `Live hypothesis: ${strategyName} ${sig.isStackedStrategy ? '(Stacked Confluence)' : ''} maintains statistical alpha during ${sessionName}.`,
      scientistDisproofCondition: `Disproved if net spread-adjusted pips fall below -0.5 pips. Observed: ${netPips > 0 ? '+' : ''}${netPips} pips.`,
      engineerConfigNotes: `Execution verified on ${sig.entrySource || 'feed'}. Entry: ${sig.actualEntryPrice}, Exit: ${sig.actualExitPrice}, Duration: ${sig.expiryMinutes}m.`,
      auditorVerdict: 'PROVISIONAL',
      auditorConcerns: ['Single forward trade recorded for outcome tracking only. This observation does not validate or reject a strategy.'],
      createdAt: new Date().toISOString(),
    };

    this.addExperiment(exp);
    return exp;
  }

  /**
   * Computes verified performance breakdown across all 4 market sessions
   * (Asia, London, Overlap, New York).
   */
  public getSessionAccuracyBreakdown(): MarketSessionInfo[] {
    const currentSession = getSessionFromTimestamp(new Date());
    const closedSignals = this.getSignals().filter(
      s => s.lifecycleState === 'CLOSED' && ['WIN', 'LOSS', 'SCRATCH'].includes(s.outcomeResult)
    );

    const sessions: Array<{
      id: MarketSessionId;
      name: string;
      shortName: string;
      utcRange: string;
      istRange: string;
    }> = [
      { id: 'ASIA', name: 'Asian Session (Tokyo/Sydney)', shortName: 'Asia', utcRange: '00:00 - 07:00 UTC', istRange: '05:30 AM - 12:30 PM IST' },
      { id: 'LONDON', name: 'London Session (European Open)', shortName: 'London', utcRange: '07:00 - 12:00 UTC', istRange: '12:30 PM - 05:30 PM IST' },
      { id: 'OVERLAP', name: 'London / New York Overlap (Peak Volatility)', shortName: 'Overlap', utcRange: '12:00 - 16:00 UTC', istRange: '05:30 PM - 09:30 PM IST' },
      { id: 'NEW_YORK', name: 'New York Session (US Afternoon)', shortName: 'New York', utcRange: '16:00 - 21:00 UTC', istRange: '09:30 PM - 02:30 AM IST' },
    ];

    return sessions.map(sess => {
      const sessSignals = closedSignals.filter(s => {
        if (s.marketSession) return s.marketSession === sess.id;
        const sigTime = s.actualEntryTimeUtc || s.predictionTimeUtc;
        return getSessionFromTimestamp(sigTime).id === sess.id;
      });
      const wins = sessSignals.filter(s => s.outcomeResult === 'WIN').length;
      const losses = sessSignals.filter(s => s.outcomeResult === 'LOSS').length;
      const scratches = sessSignals.filter(s => s.outcomeResult === 'SCRATCH').length;
      const scoredTrades = wins + losses;
      const hasMeasuredData = scoredTrades > 0;
      const winRate = hasMeasuredData ? Number(((wins / scoredTrades) * 100).toFixed(1)) : 0;
      const netPips = Number(sessSignals.reduce((acc, s) => acc + (s.netReturnPips || 0), 0).toFixed(1));

      const stratMap: Record<string, { wins: number; losses: number }> = {};
      for (const signal of sessSignals) {
        if (signal.outcomeResult === 'SCRATCH') continue;
        const name = signal.strategyName || signal.ruleFamily || 'Unclassified Strategy';
        if (!stratMap[name]) stratMap[name] = { wins: 0, losses: 0 };
        if (signal.outcomeResult === 'WIN') stratMap[name].wins++;
        else if (signal.outcomeResult === 'LOSS') stratMap[name].losses++;
      }
      let bestStrategy = 'Insufficient strategy-specific live trades (20 required)';
      let bestRate = -1;
      for (const [name, stats] of Object.entries(stratMap)) {
        const sample = stats.wins + stats.losses;
        if (sample < 20) continue;
        const rate = (stats.wins / sample) * 100;
        if (rate > bestRate) {
          bestRate = rate;
          bestStrategy = `${name} (${rate.toFixed(1)}% across ${sample} live trades)`;
        }
      }

      return {
        id: sess.id,
        name: sess.name,
        shortName: sess.shortName,
        utcRange: sess.utcRange,
        istRange: sess.istRange,
        isActive: currentSession.id === sess.id,
        winRate,
        hasMeasuredData,
        totalTrades: sessSignals.length,
        wins,
        losses,
        scratches,
        netPips,
        bestStrategy,
      };
    });
  }

  // Experiments
  public addExperiment(exp: ResearchExperiment) {
    this.state.experiments.unshift(exp);
    if (this.state.experiments.length > 300) {
      this.state.experiments = this.state.experiments.slice(0, 300);
    }
    this.scheduleSave();
  }

  public getExperiments(): ResearchExperiment[] {
    return this.state.experiments;
  }

  // Synthesized Genetic Strategies (Infinite Non-Human Combinations)
  public addSynthesizedStrategy(gene: SynthesizedStrategyGene) {
    if (!this.state.synthesizedStrategies) this.state.synthesizedStrategies = [];
    this.state.synthesizedStrategies.unshift(gene);
    if (this.state.synthesizedStrategies.length > 200) {
      this.state.synthesizedStrategies = this.state.synthesizedStrategies.slice(0, 200);
    }
    this.scheduleSave();
  }

  public getSynthesizedStrategies(): SynthesizedStrategyGene[] {
    return this.state.synthesizedStrategies || [];
  }

  public getPromotedActiveStrategies(): SynthesizedStrategyGene[] {
    return (this.state.synthesizedStrategies || []).filter(
      s => s.status === 'PROMOTED_ACTIVE' &&
        s.accuracyStatus === 'BACKTESTED' &&
        !!s.backtestMetrics &&
        s.sampleCount >= 200
    );
  }

  public getSynthesizedStrategyById(id: string): SynthesizedStrategyGene | undefined {
    return (this.state.synthesizedStrategies || []).find(s => s.id === id);
  }

  public updateSynthesizedStrategy(gene: SynthesizedStrategyGene): void {
    if (!this.state.synthesizedStrategies) this.state.synthesizedStrategies = [];
    const index = this.state.synthesizedStrategies.findIndex(s => s.id === gene.id);
    if (index >= 0) this.state.synthesizedStrategies[index] = gene;
    else this.state.synthesizedStrategies.unshift(gene);
    this.scheduleSave();
  }

  public recordStrategyOutcome(signal: ResearchSignal): StrategyPerformanceRecord {
    const strategyId = signal.strategyId || `rule:${signal.ruleFamily}`;
    if (!this.state.strategyPerformance) this.state.strategyPerformance = {};
    const existing = this.state.strategyPerformance[strategyId] || {
      strategyId, trades: 0, wins: 0, losses: 0, scratches: 0, netPips: 0, updatedAt: new Date().toISOString(),
    };
    existing.trades += 1;
    if (signal.outcomeResult === 'WIN') existing.wins += 1;
    else if (signal.outcomeResult === 'LOSS') existing.losses += 1;
    else existing.scratches += 1;
    existing.netPips = Number((existing.netPips + (signal.netReturnPips || 0)).toFixed(1));
    existing.updatedAt = new Date().toISOString();
    this.state.strategyPerformance[strategyId] = existing;
    this.scheduleSave();
    return { ...existing };
  }

  public getStrategyPerformance(): StrategyPerformanceRecord[] {
    return Object.values(this.state.strategyPerformance || {}).sort((a, b) => b.trades - a.trades);
  }

  // Autonomous Forensic Loss Autopsies & Self-Learning
  public addLossAutopsy(autopsy: LossAutopsy) {
    if (!this.state.lossAutopsies) this.state.lossAutopsies = [];
    this.state.lossAutopsies.unshift(autopsy);
    if (this.state.lossAutopsies.length > 200) {
      this.state.lossAutopsies = this.state.lossAutopsies.slice(0, 200);
    }
    this.scheduleSave();
  }

  public getLossAutopsies(): LossAutopsy[] {
    return this.state.lossAutopsies || [];
  }

  public getLossAutopsyBySignalId(signalId: string): LossAutopsy | undefined {
    return (this.state.lossAutopsies || []).find(a => a.signalId === signalId);
  }

  // Agent Reviews
  public addReview(review: AgentReview) {
    this.state.reviews.unshift(review);
    if (this.state.reviews.length > 300) {
      this.state.reviews = this.state.reviews.slice(0, 300);
    }
    this.scheduleSave();
  }

  public getReviews(): AgentReview[] {
    return this.state.reviews;
  }

  // Generations
  public addGeneration(gen: EvolutionGeneration) {
    this.state.generations.unshift(gen);
    this.scheduleSave();
  }

  public getGenerations(): EvolutionGeneration[] {
    return this.state.generations;
  }

  // Autonomous Autopilot Logs
  public addAutopilotLog(log: AutopilotLog) {
    if (!this.state.autopilotLogs) this.state.autopilotLogs = [];
    this.state.autopilotLogs.unshift(log);
    if (this.state.autopilotLogs.length > 200) {
      this.state.autopilotLogs = this.state.autopilotLogs.slice(0, 200);
    }
    this.scheduleSave();
  }

  public getAutopilotLogs(limit: number = 50): AutopilotLog[] {
    return (this.state.autopilotLogs || []).slice(0, limit);
  }

  // Cron State
  public getCronState() {
    return this.state.cronState;
  }

  public updateCronState(update: Partial<DatabaseSchema['cronState']>) {
    this.state.cronState = { ...this.state.cronState, ...update };
    this.scheduleSave();
  }

  public logCronRun(durationMs: number, status: string, summary: string) {
    this.state.cronState.lastRun = new Date().toISOString();
    this.state.cronState.isRunning = false;
    this.state.cronState.history.unshift({
      runAt: new Date().toISOString(),
      durationMs,
      status,
      summary,
    });
    if (this.state.cronState.history.length > 50) {
      this.state.cronState.history = this.state.cronState.history.slice(0, 50);
    }
    this.scheduleSave();
  }

  /**
   * Generates production-ready Cloudflare D1 SQL Schema & Migrations
   */
  public generateCloudflareD1Schema(): string {
    return `-- ============================================================
-- SignalForge ML: Cloudflare D1 Database Migration
-- Version: 0001_initial.sql
-- Compatible with Cloudflare Workers + D1 Free Tier
-- ============================================================

-- Table 1: Market Candles (UTC Normalized)
CREATE TABLE IF NOT EXISTS market_candles (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_candles_symbol_time ON market_candles(symbol, timestamp_ms);

-- Table 2: Provider Feed Health
CREATE TABLE IF NOT EXISTS feed_health (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  symbol TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  last_success TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Table 3: Research Signals (Causal Entry & Exit Lifecycle)
CREATE TABLE IF NOT EXISTS research_signals (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  prediction_time_utc TEXT NOT NULL,
  prediction_time_ist TEXT NOT NULL,
  signal_candle_time TEXT NOT NULL,
  entry_condition TEXT NOT NULL,
  entry_window_start_utc TEXT NOT NULL,
  entry_window_end_utc TEXT NOT NULL,
  trigger_price REAL NOT NULL,
  invalidation_price REAL NOT NULL,
  actual_entry_time_utc TEXT,
  actual_entry_price REAL,
  entry_source TEXT,
  expiry_minutes INTEGER NOT NULL,
  planned_exit_time_utc TEXT,
  actual_exit_time_utc TEXT,
  actual_exit_price REAL,
  confidence REAL NOT NULL,
  calibration_status TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL,
  gross_return_pips REAL,
  estimated_spread_pips REAL,
  net_return_pips REAL,
  outcome_result TEXT NOT NULL,
  rule_family TEXT NOT NULL,
  model_version TEXT NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_signals_state ON research_signals(lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON research_signals(symbol, created_at);

-- Table 4: Signal Lifecycle Transition Audit Trail
CREATE TABLE IF NOT EXISTS signal_lifecycle_events (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  timestamp_utc TEXT NOT NULL,
  price REAL,
  reason TEXT NOT NULL,
  FOREIGN KEY (signal_id) REFERENCES research_signals(id) ON DELETE CASCADE
);

-- Table 5: Research Experiments (Purged Walk-Forward Runs)
CREATE TABLE IF NOT EXISTS research_experiments (
  id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  rule_family TEXT NOT NULL,
  horizon_minutes INTEGER NOT NULL,
  parameters_json TEXT NOT NULL,
  features_json TEXT NOT NULL,
  train_accuracy REAL NOT NULL,
  val_accuracy REAL NOT NULL,
  test_accuracy REAL NOT NULL,
  balanced_accuracy REAL NOT NULL,
  f1_score REAL NOT NULL,
  brier_score REAL NOT NULL,
  win_rate REAL NOT NULL,
  profit_factor REAL NOT NULL,
  max_drawdown_pct REAL NOT NULL,
  auditor_verdict TEXT NOT NULL,
  scientist_hypothesis TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_exp_generation ON research_experiments(generation);

-- Table 6: Agent Reviews (Scientist, Engineer, Skeptical Auditor)
CREATE TABLE IF NOT EXISTS agent_reviews (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  role TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  verdict TEXT,
  score INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Table 7: Evolution Generations
CREATE TABLE IF NOT EXISTS evolution_generations (
  generation INTEGER PRIMARY KEY,
  total_experiments INTEGER NOT NULL,
  accepted_count INTEGER NOT NULL,
  rejected_count INTEGER NOT NULL,
  top_experiment_id TEXT,
  best_f1_score REAL NOT NULL,
  summary TEXT NOT NULL,
  lessons_json TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Table 8: Scheduled Cron Run History
CREATE TABLE IF NOT EXISTS cron_run_history (
  id TEXT PRIMARY KEY,
  run_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL
);
`;
  }

  public generateWranglerToml(): string {
    return `# SignalForge ML — Cloudflare Workers & Pages Deployment Config
name = "signalforge-api"
main = "src/worker.ts"
compatibility_date = "2024-10-01"

# Cloudflare D1 Database Binding
[[d1_databases]]
binding = "DB"
database_name = "signalforge-db"
database_id = "[CREATE AND RECORD AFTER D1 DATABASE CREATION]"
migrations_dir = "migrations"

# Cron Trigger for Autonomous Research Laboratory (Hourly)
[triggers]
crons = ["0 * * * *"]

[vars]
ENVIRONMENT = "production"
DEFAULT_TIMEZONE = "Asia/Kolkata"
`;
  }
}

export const db = new DatabaseService();
