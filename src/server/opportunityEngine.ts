/**
 * Pre-trade opportunity research engine.
 *
 * Produces testable hypotheses from causal market features, forecasts distributions
 * from temporally separated historical analogues, and applies a skeptical audit.
 * Outputs are research cards only: this module does not create signals or orders.
 */

import {
  Candle,
  FOREX_PAIRS,
  ForexSymbol,
  OpportunityAudit,
  OpportunityDirection,
  OpportunityForecast,
  OpportunityForecastPoint,
  OpportunityHypothesisType,
  TradeOpportunity,
} from "../types/index.js";
import { dataFeedEngine } from "./dataFeeds.js";
import { historicalDataStore } from "./historicalData.js";
import { db } from "./db.js";
import { researchEngine } from "./researchEngine.js";
import { fingerprintCandles, FEATURE_SCHEMA_VERSION, stableHash } from "./researchReproducibility.js";
import {
  binaryBreakEvenWinRate,
  wilsonLowerBound,
} from "./evolutionEngine.js";
import { isForexMarketIntervalOpen, isForexMarketOpenAt } from "./marketHours.js";
import { getNextCandleOpenMs } from "./tradingClock.js";

const REAL_SOURCES = new Set(["biquote", "dukascopy", "yahoo", "imported"]);
const M1_MS = 60_000;
const MAX_HORIZON = 30;
const MAX_HISTORY = 12_000;
const MAX_ANALOGUES = 120;
const MIN_ANALOGUES_FOR_FORECAST = 40;
const MIN_ANALOGUES_FOR_SHORTLIST = 100;
const MAX_SHORTLIST = 30;
const PAYOUT_FLOOR = 80;
const FEATURE_NAMES = [
  "return_1", "return_3", "return_5", "return_13",
  "body_direction", "body_ratio", "wick_imbalance", "close_location",
  "ema_spread", "ema_curvature", "rsi_centered", "rsi_momentum",
  "range_position_13", "range_position_34", "volatility_ratio",
  "directional_efficiency", "return_autocorrelation",
  "wick_pressure_change", "range_expansion",
] as const;

type Horizon = 5 | 10 | 15 | 20 | 25 | 30;

interface HistoricalFeatureRow {
  index: number;
  vector: number[];
}

interface PairContext {
  symbol: ForexSymbol;
  candles: Candle[];
  currentFeatures: number[];
  currentPrice: number;
  previous: Candle;
  latest: Candle;
  snapshotAt: string;
  snapshotMs: number;
  datasetFingerprint: string;
  marketDataQuality: number;
  dataSource: string;
  historicalFeatureRows: HistoricalFeatureRow[];
  analogueCache: Map<Horizon, Analogue[]>;
  closes: number[];
  ema9: number[];
  ema21: number[];
  rsi14: number[];
}

interface Analogue {
  index: number;
  distance: number;
}

interface HypothesisDefinition {
  type: OpportunityHypothesisType;
  name: string;
  description: string;
  score: (features: number[]) => number;
  threshold: number;
}

const HORIZONS: Horizon[] = [5, 10, 15, 20, 25, 30];

function isRealCandle(candle: Candle): boolean {
  return REAL_SOURCES.has(candle.source) &&
    Number.isFinite(candle.timestampMs) &&
    [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) &&
    candle.high >= Math.max(candle.open, candle.close, candle.low) &&
    candle.low <= Math.min(candle.open, candle.close, candle.high);
}

function quantile(values: number[], probability: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function distance(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return Infinity;
  let sum = 0;
  for (let index = 0; index < left.length; index++) {
    if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) return Infinity;
    const delta = left[index] - right[index];
    sum += delta * delta;
  }
  return Math.sqrt(sum / left.length);
}

function buildHypotheses(): HypothesisDefinition[] {
  return [
    {
      type: "TREND_CONTINUATION",
      name: "Trend continuation",
      description: "Tests whether directional efficiency, medium-term returns and EMA structure support continuation.",
      threshold: 0.16,
      score: f => 0.22*f[1] + 0.24*f[2] + 0.19*f[8] + 0.18*f[15] + 0.10*f[11] + 0.07*f[7],
    },
    {
      type: "MEAN_REVERSION",
      name: "Mean reversion",
      description: "Tests whether an extended move and range position are consistent with a statistically observed snapback.",
      threshold: 0.16,
      score: f => -0.23*f[3] - 0.22*f[12] - 0.17*f[13] - 0.16*f[10] + 0.14*f[6] - 0.08*f[8],
    },
    {
      type: "WICK_REJECTION",
      name: "Wick rejection",
      description: "Tests whether wick imbalance and candle-close location suggest rejection of the current extreme.",
      threshold: 0.18,
      score: f => 0.48*f[6] + 0.27*f[7] - 0.12*f[1] - 0.08*f[10] + 0.05*f[17],
    },
    {
      type: "MOMENTUM_BREAKOUT",
      name: "Momentum breakout",
      description: "Tests whether immediate returns, range expansion and directional efficiency support a breakout hypothesis.",
      threshold: 0.18,
      score: f => 0.22*f[0] + 0.24*f[1] + 0.22*f[18] + 0.17*f[7] + 0.15*f[15],
    },
    {
      type: "VOLATILITY_EXPANSION",
      name: "Volatility expansion",
      description: "Tests whether a volatility transition is accompanied by directional evidence rather than a range-only spike.",
      threshold: 0.18,
      score: f => 0.34*f[14] + 0.25*f[18] + 0.18*f[1] + 0.13*f[8] + 0.10*f[15],
    },
  ];
}

function computeMarketDataQuality(candles: Candle[], liveQuality: number): number {
  const tail = candles.slice(-240);
  if (tail.length < 2) return 0;
  let exactMinuteSteps = 0;
  for (let index = 1; index < tail.length; index++) {
    if (tail[index].timestampMs - tail[index - 1].timestampMs === M1_MS) exactMinuteSteps++;
  }
  const continuity = exactMinuteSteps / (tail.length - 1);
  return Number(Math.max(0, Math.min(100, (continuity * 0.7 + liveQuality / 100 * 0.3) * 100)).toFixed(1));
}

function wilson(wins: number, sampleSize: number): number {
  return wilsonLowerBound(wins, sampleSize);
}

function makeForecast(
  context: PairContext,
  currentFeatures: number[],
  horizon: Horizon,
  direction: OpportunityDirection
): OpportunityForecast {
  let selected = context.analogueCache.get(horizon);
  if (!selected) {
    const eligible: Analogue[] = [];
    const candles = context.candles;
    const entryOffset = 1;

    for (const row of context.historicalFeatureRows) {
      const index = row.index;
      const entryIndex = index + entryOffset;
      const exitIndex = index + horizon;
      if (exitIndex >= candles.length) continue;

      const entryTime = candles[entryIndex].timestampMs;
      const expiryTime = entryTime + horizon * M1_MS;
      if (candles[exitIndex].timestampMs !== expiryTime - M1_MS) continue;
      if (!isForexMarketIntervalOpen(entryTime, expiryTime)) continue;

      const candidateDistance = distance(currentFeatures, row.vector);
      if (Number.isFinite(candidateDistance)) eligible.push({ index, distance: candidateDistance });
    }

    eligible.sort((a, b) => a.distance - b.distance);
    selected = [];
    const separationMs = horizon * M1_MS;
    for (const candidate of eligible) {
      const entryTime = candles[candidate.index + entryOffset].timestampMs;
      if (selected.some(item =>
        Math.abs(candles[item.index + entryOffset].timestampMs - entryTime) < separationMs
      )) continue;
      selected.push(candidate);
      if (selected.length >= MAX_ANALOGUES) break;
    }
    context.analogueCache.set(horizon, selected);
  }

  const breakEven = binaryBreakEvenWinRate(PAYOUT_FLOOR);
  if (selected.length < MIN_ANALOGUES_FOR_FORECAST) {
    return {
      status: "INSUFFICIENT_HISTORY",
      points: [],
      terminalPrices: [],
      analogueCount: selected.length,
      meanDistance: selected.length
        ? Number((selected.reduce((sum, item) => sum + item.distance, 0) / selected.length).toFixed(4))
        : null,
      winRate: null,
      lowerConfidenceBound: null,
      payoutBreakEvenProbability: Number(breakEven.toFixed(4)),
      expectedValueLowerBound: null,
    };
  }

  const paths: number[][] = [];
  const terminalPrices: number[] = [];
  let wins = 0;
  let decisive = 0;
  for (const analogue of selected) {
    const entryIndex = analogue.index + 1;
    const entryPrice = context.candles[entryIndex].open;
    const path = [context.currentPrice];
    for (let minute = 1; minute <= horizon; minute++) {
      const historicalPrice = context.candles[entryIndex + minute - 1].close;
      path.push(context.currentPrice + (historicalPrice - entryPrice));
    }
    const terminal = path[path.length - 1];
    terminalPrices.push(terminal);
    paths.push(path);
    if (Math.abs(terminal - context.currentPrice) <= 1e-12) continue;
    decisive++;
    if (
      (direction === "BUY" && terminal > context.currentPrice) ||
      (direction === "SELL" && terminal < context.currentPrice)
    ) wins++;
  }

  const meanDistance = selected.reduce((sum, item) => sum + item.distance, 0) / selected.length;
  const winRate = decisive > 0 ? wins / decisive : null;
  const lowerBound = decisive >= MIN_ANALOGUES_FOR_FORECAST ? wilson(wins, decisive) : null;
  const expectedValue = lowerBound === null ? null : (lowerBound * (PAYOUT_FLOOR / 100)) - (1 - lowerBound);
  const points: OpportunityForecastPoint[] = [];
  for (let minute = 0; minute <= horizon; minute++) {
    const prices = paths.map(path => path[minute]);
    points.push({
      minute,
      q10: quantile(prices, 0.10),
      q25: quantile(prices, 0.25),
      median: quantile(prices, 0.50),
      q75: quantile(prices, 0.75),
      q90: quantile(prices, 0.90),
    });
  }

  return {
    status: "AVAILABLE",
    points,
    terminalPrices,
    analogueCount: decisive,
    meanDistance: Number(meanDistance.toFixed(4)),
    winRate: winRate === null ? null : Number(winRate.toFixed(4)),
    lowerConfidenceBound: lowerBound === null ? null : Number(lowerBound.toFixed(4)),
    payoutBreakEvenProbability: Number(breakEven.toFixed(4)),
    expectedValueLowerBound: expectedValue === null ? null : Number(expectedValue.toFixed(4)),
  };
}

function auditOpportunity(
  direction: OpportunityDirection,
  rawScore: number,
  threshold: number,
  forecast: OpportunityForecast,
  marketDataQuality: number,
  scheduleValid: boolean
): OpportunityAudit {
  const reasons: string[] = [];
  const counterEvidence: string[] = [];
  const breakEven = forecast.payoutBreakEvenProbability;

  if (direction === "NO_TRADE") {
    reasons.push("The current hypothesis score did not clear its activation threshold.");
    return {
      status: "NO_TRADE",
      rankScore: 0,
      reasons,
      counterEvidence: ["The model did not identify a sufficiently directional setup."],
      auditedAt: new Date().toISOString(),
    };
  }

  if (!scheduleValid) {
    reasons.push("The proposed entry-to-expiry interval crosses a spot-FX market closure.");
  }
  if (forecast.status !== "AVAILABLE") {
    reasons.push("Insufficient real historical analogues to draw a forecast distribution.");
  }
  if (forecast.analogueCount < MIN_ANALOGUES_FOR_SHORTLIST) {
    reasons.push(`Only ${forecast.analogueCount} independent analogue outcomes are available; at least ${MIN_ANALOGUES_FOR_SHORTLIST} are required for shortlisting.`);
  }
  if (forecast.meanDistance !== null && forecast.meanDistance > 0.45) {
    reasons.push("The closest historical states are too dissimilar to support a strong analogy.");
  }
  if (marketDataQuality < 70) {
    reasons.push("Recent one-minute market-data continuity is below the research quality threshold.");
  }
  if (forecast.lowerConfidenceBound === null || forecast.lowerConfidenceBound <= breakEven) {
    reasons.push("The conservative historical lower bound does not clear the payout-adjusted break-even probability.");
  }
  if (forecast.winRate !== null && forecast.winRate > breakEven && forecast.lowerConfidenceBound !== null && forecast.lowerConfidenceBound <= breakEven) {
    counterEvidence.push("The point estimate clears break-even, but its conservative confidence bound does not.");
  }
  if (forecast.meanDistance !== null && forecast.meanDistance > 0.35) {
    counterEvidence.push("Historical analogues have only moderate similarity to the current market state.");
  }
  if (Math.abs(rawScore) < threshold) {
    reasons.push("Directional activation is too weak.");
  }

  const rejectedForHardFailure = !scheduleValid || marketDataQuality < 70 ||
    (forecast.meanDistance !== null && forecast.meanDistance > 0.45);
  const insufficient = forecast.status !== "AVAILABLE" ||
    forecast.analogueCount < MIN_ANALOGUES_FOR_SHORTLIST ||
    forecast.lowerConfidenceBound === null;
  const clearedEdge = forecast.lowerConfidenceBound !== null &&
    forecast.lowerConfidenceBound > breakEven;
  const status = rejectedForHardFailure
    ? "REJECTED"
    : insufficient
      ? "INSUFFICIENT_EVIDENCE"
      : clearedEdge && reasons.length === 0
        ? "SHORTLISTED"
        : "REJECTED";

  const edgeScore = forecast.expectedValueLowerBound === null
    ? 0
    : Math.max(0, forecast.expectedValueLowerBound) * 350;
  const similarityScore = forecast.meanDistance === null
    ? 0
    : Math.max(0, 1 - forecast.meanDistance / 0.45) * 20;
  const activationScore = Math.min(1, Math.abs(rawScore)) * 10;
  const rankScore = status === "SHORTLISTED"
    ? Number(Math.min(100, edgeScore + similarityScore + activationScore).toFixed(2))
    : 0;

  return {
    status,
    rankScore,
    reasons: reasons.length ? reasons : ["All configured research shortlist gates passed."],
    counterEvidence,
    auditedAt: new Date().toISOString(),
  };
}

export class OpportunityEngine {
  private async preparePairContext(symbol: ForexSymbol): Promise<PairContext> {
    const live = await dataFeedEngine.fetchCandles(symbol, 120);
    const liveCandles = live.candles.filter(isRealCandle).sort((a, b) => a.timestampMs - b.timestampMs);
    const latestLive = liveCandles[liveCandles.length - 1];
    const nowMs = Date.now();
    if (!latestLive || nowMs - latestLive.timestampMs < -60_000 || nowMs - latestLive.timestampMs > 180_000) {
      throw new Error(`${symbol}: no fresh real one-minute feed is available; synthetic continuity candles are not eligible.`);
    }
    if (liveCandles.length < 61) {
      throw new Error(`${symbol}: at least 61 recent real one-minute candles are required for causal features.`);
    }
    const recentTail = liveCandles.slice(-61);
    for (let index = 1; index < recentTail.length; index++) {
      if (recentTail[index].timestampMs - recentTail[index - 1].timestampMs !== M1_MS) {
        throw new Error(`${symbol}: recent feed contains a gap in the 61-candle feature window.`);
      }
    }

    const merged = new Map<number, Candle>();
    for (const candle of historicalDataStore.getLatestCandles(symbol, MAX_HISTORY)) {
      if (isRealCandle(candle) && candle.timestampMs <= latestLive.timestampMs) merged.set(candle.timestampMs, candle);
    }
    for (const candle of db.getCandles(symbol, 5000)) {
      if (isRealCandle(candle) && candle.timestampMs <= latestLive.timestampMs) merged.set(candle.timestampMs, candle);
    }
    for (const candle of liveCandles) merged.set(candle.timestampMs, candle);
    const candles = Array.from(merged.values()).sort((a, b) => a.timestampMs - b.timestampMs).slice(-MAX_HISTORY);
    if (candles.length < 1200) {
      throw new Error(`${symbol}: only ${candles.length.toLocaleString()} real candles are available; at least 1,200 are required to build historical analogue forecasts.`);
    }

    const latest = candles[candles.length - 1];
    const previous = candles[candles.length - 2];
    if (latest.timestampMs !== latestLive.timestampMs) {
      throw new Error(`${symbol}: historical and live data do not end at the same market observation.`);
    }

    const closes = candles.map(candle => candle.close);
    const ema9 = researchEngine.calculateEMA(closes, 9);
    const ema21 = researchEngine.calculateEMA(closes, 21);
    const rsi14 = researchEngine.calculateRSI(closes, 14);
    const currentFeatures = researchEngine.extractCausalFeatureVector(
      latest, previous, closes, ema9, ema21, rsi14, candles.length - 1
    );

    // Build historical feature rows only within uninterrupted real M1 segments.
    // Each row must have 60 causal bars behind it and 30 fully observed bars ahead.
    const historicalFeatureRows: HistoricalFeatureRow[] = [];
    let segmentStart = 0;
    for (let index = 1; index <= candles.length; index++) {
      const ended = index === candles.length ||
        candles[index].timestampMs - candles[index - 1].timestampMs !== M1_MS;
      if (!ended) continue;
      const segmentEnd = index;
      const firstFeatureIndex = segmentStart + 60;
      const lastFeatureIndex = segmentEnd - MAX_HORIZON - 1;
      for (let cursor = firstFeatureIndex; cursor <= lastFeatureIndex; cursor++) {
        const vector = researchEngine.extractCausalFeatureVector(
          candles[cursor],
          candles[cursor - 1],
          closes,
          ema9,
          ema21,
          rsi14,
          cursor
        );
        historicalFeatureRows.push({ index: cursor, vector });
      }
      segmentStart = index;
    }

    if (historicalFeatureRows.length < 100) {
      throw new Error(`${symbol}: fewer than 100 uninterrupted historical feature states remain after removing market closures and data gaps.`);
    }

    const marketDataQuality = computeMarketDataQuality(candles, live.qualityScore);
    const snapshotMs = latest.timestampMs + M1_MS;
    return {
      symbol,
      candles,
      currentFeatures,
      currentPrice: latest.close,
      previous,
      latest,
      snapshotAt: new Date(snapshotMs).toISOString(),
      snapshotMs,
      datasetFingerprint: fingerprintCandles(candles),
      marketDataQuality,
      dataSource: live.source,
      historicalFeatureRows,
      analogueCache: new Map<Horizon, Analogue[]>(),
      closes,
      ema9,
      ema21,
      rsi14,
    };
  }

  private createOpportunity(
    context: PairContext,
    batchId: string,
    hypothesisType: OpportunityHypothesisType,
    hypothesisName: string,
    hypothesis: string,
    sourceKind: TradeOpportunity["sourceKind"],
    rawScore: number,
    threshold: number,
    horizon: Horizon,
    strategyGeneId?: string
  ): TradeOpportunity {
    const direction: OpportunityDirection = Math.abs(rawScore) < threshold
      ? "NO_TRADE"
      : rawScore >= 0 ? "BUY" : "SELL";
    const forecast = makeForecast(context, context.currentFeatures, horizon, direction);
    // Keep a full three-minute decision lead before the proposed aligned entry.
    const entryTimeMs = getNextCandleOpenMs(Date.now() + 3 * M1_MS, horizon);
    const expiryTimeMs = entryTimeMs + horizon * M1_MS;
    const scheduleValid = isForexMarketIntervalOpen(entryTimeMs, expiryTimeMs);
    const audit = auditOpportunity(
      direction,
      rawScore,
      threshold,
      forecast,
      context.marketDataQuality,
      scheduleValid
    );
    const id = `opp_${stableHash([
      batchId,
      context.symbol,
      hypothesisType,
      strategyGeneId || "template",
      String(horizon),
    ].join("|")).slice(0, 18)}`;
    const generatedAt = new Date().toISOString();
    return {
      id,
      batchId,
      symbol: context.symbol,
      hypothesisType,
      hypothesisName,
      hypothesis,
      sourceKind,
      strategyGeneId,
      direction,
      rawHypothesisScore: Number(rawScore.toFixed(5)),
      activationThreshold: threshold,
      horizonMinutes: horizon,
      generatedAt,
      snapshotAt: context.snapshotAt,
      staleAfter: new Date(Date.now() + 180_000).toISOString(),
      entryTimeUtc: new Date(entryTimeMs).toISOString(),
      expiryTimeUtc: new Date(expiryTimeMs).toISOString(),
      snapshotPrice: context.currentPrice,
      proposedEntryPrice: context.currentPrice,
      dataSource: context.dataSource,
      marketDataQuality: context.marketDataQuality,
      datasetFingerprint: context.datasetFingerprint,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      modelVersion: "opportunity-research-v1",
      marketFeatureVector: [...context.currentFeatures],
      recentPriceHistory: context.candles.slice(-30).map(candle => ({
        minuteOffset: Math.round(
          (candle.timestampMs + M1_MS - Date.parse(context.snapshotAt)) / M1_MS
        ),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
      forecast,
      audit,
      humanDecision: { status: "PENDING", decidedAt: generatedAt },
    };
  }

  public async generateBatch(symbols: ForexSymbol[] = FOREX_PAIRS): Promise<{
    batchId: string;
    requestedPairs: number;
    processedPairs: number;
    skippedPairs: Array<{ symbol: ForexSymbol; reason: string }>;
    generatedCount: number;
    shortlistedCount: number;
    rejectedCount: number;
    insufficientEvidenceCount: number;
    opportunities: TradeOpportunity[];
  }> {
    if (!isForexMarketOpenAt(Date.now())) {
      throw new Error("Spot-FX market is closed. Opportunity forecasts are paused until the market reopens.");
    }
    const uniqueSymbols = [...new Set(symbols)];
    if (!uniqueSymbols.length || uniqueSymbols.some(symbol => !FOREX_PAIRS.includes(symbol))) {
      throw new Error("Provide one or more supported forex pairs.");
    }
    if (uniqueSymbols.length > FOREX_PAIRS.length) throw new Error("Too many currency pairs requested.");

    const batchId = `opportunity_batch_${Date.now().toString(36)}_${stableHash(uniqueSymbols.join("|")).slice(0, 6)}`;
    const contexts = new Map<ForexSymbol, PairContext>();
    const skippedPairs: Array<{ symbol: ForexSymbol; reason: string }> = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(3, uniqueSymbols.length) }, async () => {
      while (cursor < uniqueSymbols.length) {
        const symbol = uniqueSymbols[cursor++];
        try {
          contexts.set(symbol, await this.preparePairContext(symbol));
        } catch (error: any) {
          skippedPairs.push({ symbol, reason: error?.message || "Market data unavailable." });
        }
      }
    });
    await Promise.all(workers);

    const opportunities: TradeOpportunity[] = [];
    const templates = buildHypotheses();
    for (const symbol of uniqueSymbols) {
      const context = contexts.get(symbol);
      if (!context) continue;
      for (const template of templates) {
        for (const horizon of HORIZONS) {
          opportunities.push(this.createOpportunity(
            context,
            batchId,
            template.type,
            template.name,
            template.description,
            "EXPLORATORY_HEURISTIC",
            template.score(context.currentFeatures),
            template.threshold,
            horizon
          ));
        }
      }

      // A strategy is only transferred into this pair if it was validated for this
      // exact pair and has already cleared the existing historical research gate.
      const pairGenes = db.getPaperTradingStrategies()
        .filter(gene => gene.symbol === symbol && !!gene.genome)
        .slice(0, 10);
      for (const gene of pairGenes) {
        const evaluation = researchEngine.evaluateSynthesizedGeneSignal(
          gene,
          context.latest,
          context.previous,
          context.closes,
          context.ema9,
          context.ema21,
          context.rsi14,
          context.closes.length - 1
        );
        const signedScore = evaluation.direction === "BUY"
          ? evaluation.conviction
          : -evaluation.conviction;
        opportunities.push(this.createOpportunity(
          context,
          batchId,
          "EVOLVED_GENOME",
          gene.name,
          gene.scientificHypothesis,
          "HISTORICALLY_VALIDATED_GENOME",
          evaluation.shouldTrigger ? signedScore : 0,
          gene.genome?.activationThreshold ?? 0.64,
          gene.optimalHorizonMinutes,
          gene.id
        ));
      }
    }

    opportunities.sort((a, b) => b.audit.rankScore - a.audit.rankScore);
    const shortlisted = opportunities.filter(item => item.audit.status === "SHORTLISTED")
      .slice(0, MAX_SHORTLIST);
    const shortlistIds = new Set(shortlisted.map(item => item.id));
    for (const item of opportunities) {
      if (item.audit.status === "SHORTLISTED" && !shortlistIds.has(item.id)) {
        item.audit = {
          ...item.audit,
          status: "REJECTED",
          rankScore: 0,
          reasons: ["Passed individual evidence checks but fell outside the batch's top shortlist after comparison."],
        };
      }
    }

    db.storeOpportunities(opportunities);
    return {
      batchId,
      requestedPairs: uniqueSymbols.length,
      processedPairs: contexts.size,
      skippedPairs,
      generatedCount: opportunities.length,
      shortlistedCount: shortlisted.length,
      rejectedCount: opportunities.filter(item => item.audit.status === "REJECTED").length,
      insufficientEvidenceCount: opportunities.filter(item => item.audit.status === "INSUFFICIENT_EVIDENCE").length,
      opportunities,
    };
  }

  public reviseDirection(
    opportunity: TradeOpportunity,
    direction: "BUY" | "SELL"
  ): TradeOpportunity {
    if (opportunity.forecast.status !== "AVAILABLE" || opportunity.forecast.terminalPrices.length < MIN_ANALOGUES_FOR_SHORTLIST) {
      throw new Error("This opportunity has fewer than the required 100 historical paths to recalculate a direction safely.");
    }
    const wins = opportunity.forecast.terminalPrices.filter(price =>
      direction === "BUY" ? price > opportunity.proposedEntryPrice : price < opportunity.proposedEntryPrice
    ).length;
    const decisive = opportunity.forecast.terminalPrices.filter(price =>
      Math.abs(price - opportunity.proposedEntryPrice) > 1e-12
    ).length;
    const winRate = decisive ? wins / decisive : null;
    const lower = decisive >= MIN_ANALOGUES_FOR_SHORTLIST ? wilson(wins, decisive) : null;
    const breakEven = opportunity.forecast.payoutBreakEvenProbability;
    const expectedValue = lower === null ? null : lower * (PAYOUT_FLOOR / 100) - (1 - lower);
    const counterEvidence = [
      "Human direction override: this is a revised hypothesis, not the original model recommendation.",
    ];
    const reasons = lower !== null && lower > breakEven
      ? ["Human-modified direction clears the historical analogue lower-bound check; it still requires paper-forward validation."]
      : ["The human-modified direction does not clear the payout-adjusted conservative lower-bound check."];
    const status: OpportunityAudit["status"] = lower === null
      ? "INSUFFICIENT_EVIDENCE"
      : lower > breakEven
        ? "SHORTLISTED"
        : "REJECTED";
    const revisedAt = new Date().toISOString();
    const id = `opp_rev_${stableHash(opportunity.id + "|" + direction + "|" + revisedAt).slice(0, 16)}`;
    return {
      ...opportunity,
      id,
      batchId: opportunity.batchId,
      direction,
      generatedAt: revisedAt,
      staleAfter: opportunity.staleAfter,
      rawHypothesisScore: direction === "BUY"
        ? Math.abs(opportunity.rawHypothesisScore)
        : -Math.abs(opportunity.rawHypothesisScore),
      forecast: {
        ...opportunity.forecast,
        winRate: winRate === null ? null : Number(winRate.toFixed(4)),
        lowerConfidenceBound: lower === null ? null : Number(lower.toFixed(4)),
        expectedValueLowerBound: expectedValue === null ? null : Number(expectedValue.toFixed(4)),
      },
      audit: {
        status,
        rankScore: status === "SHORTLISTED" ? Number(Math.max(0, expectedValue! * 350 + 10).toFixed(2)) : 0,
        reasons,
        counterEvidence,
        auditedAt: revisedAt,
      },
      humanDecision: {
        status: "PENDING",
        decidedAt: revisedAt,
        parentOpportunityId: opportunity.id,
      },
    };
  }
}

export const opportunityEngine = new OpportunityEngine();
