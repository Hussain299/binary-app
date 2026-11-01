/**
 * SignalForge forward-evidence platform.
 *
 * All diagnostics consume immutable prediction snapshots and append-only outcomes.
 * This module never changes strategy weights, creates trade signals, or submits orders.
 */
import type {
  Candle,
  CalibrationDiagnostics,
  ForecastPathDiagnostics,
  ModelEvidenceSummary,
  ModelPromotionStatus,
  OpportunityDirection,
  PaperExecutionSimulationInput,
  PaperExecutionSimulationResult,
  ResearchChampionRecord,
  ResearchEvidenceStream,
  ResearchFailureCluster,
  ResearchIntelligenceDashboard,
  ResearchMarketRegime,
  ResearchOutcomeRecord,
  ResearchPredictionRecord,
  ResearchRegimeLabel,
  RegimeEvidenceSummary,
} from "../types/index.js";
import { stableHash } from "./researchReproducibility.js";

export const RESEARCH_REAL_DATA_SOURCES = new Set(["biquote", "dukascopy", "yahoo", "imported"]);
export const MIN_CALIBRATION_SAMPLE_SIZE = 100;
export const MIN_CHAMPION_SAMPLE_SIZE = 300;
export const MODEL_PROMOTION_WILSON_Z = 3.29;
const MIN_REGIME_CANDLES = 60;
const REGIME_STALE_AFTER_MS = 180_000;

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function standardDeviation(values: number[]): number {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function emptyRegime(
  symbol: Candle["symbol"],
  evaluatedAtUtc: string,
  reason: string,
  latestCandleUtc: string | null = null,
  dataFreshness: ResearchMarketRegime["dataFreshness"] = "INSUFFICIENT_DATA"
): ResearchMarketRegime {
  return {
    symbol,
    label: "UNKNOWN",
    directionalEfficiency: null,
    volatilityRatio: null,
    confidence: 0,
    observationCount: 0,
    latestCandleUtc,
    evaluatedAtUtc,
    staleAfterUtc: latestCandleUtc
      ? new Date(Date.parse(latestCandleUtc) + 60_000 + REGIME_STALE_AFTER_MS).toISOString()
      : null,
    dataFreshness,
    source: "REAL_M1_CANDLES",
    reason,
  };
}

/**
 * Causal regime descriptor over the latest 60 fully observed, consecutive real M1 candles.
 * It is descriptive, not a prediction; a stale or interrupted series becomes UNKNOWN.
 */
export function classifyResearchRegime(
  input: readonly Candle[],
  nowMs = Date.now()
): ResearchMarketRegime {
  const real = input
    .filter(candle =>
      RESEARCH_REAL_DATA_SOURCES.has(candle.source) &&
      Number.isFinite(candle.timestampMs) &&
      finitePositive(candle.open) &&
      finitePositive(candle.high) &&
      finitePositive(candle.low) &&
      finitePositive(candle.close) &&
      candle.high >= Math.max(candle.open, candle.close) &&
      candle.low <= Math.min(candle.open, candle.close)
    )
    .slice()
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const unique: Candle[] = [];
  for (const candle of real) {
    if (unique.length && unique[unique.length - 1].timestampMs === candle.timestampMs) {
      unique[unique.length - 1] = candle;
    } else {
      unique.push(candle);
    }
  }
  const latest = unique[unique.length - 1];
  const evaluatedAtUtc = new Date(nowMs).toISOString();
  if (!latest || unique.length < MIN_REGIME_CANDLES) {
    return emptyRegime(
      input[0]?.symbol || "EUR/USD",
      evaluatedAtUtc,
      `Need at least ${MIN_REGIME_CANDLES} consecutive real M1 candles; synthetic and test candles are excluded.`,
      latest ? new Date(latest.timestampMs).toISOString() : null
    );
  }

  const window = unique.slice(-MIN_REGIME_CANDLES);
  for (let index = 1; index < window.length; index++) {
    if (window[index].timestampMs - window[index - 1].timestampMs !== 60_000) {
      return emptyRegime(
        latest.symbol,
        evaluatedAtUtc,
        "The recent real M1 series contains a time gap; regime classification abstained.",
        new Date(latest.timestampMs).toISOString()
      );
    }
  }

  const closeReturns = window.slice(1).map((candle, index) =>
    (candle.close - window[index].close) / window[index].close
  );
  const totalPath = closeReturns.reduce((sum, value) => sum + Math.abs(value), 0);
  const netMove = window[window.length - 1].close - window[0].close;
  const efficiency = totalPath > 0 ? Math.min(1, Math.abs(netMove / window[0].close) / totalPath) : 0;

  const recentVolatility = standardDeviation(closeReturns.slice(-20));
  const baselineVolatility = standardDeviation(closeReturns.slice(-40, -20));
  const volatilityRatio = baselineVolatility > 0
    ? recentVolatility / baselineVolatility
    : recentVolatility === 0 ? 1 : null;

  let label: ResearchRegimeLabel = "MIXED";
  let reason = "Directional efficiency and volatility do not clearly identify a trend or range.";
  if (volatilityRatio !== null && volatilityRatio >= 1.8) {
    label = "HIGH_VOLATILITY";
    reason = "Recent return dispersion is at least 1.8× the preceding 20-minute baseline.";
  } else if (efficiency >= 0.42) {
    label = netMove >= 0 ? "TRENDING_UP" : "TRENDING_DOWN";
    reason = "The last 60 real M1 candles show sustained directional displacement relative to total path length.";
  } else if (efficiency <= 0.18) {
    label = "RANGING";
    reason = "Directional displacement is small relative to the total absolute price path.";
  }

  const confidence = label === "HIGH_VOLATILITY"
    ? Math.min(1, (volatilityRatio ?? 1) / 3)
    : label === "TRENDING_UP" || label === "TRENDING_DOWN"
      ? Math.min(1, efficiency / 0.7)
      : label === "RANGING"
        ? Math.min(1, (0.25 - efficiency) / 0.25)
        : 0.35;

  const latestCandleUtc = new Date(latest.timestampMs).toISOString();
  const dataFreshness = nowMs - (latest.timestampMs + 60_000) <= REGIME_STALE_AFTER_MS
    ? "FRESH"
    : "STALE";
  return {
    symbol: latest.symbol,
    label: dataFreshness === "FRESH" ? label : "UNKNOWN",
    directionalEfficiency: Number(efficiency.toFixed(4)),
    volatilityRatio: volatilityRatio === null ? null : Number(volatilityRatio.toFixed(4)),
    confidence: dataFreshness === "FRESH" ? Number(confidence.toFixed(4)) : 0,
    observationCount: window.length,
    latestCandleUtc,
    evaluatedAtUtc,
    staleAfterUtc: new Date(latest.timestampMs + 60_000 + REGIME_STALE_AFTER_MS).toISOString(),
    dataFreshness,
    source: "REAL_M1_CANDLES",
    reason: dataFreshness === "FRESH" ? reason : "Latest real M1 candle is stale; regime-dependent recommendations are disabled.",
  };
}

function wilsonLowerBound(wins: number, sampleSize: number, z = 1.96): number | null {
  if (!Number.isFinite(wins) || !Number.isFinite(sampleSize) || sampleSize <= 0) return null;
  const p = Math.max(0, Math.min(1, wins / sampleSize));
  const z2 = z * z;
  const denominator = 1 + z2 / sampleSize;
  const center = p + z2 / (2 * sampleSize);
  const margin = z * Math.sqrt((p * (1 - p) / sampleSize) + z2 / (4 * sampleSize * sampleSize));
  return Math.max(0, Math.min(1, (center - margin) / denominator));
}

function evidenceStream(source: ResearchPredictionRecord["source"]): ResearchEvidenceStream {
  return source === "SIGNAL" ? "SIGNAL_FORWARD" : "OPPORTUNITY_FORWARD";
}

function calibrationDiagnostics(
  predictions: ResearchPredictionRecord[],
  outcomes: ResearchOutcomeRecord[],
  nowMs: number
): CalibrationDiagnostics {
  const outcomesById = new Map(outcomes.map(item => [item.predictionId, item]));
  const observations = predictions
    .filter(item => item.calibratedProbability !== null &&
      Number.isFinite(item.calibratedProbability) &&
      item.calibratedProbability >= 0 && item.calibratedProbability <= 1)
    .map(item => ({ prediction: item, outcome: outcomesById.get(item.id) }))
    .filter((item): item is { prediction: ResearchPredictionRecord; outcome: ResearchOutcomeRecord } =>
      !!item.outcome && (item.outcome.result === "WIN" || item.outcome.result === "LOSS")
    )
    .sort((a, b) => Date.parse(a.outcome.settledAtUtc) - Date.parse(b.outcome.settledAtUtc));

  const empty: CalibrationDiagnostics = {
    status: "COLLECTING",
    sampleSize: observations.length,
    validationSampleSize: 0,
    brierScore: null,
    expectedCalibrationError: null,
    meanPredictedProbability: null,
    observedWinRate: null,
    calibrationGap: null,
    evaluatedAtUtc: new Date(nowMs).toISOString(),
  };
  if (observations.length < MIN_CALIBRATION_SAMPLE_SIZE) return empty;

  // The most recent 25% is diagnostic-only; estimates are never fitted on this tail here.
  const validationSize = Math.max(20, Math.floor(observations.length * 0.25));
  const validation = observations.slice(-validationSize);
  const probabilities = validation.map(item => item.prediction.calibratedProbability as number);
  const labels = validation.map(item => item.outcome.result === "WIN" ? 1 : 0);
  const brier = probabilities.reduce((sum, p, index) => sum + (p - labels[index]) ** 2, 0) / validation.length;
  const meanPredicted = probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length;
  const observed = labels.reduce((sum, value) => sum + value, 0) / labels.length;

  const paired = probabilities.map((probability, index) => ({ probability, label: labels[index] }))
    .sort((a, b) => a.probability - b.probability);
  const bins = Math.min(10, Math.max(1, Math.floor(paired.length / 10)));
  let ece = 0;
  for (let bin = 0; bin < bins; bin++) {
    const start = Math.floor(bin * paired.length / bins);
    const end = Math.floor((bin + 1) * paired.length / bins);
    const slice = paired.slice(start, end);
    if (!slice.length) continue;
    const averageProbability = slice.reduce((sum, item) => sum + item.probability, 0) / slice.length;
    const observedRate = slice.reduce((sum, item) => sum + item.label, 0) / slice.length;
    ece += slice.length / paired.length * Math.abs(averageProbability - observedRate);
  }

  const gap = Math.abs(meanPredicted - observed);
  return {
    status: gap >= 0.1 || ece >= 0.1 || brier >= 0.25 ? "CALIBRATION_WARNING" : "MEASURED",
    sampleSize: observations.length,
    validationSampleSize: validation.length,
    brierScore: Number(brier.toFixed(5)),
    expectedCalibrationError: Number(ece.toFixed(5)),
    meanPredictedProbability: Number(meanPredicted.toFixed(5)),
    observedWinRate: Number(observed.toFixed(5)),
    calibrationGap: Number(gap.toFixed(5)),
    evaluatedAtUtc: new Date(nowMs).toISOString(),
  };
}

function forecastPathDiagnostics(
  predictions: ResearchPredictionRecord[],
  outcomes: ResearchOutcomeRecord[],
  nowMs: number
): ForecastPathDiagnostics {
  const byId = new Map(predictions.map(item => [item.id, item]));
  let sampleSize = 0;
  let matchedPoints = 0;
  let covered = 0;
  const absoluteErrorsPips: number[] = [];

  for (const outcome of outcomes) {
    if (outcome.source !== "MARKET_DATA_REPLAY" || !outcome.actualPath.length) continue;
    const prediction = byId.get(outcome.predictionId);
    if (!prediction || prediction.source !== "OPPORTUNITY" || !prediction.forecastPoints.length) continue;
    sampleSize++;
    const pipSize = prediction.symbol.includes("JPY") ? 0.01 : 0.0001;
    const forecastByMinute = new Map(prediction.forecastPoints.map(point => [point.minute, point]));
    for (const actual of outcome.actualPath) {
      const point = forecastByMinute.get(actual.minute);
      if (!point || !Number.isFinite(actual.price)) continue;
      matchedPoints++;
      if (actual.price >= point.q10 && actual.price <= point.q90) covered++;
      absoluteErrorsPips.push(Math.abs(actual.price - point.median) / pipSize);
    }
  }

  return {
    status: sampleSize >= 50 && matchedPoints >= 500 ? "MEASURED" : "COLLECTING",
    sampleSize,
    matchedPoints,
    q10ToQ90Coverage: matchedPoints ? Number((covered / matchedPoints).toFixed(5)) : null,
    medianAbsoluteErrorPips: absoluteErrorsPips.length
      ? Number(absoluteErrorsPips.slice().sort((a, b) => a - b)[Math.floor(absoluteErrorsPips.length / 2)].toFixed(3))
      : null,
    evaluatedAtUtc: new Date(nowMs).toISOString(),
  };
}

function summarizeModels(
  predictions: ResearchPredictionRecord[],
  outcomes: ResearchOutcomeRecord[],
  champions: ResearchChampionRecord[]
): ModelEvidenceSummary[] {
  const predictionsByStreamAndModel = new Map<string, ResearchPredictionRecord[]>();
  for (const prediction of predictions) {
    if (prediction.direction === "NO_TRADE") continue;
    const stream = evidenceStream(prediction.source);
    const key = stream + "|" + prediction.modelVersion;
    if (!predictionsByStreamAndModel.has(key)) predictionsByStreamAndModel.set(key, []);
    predictionsByStreamAndModel.get(key)!.push(prediction);
  }

  const outcomeByPrediction = new Map(outcomes.map(item => [item.predictionId, item]));
  const provisional: ModelEvidenceSummary[] = [];
  for (const [key, modelPredictions] of predictionsByStreamAndModel) {
    const [streamText, modelVersion] = key.split("|");
    const stream = streamText as ResearchEvidenceStream;
    const modelOutcomes = modelPredictions
      .map(prediction => outcomeByPrediction.get(prediction.id))
      .filter((item): item is ResearchOutcomeRecord => !!item)
      .sort((a, b) => Date.parse(a.settledAtUtc) - Date.parse(b.settledAtUtc));
    const decisive = modelOutcomes.filter(item => item.result === "WIN" || item.result === "LOSS");
    const wins = decisive.filter(item => item.result === "WIN").length;
    const losses = decisive.length - wins;
    const scratches = modelOutcomes.filter(item => item.result === "SCRATCH").length;
    const payoutValues = decisive.map(item => item.payoutPct).filter((value): value is number =>
      value !== null && Number.isFinite(value) && value > 0
    );
    const minimumPayoutPct = payoutValues.length ? Math.min(...payoutValues) : null;
    const breakEven = minimumPayoutPct === null ? null : 1 / (1 + minimumPayoutPct / 100);
    const winRate = decisive.length ? wins / decisive.length : null;
    const adjustedLowerBound = wilsonLowerBound(wins, decisive.length, MODEL_PROMOTION_WILSON_Z);
    const measuredReturns = decisive.map(item => item.returnUnits).filter((value): value is number =>
      value !== null && Number.isFinite(value)
    );
    const meanReturn = measuredReturns.length
      ? measuredReturns.reduce((sum, value) => sum + value, 0) / measuredReturns.length
      : null;
    const positive = measuredReturns.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
    const negative = Math.abs(measuredReturns.filter(value => value < 0).reduce((sum, value) => sum + value, 0));
    const profitFactor = measuredReturns.length && negative > 0
      ? positive / negative
      : measuredReturns.length && positive > 0 ? null : null;
    const lastThreeHundred = decisive.slice(-300);
    const blockRates = lastThreeHundred.length === 300
      ? [0, 1, 2].map(block => {
          const slice = lastThreeHundred.slice(block * 100, (block + 1) * 100);
          return slice.filter(item => item.result === "WIN").length / 100;
        })
      : [];
    const champion = champions.find(item => item.stream === stream);
    let promotionStatus: ModelPromotionStatus = "INSUFFICIENT_EVIDENCE";
    const promotionReasons: string[] = [];
    if (decisive.length < MIN_CHAMPION_SAMPLE_SIZE) {
      promotionReasons.push(`Need ${MIN_CHAMPION_SAMPLE_SIZE} decisive forward outcomes; ${decisive.length} recorded.`);
    } else if (minimumPayoutPct === null || minimumPayoutPct < 80 || !breakEven ||
      adjustedLowerBound === null || meanReturn === null || measuredReturns.length !== decisive.length ||
      profitFactor === null) {
      promotionStatus = "REJECTED";
      promotionReasons.push("Payout-adjusted returns or a conservative confidence bound are unavailable; this model cannot be promoted.");
    } else if (
      adjustedLowerBound <= breakEven ||
      meanReturn <= 0 ||
      profitFactor <= 1.1 ||
      blockRates.length !== 3 ||
      blockRates.some(rate => rate <= breakEven)
    ) {
      promotionStatus = "REJECTED";
      promotionReasons.push("The conservative lower bound, expected return, profit factor or one of the last three 100-outcome blocks failed the promotion gate.");
    } else if (champion?.modelVersion === modelVersion) {
      promotionStatus = "CURRENT_CHAMPION";
      promotionReasons.push("This is the manually approved champion. Continued monitoring remains required.");
    } else if (champion) {
      const championPredictions = predictionsByStreamAndModel.get(stream + "|" + champion.modelVersion) || [];
      const championOutcomes = championPredictions
        .map(prediction => outcomeByPrediction.get(prediction.id))
        .filter((item): item is ResearchOutcomeRecord => !!item && item.returnUnits !== null &&
          (item.result === "WIN" || item.result === "LOSS"))
        .sort((a, b) => Date.parse(a.settledAtUtc) - Date.parse(b.settledAtUtc));
      const championEv = championOutcomes.length
        ? championOutcomes.reduce((sum, item) => sum + (item.returnUnits as number), 0) / championOutcomes.length
        : null;
      if (championEv === null || meanReturn <= championEv + 0.01) {
        promotionStatus = "DOES_NOT_BEAT_CHAMPION";
        promotionReasons.push("Absolute evidence gates passed, but the challenger has not cleared the 0.01 stake-unit/trade improvement margin over the current champion.");
      } else {
        promotionStatus = "REVIEW_READY";
        promotionReasons.push("Independent forward sample, conservative confidence, payout-adjusted returns and three recent blocks pass. Human approval is still required.");
      }
    } else {
      promotionStatus = "REVIEW_READY";
      promotionReasons.push("Independent forward sample, conservative confidence, payout-adjusted returns and three recent blocks pass. Human approval is still required.");
    }

    provisional.push({
      stream,
      modelVersion,
      predictionCount: modelPredictions.length,
      settledCount: modelOutcomes.length,
      decisiveCount: decisive.length,
      wins,
      losses,
      scratches,
      winRate: winRate === null ? null : Number(winRate.toFixed(5)),
      minimumPayoutPct,
      breakEvenWinRate: breakEven,
      adjustedLowerBound,
      meanReturnUnits: meanReturn === null ? null : Number(meanReturn.toFixed(5)),
      profitFactor: profitFactor === null ? null : Number(profitFactor.toFixed(5)),
      lastThreeHundredBlockWinRates: blockRates.map(rate => Number(rate.toFixed(5))),
      promotionStatus,
      promotionReasons,
      lastOutcomeAtUtc: modelOutcomes.length ? modelOutcomes[modelOutcomes.length - 1].settledAtUtc : null,
    });
  }
  return provisional.sort((a, b) =>
    (a.promotionStatus === "CURRENT_CHAMPION" ? -1 : 0) -
      (b.promotionStatus === "CURRENT_CHAMPION" ? -1 : 0) ||
    b.decisiveCount - a.decisiveCount
  );
}

function regimeEvidence(
  predictions: ResearchPredictionRecord[],
  outcomes: ResearchOutcomeRecord[]
): RegimeEvidenceSummary[] {
  const byPrediction = new Map(predictions.map(item => [item.id, item]));
  const groups = new Map<string, { stream: ResearchEvidenceStream; regime: ResearchRegimeLabel; outcomes: ResearchOutcomeRecord[] }>();
  for (const outcome of outcomes) {
    const prediction = byPrediction.get(outcome.predictionId);
    if (!prediction || (outcome.result !== "WIN" && outcome.result !== "LOSS" && outcome.result !== "SCRATCH")) continue;
    const stream = evidenceStream(prediction.source);
    const regime = prediction.marketRegimeAtPrediction;
    const key = stream + "|" + regime;
    if (!groups.has(key)) groups.set(key, { stream, regime, outcomes: [] });
    groups.get(key)!.outcomes.push(outcome);
  }
  return [...groups.values()].map(group => {
    const decisive = group.outcomes.filter(item => item.result !== "SCRATCH");
    const wins = decisive.filter(item => item.result === "WIN").length;
    const returns = group.outcomes.map(item => item.returnUnits).filter((value): value is number =>
      value !== null && Number.isFinite(value)
    );
    return {
      stream: group.stream,
      regime: group.regime,
      sampleSize: group.outcomes.length,
      wins,
      losses: decisive.length - wins,
      scratches: group.outcomes.length - decisive.length,
      winRate: decisive.length ? Number((wins / decisive.length).toFixed(5)) : null,
      meanReturnUnits: returns.length
        ? Number((returns.reduce((sum, value) => sum + value, 0) / returns.length).toFixed(5))
        : null,
    };
  }).sort((a, b) => b.sampleSize - a.sampleSize);
}

function failureClusters(
  predictions: ResearchPredictionRecord[],
  outcomes: ResearchOutcomeRecord[]
): ResearchFailureCluster[] {
  const byPrediction = new Map(predictions.map(item => [item.id, item]));
  const groups = new Map<string, { stream: ResearchEvidenceStream; family: string; regime: ResearchRegimeLabel; losses: number; count: number }>();
  for (const outcome of outcomes) {
    if (outcome.result !== "WIN" && outcome.result !== "LOSS") continue;
    const prediction = byPrediction.get(outcome.predictionId);
    if (!prediction) continue;
    const stream = evidenceStream(prediction.source);
    const family = prediction.family;
    const regime = prediction.marketRegimeAtPrediction;
    const key = [stream, family, regime].join("|");
    const group = groups.get(key) || { stream, family, regime, losses: 0, count: 0 };
    group.count++;
    if (outcome.result === "LOSS") group.losses++;
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter(group => group.count >= 20 && group.losses >= 5)
    .map(group => ({
      stream: group.stream,
      family: group.family,
      regime: group.regime,
      sampleSize: group.count,
      losses: group.losses,
      observedLossShare: Number((group.losses / group.count).toFixed(5)),
      note: "Observed concentration only. This is not a proven causal explanation.",
    }))
    .sort((a, b) => b.losses - a.losses)
    .slice(0, 20);
}

export function buildResearchIntelligenceDashboard(args: {
  predictions: ResearchPredictionRecord[];
  outcomes: ResearchOutcomeRecord[];
  regimes: ResearchMarketRegime[];
  champions: ResearchChampionRecord[];
  championHistory: ResearchIntelligenceDashboard["championHistory"];
  simulations: PaperExecutionSimulationResult[];
  nowMs?: number;
}): ResearchIntelligenceDashboard {
  const nowMs = args.nowMs ?? Date.now();
  const outcomeIds = new Set(args.outcomes.map(item => item.predictionId));
  const signalPredictions = args.predictions.filter(item => item.source === "SIGNAL").length;
  const opportunityPredictions = args.predictions.filter(item => item.source === "OPPORTUNITY").length;
  const signalOutcomes = args.outcomes.filter(item => item.source === "SIGNAL_SETTLEMENT_RECORD").length;
  const opportunityOutcomes = args.outcomes.filter(item => item.source === "MARKET_DATA_REPLAY").length;
  return {
    predictionCount: args.predictions.length,
    settledCount: args.outcomes.length,
    pendingCount: args.predictions.filter(item => !outcomeIds.has(item.id)).length,
    signalPredictionCount: signalPredictions,
    opportunityPredictionCount: opportunityPredictions,
    signalOutcomeCount: signalOutcomes,
    opportunityOutcomeCount: opportunityOutcomes,
    calibration: calibrationDiagnostics(args.predictions, args.outcomes, nowMs),
    forecastDiagnostics: forecastPathDiagnostics(args.predictions, args.outcomes, nowMs),
    modelEvidence: summarizeModels(args.predictions, args.outcomes, args.champions),
    regimeEvidence: regimeEvidence(args.predictions, args.outcomes),
    failureClusters: failureClusters(args.predictions, args.outcomes),
    regimes: args.regimes,
    champions: args.champions,
    championHistory: args.championHistory.slice(0, 50),
    recentPredictions: args.predictions.slice().sort((a, b) =>
      Date.parse(b.decisionTimeUtc) - Date.parse(a.decisionTimeUtc)
    ).slice(0, 100),
    recentOutcomes: args.outcomes.slice().sort((a, b) =>
      Date.parse(b.settledAtUtc) - Date.parse(a.settledAtUtc)
    ).slice(0, 100),
    simulations: args.simulations.slice(0, 50),
    generatedAtUtc: new Date(nowMs).toISOString(),
  };
}

export function simulatePaperExecution(
  input: PaperExecutionSimulationInput,
  nowMs = Date.now()
): PaperExecutionSimulationResult {
  const values = [
    input.referenceEntryPrice,
    input.expiryPrice,
    input.payoutPct,
    input.stakeUnits,
    input.spreadPips,
    input.slippagePips,
    input.maximumSlippagePips,
    input.entryLatencyMs,
    input.maximumDecisionDelayMs,
  ];
  if (values.some(value => !Number.isFinite(value)) ||
      !finitePositive(input.referenceEntryPrice) ||
      !finitePositive(input.expiryPrice) ||
      input.payoutPct <= 0 || input.payoutPct > 500 ||
      input.stakeUnits <= 0 || input.stakeUnits > 1_000_000 ||
      input.spreadPips < 0 || input.slippagePips < 0 ||
      input.maximumSlippagePips < 0 ||
      input.entryLatencyMs < 0 || input.maximumDecisionDelayMs <= 0) {
    throw new Error("Simulation inputs must be finite and positive where required; payout must be 0–500% and friction cannot be negative.");
  }

  const frictionPips = input.spreadPips / 2 + input.slippagePips;
  let status: PaperExecutionSimulationResult["status"] = "SETTLED";
  if (!input.assetAvailable) status = "ASSET_UNAVAILABLE";
  else if (input.brokerRejected) status = "BROKER_REJECTED";
  else if (input.entryLatencyMs > input.maximumDecisionDelayMs) status = "MISSED_DECISION_WINDOW";
  else if (input.slippagePips > input.maximumSlippagePips) status = "SLIPPAGE_LIMIT";

  const pipSize = input.symbol.includes("JPY") ? 0.01 : 0.0001;
  const adjustment = frictionPips * pipSize;
  const simulatedEntryPrice = input.referenceEntryPrice +
    (input.direction === "BUY" ? adjustment : -adjustment);
  if (!finitePositive(simulatedEntryPrice)) {
    throw new Error("Friction assumptions produce a non-positive simulated entry price.");
  }

  let result: ResearchOutcomeResult | null = null;
  let returnUnits: number | null = null;
  if (status === "SETTLED") {
    result = input.direction === "BUY"
      ? input.expiryPrice > simulatedEntryPrice ? "WIN" : input.expiryPrice < simulatedEntryPrice ? "LOSS" : "SCRATCH"
      : input.expiryPrice < simulatedEntryPrice ? "WIN" : input.expiryPrice > simulatedEntryPrice ? "LOSS" : "SCRATCH";
    returnUnits = result === "WIN" ? input.payoutPct / 100 : result === "LOSS" ? -1 : 0;
  }

  const assumptions = [
    "User-entered scenario only; this does not call a broker or place an order.",
    "Spread is charged as half-spread against the simulated entry; slippage is adverse.",
    "Expiry settlement uses the user-entered expiry price, not a guaranteed broker fill.",
    "Payout is an assumption unless independently replaced with a recorded broker-observed value.",
    "Latency beyond the configured decision window is treated as a missed entry.",
  ];
  const fingerprint = stableHash(JSON.stringify({ input, nowMs }));
  return {
    id: "sim_" + fingerprint,
    input: { ...input },
    status,
    simulatedEntryPrice: status === "SETTLED" ? Number(simulatedEntryPrice.toPrecision(12)) : null,
    frictionPips: Number(frictionPips.toFixed(4)),
    result,
    returnUnits,
    pnlUnits: returnUnits === null ? null : Number((returnUnits * input.stakeUnits).toFixed(6)),
    assumptions,
    simulatedAtUtc: new Date(nowMs).toISOString(),
    executionEnabled: false,
  };
}
