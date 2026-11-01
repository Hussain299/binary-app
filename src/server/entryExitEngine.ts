/**
 * SignalForge ML — Causal Entry & Exit Lifecycle Execution Engine
 * Enforces strict temporal ordering, causal triggers on post-signal closed candles,
 * dynamic entry-to-exit timing, ambiguity detection, and transaction cost modelling.
 */

import {
  Candle,
  ForexSymbol,
  MarketSessionId,
  ResearchSignal,
  SignalDirection,
  SignalLifecycleEvent,
  SignalLifecycleState,
} from '../types/index.js';
import { db } from './db.js';
import { getSessionFromTimestamp } from './dataFeeds.js';
import { calculateBinarySettlement, DEFAULT_BINARY_PAYOUT_PERCENT } from './binarySettlement.js';
import { isForexMarketOpenAt, isForexMarketIntervalOpen, isForexSignalScheduleValid } from './marketHours.js';
import { ADVANCE_NOTICE_MS, CLOCK_ALIGNMENT_TOLERANCE_MS, MAX_DECISION_PROCESSING_DELAY_MS, M1_CANDLE_MS, getNextCandleOpenMs, isAlignedCandleOpen, TradingTimeframeMinutes } from './tradingClock.js';

export interface SignalCreationParams {
  symbol: ForexSymbol;
  direction: SignalDirection;
  signalCandle: Candle;
  ruleFamily: string;
  expiryMinutes?: number;
  confidence: number;
  /** Broker-observed payout where available; otherwise use the 80% research floor. */
  payoutPct?: number;
  payoutSource?: 'ASSUMED_MINIMUM' | 'BROKER_OBSERVED';
  modelVersion: string;
  notes?: string;
  strategyName?: string;
  strategyWinRate?: number;
  strategyHistoricalSampleSize?: number;
  strategyEvidenceStatus?: 'UNVALIDATED' | 'INSUFFICIENT_SAMPLE' | 'BACKTESTED';
  strategyForwardApproved?: boolean;
  strategyId?: string;
  candleOpenTimeUtc?: string;
  candleCloseTimeUtc?: string;
  confluenceStrategies?: string[];
  confluenceScore?: number;
  isStackedStrategy?: boolean;
  isNovelAiSynthesized?: boolean;
  synthesizedGeneId?: string;
  mathematicalFormula?: string;
  whyHumansMissThis?: string;
  paperOnly?: boolean;
  marketFeatureVector?: number[];
  entryTimeframeMinutes?: TradingTimeframeMinutes;
}

export class EntryExitEngine {
  // Typical institutional forex spreads in pips
  private spreadsPips: Record<ForexSymbol, number> = {
    'EUR/USD': 1.1,
    'GBP/USD': 1.6,
    'USD/JPY': 1.2,
    'EUR/JPY': 1.8,
    'AUD/USD': 1.4,
    'USD/CAD': 1.7,
    'EUR/GBP': 1.2,
    'AUD/CAD': 1.8,
    'AUD/CHF': 1.9,
    'AUD/JPY': 1.7,
    'AUD/NZD': 2.0,
    'EUR/AUD': 1.9,
    'EUR/CAD': 1.8,
    'EUR/CHF': 1.6,
    'EUR/NZD': 2.2,
    'GBP/AUD': 2.2,
    'GBP/CAD': 2.0,
    'GBP/CHF': 2.1,
    'GBP/JPY': 2.0,
    'GBP/NZD': 2.4,
  };

  /**
   * Factory for creating a research signal in DETECTED state, moving to WAITING_FOR_ENTRY.
   * Every trade is synchronized to its explicitly selected 5–30 minute entry candle.
   */
  public createResearchSignal(params: SignalCreationParams): ResearchSignal {
    const isJpy = params.symbol.includes('JPY');
    const pipUnit = isJpy ? 0.01 : 0.0001;
    const now = new Date();
    const nowUtc = now.toISOString();

    const signalCandleTime = params.signalCandle.timestamp;
    const signalClose = params.signalCandle.close;
    const signalHigh = params.signalCandle.high;
    const signalLow = params.signalCandle.low;

    // The selected genome controls a 5–30 minute starting candle and matching expiry horizon.
    const expiryMinutes = params.expiryMinutes || (
      params.ruleFamily.includes('momentum')
        ? 5
        : params.ruleFamily.includes('wick')
        ? 10
        : params.ruleFamily.includes('mean_reversion')
        ? 15
        : params.ruleFamily.includes('range')
        ? 20
        : params.ruleFamily.includes('squeeze')
        ? 25
        : 15
    );

    // Entry candle timeframe is explicit (5–30m). The scheduler supplies the
    // exact aligned boundary after checking the closed M1 decision candle is T-3m.
    const isTest = params.ruleFamily.startsWith('test_');
    const signalCandleMs = params.signalCandle.timestampMs || Date.now();
    const entryTimeframeMinutes = params.entryTimeframeMinutes ?? 5;
    if (!isTest && params.entryTimeframeMinutes !== undefined && entryTimeframeMinutes !== expiryMinutes) {
      throw new Error('The research entry timeframe and expiry horizon must match so training and forward outcomes use the same contract.');
    }
    if (![5, 10, 15, 20, 25, 30].includes(entryTimeframeMinutes)) {
      throw new Error('Entry timeframe must be one of 5, 10, 15, 20, 25 or 30 minutes.');
    }
    const refMs = isTest ? signalCandleMs : Date.now();
    const calculatedEntryOpenMs = getNextCandleOpenMs(refMs, entryTimeframeMinutes);
    const suppliedEntryOpenMs = params.candleOpenTimeUtc
      ? Date.parse(params.candleOpenTimeUtc)
      : calculatedEntryOpenMs;
    if (!Number.isFinite(suppliedEntryOpenMs) ||
        !isAlignedCandleOpen(suppliedEntryOpenMs, entryTimeframeMinutes)) {
      throw new Error('Scheduled entry time is invalid or not aligned to the selected 5–30 minute candle.');
    }
    const nextCandleOpenMs = suppliedEntryOpenMs;
    if (!isTest && params.candleOpenTimeUtc) {
      const expectedDecisionTimeMs = nextCandleOpenMs - ADVANCE_NOTICE_MS;
      const actualDecisionTimeMs = signalCandleMs + M1_CANDLE_MS;
      if (Math.abs(actualDecisionTimeMs - expectedDecisionTimeMs) > CLOCK_ALIGNMENT_TOLERANCE_MS) {
        throw new Error('Signal candle must close exactly three minutes before the selected entry candle opens.');
      }
      const currentTimeMs = now.getTime();
      if (
        currentTimeMs < expectedDecisionTimeMs - CLOCK_ALIGNMENT_TOLERANCE_MS ||
        currentTimeMs >= expectedDecisionTimeMs + MAX_DECISION_PROCESSING_DELAY_MS
      ) {
        throw new Error('Signal creation is outside the permitted three-minute advance decision window.');
      }
    }
    // Check market state after causal schedule validation so each invariant retains
    // its own deterministic error and regression test.
    if (!isTest && !isForexMarketOpenAt(now)) {
      throw new Error('Spot FX market is closed for the weekend; new paper signals are prohibited.');
    }
    if (!isTest && !isForexMarketOpenAt(signalCandleMs)) {
      throw new Error('The signal candle timestamp falls outside the open FX market week.');
    }
    const nextCandleCloseMs = nextCandleOpenMs + (expiryMinutes * 60 * 1000);
    if (!isTest && !isForexMarketIntervalOpen(nextCandleOpenMs, nextCandleCloseMs)) {
      throw new Error('The complete entry-to-expiry interval must remain inside open spot-FX market hours.');
    }

    const candleOpenTimeUtc = new Date(nextCandleOpenMs).toISOString();
    const candleCloseTimeUtc = params.candleCloseTimeUtc || new Date(nextCandleCloseMs).toISOString();
    if (params.candleCloseTimeUtc &&
        Math.abs(Date.parse(params.candleCloseTimeUtc) - nextCandleCloseMs) > 5_000) {
      throw new Error('Scheduled close time must equal the entry boundary plus the selected expiry.');
    }

    const candleOpenTimeIst = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(new Date(candleOpenTimeUtc)).toUpperCase() + ' IST';

    const candleCloseTimeIst = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(new Date(candleCloseTimeUtc)).toUpperCase() + ' IST';

    // Causal Trigger Definition:
    // CALL / BUY: requires price to break above the signal candle's high
    // PUT / SELL: requires price to break below the signal candle's low
    let triggerPrice: number;
    let invalidationPrice: number;
    let entryCondition: string;

    if (params.direction === 'BUY') {
      triggerPrice = Number((signalHigh + 0.2 * pipUnit).toFixed(isJpy ? 3 : 5));
      invalidationPrice = Number((signalLow - 1.0 * pipUnit).toFixed(isJpy ? 3 : 5));
      entryCondition = `Strict ${entryTimeframeMinutes}M Candle Open (${candleOpenTimeIst}) [Trigger: ${triggerPrice}] · ${expiryMinutes}m Expiry`;
    } else {
      triggerPrice = Number((signalLow - 0.2 * pipUnit).toFixed(isJpy ? 3 : 5));
      invalidationPrice = Number((signalHigh + 1.0 * pipUnit).toFixed(isJpy ? 3 : 5));
      entryCondition = `Strict ${entryTimeframeMinutes}M Candle Open (${candleOpenTimeIst}) [Trigger: ${triggerPrice}] · ${expiryMinutes}m Expiry`;
    }

    // Entry window: tests preserve their synthetic path; live signals use the explicit N-minute candle open.
    const entryWindowStartMs = isTest ? (signalCandleMs + 60 * 1000) : nextCandleOpenMs;
    const entryWindowEndMs = entryWindowStartMs + (expiryMinutes * 60 * 1000);

    const initialHistory: SignalLifecycleEvent[] = [
      {
        timestamp: nowUtc,
        fromState: 'DETECTED',
        toState: 'WAITING_FOR_ENTRY',
        reason: `3-Minute Advance Signal Detected. Trade strictly scheduled for ${entryTimeframeMinutes}M Candle Open (${candleOpenTimeIst}). Expiry: ${expiryMinutes}m (${candleCloseTimeIst}).`,
      },
    ];

    const istString = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(now).toUpperCase() + ' IST';

    const defaultStrategyName = params.strategyName || (
      params.ruleFamily.includes('momentum')
        ? '5-Min Momentum Breakout'
        : params.ruleFamily.includes('wick')
        ? '10-Min Liquidity Wick Reversal'
        : params.ruleFamily.includes('mean_reversion')
        ? '15-Min Statistical Mean Reversion'
        : params.ruleFamily.includes('range')
        ? '20-Min Volatility Range Breakout'
        : '30-Min Order Flow Expansion'
    );

    // Never invent a historical win rate for a rule without measured backtest evidence.
    const defaultWinRate = params.strategyWinRate;

    const signal: ResearchSignal = {
      id: `sig_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      symbol: params.symbol,
      direction: params.direction,
      predictionTimeUtc: nowUtc,
      predictionTimeIst: istString,
      signalCandleTime,
      entryCondition,
      entryWindowStartUtc: new Date(entryWindowStartMs).toISOString(),
      entryWindowEndUtc: new Date(entryWindowEndMs).toISOString(),
      triggerPrice,
      invalidationPrice,
      actualEntryTimeUtc: null,
      actualEntryPrice: null,
      entrySource: null,
      expiryMinutes,
      plannedExitTimeUtc: null, // Computed strictly AFTER entry confirmed!
      actualExitTimeUtc: null,
      actualExitPrice: null,
      confidence: params.confidence,
      // Confidence is currently a heuristic signal-strength score, not a calibrated probability.
      calibrationStatus: 'UNCALIBRATED',
      lifecycleState: 'WAITING_FOR_ENTRY',
      lifecycleHistory: initialHistory,
      grossReturnPips: null,
      estimatedSpreadPips: this.spreadsPips[params.symbol] || 1.5,
      netReturnPips: null,
      payoutPct: params.payoutPct ?? DEFAULT_BINARY_PAYOUT_PERCENT,
      payoutSource: params.payoutSource ?? 'ASSUMED_MINIMUM',
      netReturnUnits: null,
      outcomeResult: 'PENDING',
      ruleFamily: params.ruleFamily,
      modelVersion: params.modelVersion,
      notes: params.notes,
      strategyName: defaultStrategyName,
      strategyWinRate: defaultWinRate,
      strategyHistoricalSampleSize: params.strategyHistoricalSampleSize,
      strategyEvidenceStatus: params.strategyEvidenceStatus,
      strategyForwardApproved: params.strategyForwardApproved ?? false,
      strategyId: params.strategyId || `rule:${params.ruleFamily}`,
      advanceNoticeMinutes: 3,
      candleOpenTimeUtc,
      candleCloseTimeUtc,
      entryTimeframeMinutes,
      candleOpenTimeIst,
      candleCloseTimeIst,
      marketSession: getSessionFromTimestamp(now).id,
      marketSessionName: getSessionFromTimestamp(now).name,
      confluenceStrategies: params.confluenceStrategies || [defaultStrategyName],
      confluenceScore: params.confluenceScore || 1,
      isStackedStrategy: params.isStackedStrategy ?? false,
      isNovelAiSynthesized: params.isNovelAiSynthesized ?? false,
      synthesizedGeneId: params.synthesizedGeneId,
      mathematicalFormula: params.mathematicalFormula,
      whyHumansMissThis: params.whyHumansMissThis,
      paperOnly: true, // Research and forward validation are paper-only; no signal may authorize broker execution.
      marketFeatureVector: params.marketFeatureVector ? [...params.marketFeatureVector] : undefined,
    };

    return db.addSignal(signal);
  }

  /**
   * Cancels legacy persisted signals whose decision/entry/expiry schedule ever
   * touched a closed FX interval. They are not scored and cannot be revived after
   * the Sunday reopen. Valid pre-close signals remain eligible for exact-bar
   * recovery if their data is still available.
   */
  public cancelSignalsOutsideForexWeek(): ResearchSignal[] {
    const cancelled: ResearchSignal[] = [];
    for (const signal of db.getActiveSignals()) {
      const predictionTimeMs = Date.parse(signal.predictionTimeUtc);
      const entryTimeMs = Date.parse(
        signal.actualEntryTimeUtc || signal.candleOpenTimeUtc || signal.entryWindowStartUtc
      );
      const expiryTimeMs = Date.parse(
        signal.plannedExitTimeUtc || signal.candleCloseTimeUtc || signal.entryWindowEndUtc
      );
      if (isForexSignalScheduleValid(predictionTimeMs, entryTimeMs, expiryTimeMs)) continue;

      const previousState = signal.lifecycleState;
      signal.lifecycleState = 'EXPIRED';
      signal.outcomeResult = 'CANCELLED';
      signal.netReturnUnits = null;
      signal.actualExitTimeUtc = null;
      signal.actualExitPrice = null;
      signal.lifecycleHistory = Array.isArray(signal.lifecycleHistory) ? signal.lifecycleHistory : [];
      signal.lifecycleHistory.push({
        timestamp: new Date().toISOString(),
        fromState: previousState,
        toState: 'EXPIRED',
        reason: 'Weekly FX market-hours guard cancelled a legacy signal whose decision, entry or expiry window fell outside the open market week. No WIN/LOSS was inferred and no learning update was recorded.',
      });
      db.updateSignal(signal);
      cancelled.push(signal);
    }
    return cancelled;
  }

  /**
   * Evaluates active research signals against newly arrived completed candles.
   * Advances states through the causal state machine.
   */
  public evaluateSignals(candlesMap: Record<ForexSymbol, Candle[]>, includeTest: boolean = false): ResearchSignal[] {
    const marketOpen = isForexMarketOpenAt(Date.now());
    const cancelledOutsideHours = this.cancelSignalsOutsideForexWeek();
    const activeSignals = db.getActiveSignals(includeTest).filter(signal =>
      marketOpen || (includeTest && signal.ruleFamily.startsWith('test_'))
    );
    const updatedSignals: ResearchSignal[] = [...cancelledOutsideHours];

    for (const signal of activeSignals) {
      const candles = candlesMap[signal.symbol];
      if (!candles || candles.length === 0) continue;

      let changed = false;

      // 1. Process WAITING_FOR_ENTRY state
      if (signal.lifecycleState === 'WAITING_FOR_ENTRY') {
        const windowStartMs = Date.parse(signal.entryWindowStartUtc);
        const windowEndMs = Date.parse(signal.entryWindowEndUtc);

        // A. Test Suite Signals: process test triggers
        if (signal.ruleFamily.startsWith('test_')) {
          const windowCandles = candles.filter(
            c => c.timestampMs >= windowStartMs && c.timestampMs <= windowEndMs
          );

          for (const candle of windowCandles) {
            const triggerHit =
              signal.direction === 'BUY'
                ? candle.high >= signal.triggerPrice
                : candle.low <= signal.triggerPrice;

            const invalidationHit =
              signal.direction === 'BUY'
                ? candle.low <= signal.invalidationPrice
                : candle.high >= signal.invalidationPrice;

            if (triggerHit && invalidationHit) {
              signal.lifecycleState = 'AMBIGUOUS';
              signal.outcomeResult = 'CANCELLED';
              signal.lifecycleHistory.push({
                timestamp: new Date().toISOString(),
                fromState: 'WAITING_FOR_ENTRY',
                toState: 'AMBIGUOUS',
                reason: `Both trigger (${signal.triggerPrice}) and invalidation (${signal.invalidationPrice}) crossed in 1m candle at ${candle.timestamp}. Tick ordering indeterminate.`,
                price: candle.close,
              });
              changed = true;
              break;
            }

            if (invalidationHit && !triggerHit) {
              signal.lifecycleState = 'INVALIDATED';
              signal.outcomeResult = 'CANCELLED';
              signal.lifecycleHistory.push({
                timestamp: new Date().toISOString(),
                fromState: 'WAITING_FOR_ENTRY',
                toState: 'INVALIDATED',
                reason: `Adverse price movement touched invalidation level (${signal.invalidationPrice}) at ${candle.timestamp}.`,
                price: candle.close,
              });
              changed = true;
              break;
            }

            if (triggerHit) {
              const entryFillPrice =
                signal.direction === 'BUY'
                  ? Math.max(candle.open, signal.triggerPrice)
                  : Math.min(candle.open, signal.triggerPrice);

              const entryTimeMs = candle.timestampMs;
              const entryTimeUtc = candle.timestamp;
              const plannedExitMs = entryTimeMs + signal.expiryMinutes * 60 * 1000;
              const plannedExitTimeUtc = new Date(plannedExitMs).toISOString();

              signal.actualEntryTimeUtc = entryTimeUtc;
              signal.actualEntryPrice = entryFillPrice;
              signal.entrySource = candle.source;
              signal.plannedExitTimeUtc = plannedExitTimeUtc;
              signal.lifecycleState = 'ACTIVE';

              signal.lifecycleHistory.push({
                timestamp: new Date().toISOString(),
                fromState: 'WAITING_FOR_ENTRY',
                toState: 'ENTRY_TRIGGERED',
                reason: `Trigger level crossed at ${candle.timestamp}. Entry confirmed at ${entryFillPrice}.`,
                price: entryFillPrice,
              });

              signal.lifecycleHistory.push({
                timestamp: new Date().toISOString(),
                fromState: 'ENTRY_TRIGGERED',
                toState: 'ACTIVE',
                reason: `Active position underway. Expiry scheduled for ${plannedExitTimeUtc} (${signal.expiryMinutes}m duration).`,
                price: entryFillPrice,
              });

              changed = true;
              break;
            }
          }
        } else if (signal.candleOpenTimeUtc) {
          // B. Strict live entry-candle opening trigger (never substitute a later M1 bar).
          const candleOpenMs = Date.parse(signal.candleOpenTimeUtc);
          const newestCandle = candles[candles.length - 1];
          const nowMs = Date.now();
          const entryCandle = candles.find(c => Math.abs(c.timestampMs - candleOpenMs) <= 5_000);
          if (entryCandle) {
            const entryFillPrice = entryCandle.open;
            const entryTimeUtc = signal.candleOpenTimeUtc;
            const plannedExitMs = candleOpenMs + (signal.expiryMinutes || 5) * 60 * 1000;
            const plannedExitTimeUtc = signal.candleCloseTimeUtc || new Date(plannedExitMs).toISOString();

            signal.actualEntryTimeUtc = entryTimeUtc;
            signal.actualEntryPrice = entryFillPrice;
            signal.entrySource = entryCandle.source;
            signal.plannedExitTimeUtc = plannedExitTimeUtc;
            signal.lifecycleState = 'ACTIVE';

            signal.lifecycleHistory.push({
              timestamp: new Date().toISOString(),
              fromState: 'WAITING_FOR_ENTRY',
              toState: 'ACTIVE',
              reason: `Trade opened on the exact ${signal.entryTimeframeMinutes ?? 5}M candle boundary (${signal.candleOpenTimeIst || entryTimeUtc}) at price ${entryFillPrice}. Expiry: ${signal.expiryMinutes} minutes (${signal.candleCloseTimeIst || plannedExitTimeUtc}).`,
              price: entryFillPrice,
            });

            changed = true;
          } else if (newestCandle.timestampMs > candleOpenMs + 5_000) {
            // Do not substitute a later candle for a missed exact M5 open.
            signal.lifecycleState = 'EXPIRED';
            signal.outcomeResult = 'CANCELLED';
            signal.lifecycleHistory.push({
              timestamp: new Date().toISOString(),
              fromState: 'WAITING_FOR_ENTRY',
              toState: 'EXPIRED',
              reason: `Exact ${signal.entryTimeframeMinutes ?? 5}M entry candle was unavailable at ${signal.candleOpenTimeUtc}; no late substitute entry was taken.`,
            });
            changed = true;
          }
        }

        // If still waiting and window has expired
        const newestCandle = candles[candles.length - 1];
        if (
          signal.lifecycleState === 'WAITING_FOR_ENTRY' &&
          newestCandle.timestampMs > windowEndMs
        ) {
          signal.lifecycleState = 'EXPIRED';
          signal.outcomeResult = 'CANCELLED';
          signal.lifecycleHistory.push({
            timestamp: new Date().toISOString(),
            fromState: 'WAITING_FOR_ENTRY',
            toState: 'EXPIRED',
            reason: `Entry window elapsed (${signal.entryWindowEndUtc}) without trigger condition being satisfied.`,
          });
          changed = true;
        }
      }

      // 2. Process ACTIVE state
      if (!changed && signal.lifecycleState === 'ACTIVE' && signal.plannedExitTimeUtc && signal.actualEntryPrice) {
        const plannedExitMs = Date.parse(signal.plannedExitTimeUtc);
        const newestCandle = candles[candles.length - 1];
        const nowMs = Date.now();
        
        const isTest = signal.ruleFamily?.startsWith('test_');
        // Match the historical replay exactly: the M1 candle opened one minute
        // before expiry closes at the binary contract's target expiry timestamp.
        // Never use a later candle as a substitute when the target candle is missing.
        const targetExitCandle = candles.find(c =>
          Math.abs((c.timestampMs + 60_000) - plannedExitMs) <= 5_000
        );
        const exitCandle = targetExitCandle && (isTest || nowMs >= plannedExitMs)
          ? targetExitCandle
          : null;

        if (exitCandle) {
          const isJpy = signal.symbol.includes('JPY');
          const pipFactor = isJpy ? 100 : 10000;
          const exitPrice = exitCandle.close;
          const entryPrice = signal.actualEntryPrice;
          const payoutPct = signal.payoutPct ?? DEFAULT_BINARY_PAYOUT_PERCENT;
          const settlement = calculateBinarySettlement(
            signal.direction,
            entryPrice,
            exitPrice,
            payoutPct
          );
          const grossPips = Number((
            (signal.direction === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice) * pipFactor
          ).toFixed(1));

          signal.actualExitTimeUtc = exitCandle.timestamp;
          signal.actualExitPrice = exitPrice;
          signal.grossReturnPips = grossPips; // Informational price movement only; not the contract P/L.
          signal.netReturnPips = null; // Binary options are not scored using forex pip spreads.
          signal.netReturnUnits = settlement.netReturnUnits;
          signal.payoutPct = payoutPct;
          signal.payoutSource = signal.payoutSource ?? 'ASSUMED_MINIMUM';
          signal.outcomeResult = settlement.outcome;
          signal.lifecycleState = 'CLOSED';

          const unitText = settlement.netReturnUnits > 0
            ? `+${settlement.netReturnUnits.toFixed(2)} stake units`
            : settlement.netReturnUnits < 0
              ? `${settlement.netReturnUnits.toFixed(2)} stake units`
              : '0.00 stake units (push)';
          signal.lifecycleHistory.push({
            timestamp: new Date().toISOString(),
            fromState: 'ACTIVE',
            toState: 'CLOSED',
            reason: `Binary contract expired at ${signal.plannedExitTimeUtc}. Entry ${entryPrice}; expiry ${exitPrice}; payout ${payoutPct}% (${signal.payoutSource}); result ${settlement.outcome}; return ${unitText}.`,
            price: exitPrice,
          });

          changed = true;
        } else if (
          (isTest || nowMs >= plannedExitMs) &&
          newestCandle.timestampMs + 60_000 > plannedExitMs
        ) {
          // The contract expiry minute has passed, but its exact M1 close is
          // absent. Mark the observation unscored instead of settling a later bar.
          signal.lifecycleState = 'EXPIRED';
          signal.outcomeResult = 'CANCELLED';
          signal.lifecycleHistory.push({
            timestamp: new Date().toISOString(),
            fromState: 'ACTIVE',
            toState: 'EXPIRED',
            reason: `Exact binary expiry candle was missing at ${signal.plannedExitTimeUtc}; no later candle was substituted, so no WIN/LOSS was recorded.`,
          });
          changed = true;
        }
      }

      if (changed) {
        db.updateSignal(signal);
        updatedSignals.push(signal);
      }
    }

    return updatedSignals;
  }
}

export const entryExitEngine = new EntryExitEngine();
