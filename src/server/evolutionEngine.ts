import type {
  Candle,
  MarketSessionId,
  StrategyExpressionNode,
  StrategyFeatureName,
  StrategyGenome,
  StrategyDiscoveryMetrics,
  StrategyPaperMetrics,
  RuleFamily,
} from "../types/index.js";

export type StrategyStyle = "TREND" | "MEAN_REVERSION" | "HYBRID" | "UNKNOWN";
export type MarketRegime =
  | "HIGH_TREND_BREAKOUT"
  | "LOW_VOL_ASIA"
  | "RANGE"
  | "MIXED"
  | "UNKNOWN";

export interface RegimeAssessment {
  regime: MarketRegime;
  directionalEfficiency: number | null;
  atrRatio: number | null;
  observationCount: number;
  reason: string;
}

export interface MarketRegimeSnapshot extends RegimeAssessment {
  symbol: string;
  session: MarketSessionId;
  assessedAt: string;
}

export interface ResearchHoldoutWindow {
  symbol: string;
  startUtc: string;
  endUtc: string;
}

/** Inclusive interval intersection; malformed stored windows are ignored safely. */
export function doesResearchHoldoutOverlap(
  windows: ResearchHoldoutWindow[],
  symbol: string,
  startMs: number,
  endMs: number
): boolean {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("Holdout interval must be finite and chronological.");
  }
  return windows.some(window => {
    if (window.symbol !== symbol) return false;
    const existingStart = Date.parse(window.startUtc);
    const existingEnd = Date.parse(window.endUtc);
    if (!Number.isFinite(existingStart) || !Number.isFinite(existingEnd) || existingEnd <= existingStart) {
      return false;
    }
    return startMs <= existingEnd && endMs >= existingStart;
  });
}

export interface EvolutionParentCandidate {
  id: string;
  genome?: StrategyGenome;
  discoveryMetrics?: StrategyDiscoveryMetrics;
  /** Measured outcomes from the latest unique forward-paper sample. */
  paperMetrics?: StrategyPaperMetrics;
}

/**
 * Parent selection is restricted to frozen train/validation evidence.
 * Holdout metrics are deliberately not part of this function's type or ranking.
 */
function collectGenomeFeatures(expression: StrategyExpressionNode): StrategyFeatureName[] {
  const features = new Set<StrategyFeatureName>();
  const visit = (node: StrategyExpressionNode): void => {
    if (node.kind === "feature") {
      features.add(node.feature);
    } else if (node.kind === "unary") {
      visit(node.input);
    } else if (node.kind === "binary") {
      visit(node.left);
      visit(node.right);
    }
  };
  visit(expression);
  return [...features].sort();
}

/** Coarse strategy species preserve different feature families during selection. */
export function genomeSpeciesKey(genome?: StrategyGenome): string {
  if (!genome) return "UNKNOWN";
  const features = collectGenomeFeatures(genome.expression);
  const style = inferGenomeStyle(genome.expression);
  return style + ":" + (features.slice(0, 4).join(",") || "constant");
}

const MIN_FORWARD_PARENT_SAMPLE = 100;

/** Binary break-even probability at the worst payout observed in the paper sample. */
export function binaryBreakEvenWinRate(payoutPct: number): number {
  if (!Number.isFinite(payoutPct) || payoutPct <= 0) return 1;
  return 1 / (1 + payoutPct / 100);
}

/**
 * Forward evidence is allowed to influence parent selection only after 100
 * scored outcomes and only when its lower Wilson bound clears the actual
 * payout break-even rate. Small samples cannot rewrite the genome population.
 */
export function hasSufficientForwardParentEvidence(
  paper?: StrategyPaperMetrics
): boolean {
  if (!paper || paper.scoredTrades < MIN_FORWARD_PARENT_SAMPLE) return false;
  if (
    !Number.isFinite(paper.winRate) ||
    !Number.isFinite(paper.netReturnUnits) ||
    !Number.isFinite(paper.profitFactor) ||
    !Number.isFinite(paper.minimumPayoutPct) ||
    !Array.isArray(paper.confidenceInterval95) ||
    paper.confidenceInterval95.length !== 2 ||
    !paper.confidenceInterval95.every(Number.isFinite)
  ) return false;
  const breakEven = binaryBreakEvenWinRate(paper.minimumPayoutPct);
  return paper.minimumPayoutPct >= 80 &&
    paper.netReturnUnits > 0 &&
    paper.profitFactor >= 1.15 &&
    paper.winRate > breakEven &&
    paper.confidenceInterval95[0] > breakEven;
}

/** Blend frozen discovery EV with mature forward EV; never uses untouched-test metrics. */
export function evolutionaryParentFitness(candidate: EvolutionParentCandidate): number {
  const discoveryEv = candidate.discoveryMetrics?.validationExpectedValueUnits ?? 0;
  const paper = candidate.paperMetrics;
  if (!paper || !hasSufficientForwardParentEvidence(paper)) return discoveryEv;
  const forwardEvPerTrade = paper.netReturnUnits / Math.max(1, paper.scoredTrades);
  const forwardWeight = Math.min(0.75, paper.scoredTrades / (paper.scoredTrades + 100));
  return (discoveryEv * (1 - forwardWeight)) + (forwardEvPerTrade * forwardWeight);
}

function compareParentFitness(a: EvolutionParentCandidate, b: EvolutionParentCandidate): number {
  return (
    (evolutionaryParentFitness(b) - evolutionaryParentFitness(a)) ||
    (b.discoveryMetrics!.validationWinRate - a.discoveryMetrics!.validationWinRate) ||
    (b.discoveryMetrics!.validationProfitFactor - a.discoveryMetrics!.validationProfitFactor) ||
    (a.genome!.complexity - b.genome!.complexity)
  );
}

/**
 * One-sided Wilson lower confidence bound for a binomial win rate.
 * The wins argument may be fractional when reconstructed from a stored rate.
 */
export function wilsonLowerBound(wins: number, sampleSize: number, z = 1.96): number {
  if (!Number.isFinite(wins) || !Number.isFinite(sampleSize) ||
      !Number.isFinite(z) || sampleSize <= 0 || z <= 0) return 0;
  const n = sampleSize;
  const p = Math.max(0, Math.min(1, wins / n));
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) / n) + z2 / (4 * n * n));
  return Math.max(0, Math.min(1, (center - margin) / denominator));
}

/** True only when the entire trade outcome is contained inside one time partition. */
export function outcomeFitsResearchWindow(
  entryTimeMs: number,
  horizonMinutes: number,
  windowStartMs: number,
  windowEndMs: number
): boolean {
  if (![entryTimeMs, horizonMinutes, windowStartMs, windowEndMs].every(Number.isFinite) ||
      horizonMinutes <= 0 || windowEndMs <= windowStartMs) return false;
  const exitTimeMs = entryTimeMs + horizonMinutes * 60_000;
  return entryTimeMs >= windowStartMs && exitTimeMs <= windowEndMs;
}

/**
 * Select validation-qualified parents while preserving distinct symbolic species.
 * Selection is payout-aware: the validation lower confidence bound must clear
 * the binary-contract break-even rate, and expectancy/profit factor must be positive.
 * Mature forward paper evidence can disqualify a once-promising parent, or
 * gradually influence its fitness. Historical holdout metrics are not accepted.
 */
export function selectEvolutionParents<T extends EvolutionParentCandidate>(
  candidates: T[],
  limit = 30
): T[] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Evolution parent limit must be a positive integer.");
  }
  const ranked = candidates
    .filter(candidate => {
      const metrics = candidate.discoveryMetrics;
      if (!candidate.genome ||
          !metrics ||
          metrics.trainScoredTrades < 150 ||
          metrics.validationScoredTrades < 150 ||
          !Number.isFinite(metrics.validationWinRate) ||
          !Number.isFinite(metrics.validationExpectedValueUnits) ||
          metrics.validationExpectedValueUnits <= 0 ||
          !Number.isFinite(metrics.validationProfitFactor) ||
          metrics.validationProfitFactor < 1.15 ||
          !Number.isFinite(metrics.minimumPayoutPct) ||
          (metrics.minimumPayoutPct ?? 0) < 80) return false;
      const breakEven = binaryBreakEvenWinRate(metrics.minimumPayoutPct ?? 0);
      const validationLowerBound = wilsonLowerBound(
        metrics.validationWinRate * metrics.validationScoredTrades,
        metrics.validationScoredTrades
      );
      if (validationLowerBound <= breakEven) return false;

      // A mature negative/uncertain live-paper record removes this genome
      // from reproduction; a small noisy record does not.
      if (candidate.paperMetrics &&
          candidate.paperMetrics.scoredTrades >= MIN_FORWARD_PARENT_SAMPLE &&
          !hasSufficientForwardParentEvidence(candidate.paperMetrics)) {
        return false;
      }
      return true;
    })
    .sort(compareParentFitness);

  const selected: T[] = [];
  const selectedIds = new Set<string>();
  const representedSpecies = new Set<string>();
  // First pass protects novelty: one high-fitness representative per species.
  for (const candidate of ranked) {
    const species = genomeSpeciesKey(candidate.genome);
    if (representedSpecies.has(species)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
    representedSpecies.add(species);
    if (selected.length >= limit) return selected;
  }
  // Fill remaining slots with the best qualified candidates across species.
  for (const candidate of ranked) {
    if (selectedIds.has(candidate.id)) continue;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

/**
 * Adaptive mutation pressure: low population diversity or near-identical
 * validation fitness increases exploration. The result is bounded to avoid
 * destructive randomization or premature convergence.
 */
export function calculateAdaptiveMutationRate(
  parents: EvolutionParentCandidate[]
): number {
  const eligible = parents.filter(parent =>
    !!parent.genome &&
    !!parent.discoveryMetrics &&
    Number.isFinite(parent.discoveryMetrics.validationExpectedValueUnits)
  );
  if (eligible.length < 4) return 0.30;

  const speciesCount = new Set(eligible.map(parent => genomeSpeciesKey(parent.genome))).size;
  const diversity = speciesCount / eligible.length;
  const fitness = eligible.map(parent => evolutionaryParentFitness(parent));
  const mean = fitness.reduce((sum, value) => sum + value, 0) / fitness.length;
  const variance = fitness.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / fitness.length;
  const coefficientOfVariation = Math.sqrt(variance) / Math.max(0.05, Math.abs(mean));
  const diversityPressure = (1 - diversity) * 0.16;
  const stagnationPressure = coefficientOfVariation < 0.12
    ? 0.08
    : coefficientOfVariation < 0.25
      ? 0.04
      : 0;
  const rate = 0.12 + diversityPressure + stagnationPressure;
  return Number(Math.max(0.12, Math.min(0.36, rate)).toFixed(3));
}

export interface BetaPosterior {
  alpha: number;
  beta: number;
}

export interface EpisodicTradeMemory {
  signalId: string;
  symbol: string;
  direction: "BUY" | "SELL";
  ruleFamily: string;
  featureVector: number[];
  outcome: "WIN" | "LOSS";
  netReturnUnits: number;
  closedAt: string;
}

export interface NeighborMatch extends EpisodicTradeMemory {
  distance: number;
}

export interface NeighborAssessment {
  status: "INSUFFICIENT_HISTORY" | "WEAK_SIMILARITY" | "NEGATIVE_EXPECTANCY" | "SUPPORTIVE";
  neighborsFound: number;
  requiredNeighbors: number;
  meanDistance: number | null;
  maximumDistance: number | null;
  weightedExpectedReturnUnits: number | null;
  winRate: number | null;
  veto: boolean;
  matches: NeighborMatch[];
  reason: string;
}

export const FEATURE_VECTOR_LENGTH = 19;
export const DEFAULT_NEIGHBOR_COUNT = 10;
export const DEFAULT_MAX_NEIGHBOR_RMS_DISTANCE = 0.55;

export function updateBetaPosterior(
  posterior: BetaPosterior,
  outcome: "WIN" | "LOSS" | "SCRATCH"
): BetaPosterior {
  if (!Number.isFinite(posterior.alpha) || posterior.alpha <= 0 ||
      !Number.isFinite(posterior.beta) || posterior.beta <= 0) {
    throw new Error("Beta posterior parameters must be finite and strictly positive.");
  }
  if (outcome === "WIN") return { alpha: posterior.alpha + 1, beta: posterior.beta };
  if (outcome === "LOSS") return { alpha: posterior.alpha, beta: posterior.beta + 1 };
  return { alpha: posterior.alpha, beta: posterior.beta };
}

export function betaPosteriorMean(posterior: BetaPosterior): number {
  const total = posterior.alpha + posterior.beta;
  if (!Number.isFinite(total) || total <= 0) return 0.5;
  return posterior.alpha / total;
}

/** Bayesian upper-confidence score: posterior mean plus an uncertainty bonus. */
export function bayesianUcbScore(
  posterior: BetaPosterior,
  totalObservedDecisions: number
): number {
  const observations = Math.max(0, posterior.alpha + posterior.beta - 2);
  const mean = betaPosteriorMean(posterior);
  const bonus = 0.35 * Math.sqrt(Math.log(Math.max(2, totalObservedDecisions + 2)) / (observations + 1));
  return mean + bonus;
}

export function inferGenomeStyle(expression?: StrategyExpressionNode): StrategyStyle {
  if (!expression) return "UNKNOWN";
  const trendFeatures = new Set<StrategyFeatureName>([
    "return_1", "return_3", "return_5", "return_13",
    "ema_spread", "ema_curvature", "directional_efficiency", "range_expansion",
  ]);
  const meanReversionFeatures = new Set<StrategyFeatureName>([
    "wick_imbalance", "rsi_centered", "rsi_momentum",
    "range_position_13", "range_position_34",
  ]);
  let trend = 0;
  let meanReversion = 0;
  const visit = (node: StrategyExpressionNode): void => {
    if (node.kind === "feature") {
      if (trendFeatures.has(node.feature)) trend += 1;
      if (meanReversionFeatures.has(node.feature)) meanReversion += 1;
      return;
    }
    if (node.kind === "unary") {
      visit(node.input);
      return;
    }
    if (node.kind === "binary") {
      visit(node.left);
      visit(node.right);
    }
  };
  visit(expression);
  if (trend === 0 && meanReversion === 0) return "UNKNOWN";
  if (trend >= meanReversion + 2) return "TREND";
  if (meanReversion >= trend + 2) return "MEAN_REVERSION";
  return "HYBRID";
}

/** Map the expressed genome's feature composition into an observed family bucket. */
export function inferGenomeRuleFamily(expression?: StrategyExpressionNode): RuleFamily {
  switch (inferGenomeStyle(expression)) {
    case "TREND":
      return "momentum_5";
    case "MEAN_REVERSION":
      return "mean_reversion_20";
    case "HYBRID":
      return "wick_reversal";
    default:
      return "volatility_squeeze";
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function trueRange(candle: Candle, previousClose: number): number {
  return Math.max(
    0,
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose)
  );
}

export function classifyMarketRegime(
  inputCandles: Candle[],
  session: MarketSessionId
): RegimeAssessment {
  const ordered = [...inputCandles]
    .filter(c => Number.isFinite(c.timestampMs) && Number.isFinite(c.open) &&
      Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close) &&
      c.high >= c.low && c.high >= Math.max(c.open, c.close) &&
      c.low <= Math.min(c.open, c.close))
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .filter((c, index, rows) => index === 0 || c.timestampMs !== rows[index - 1].timestampMs);

  if (ordered.length < 60) {
    return {
      regime: "UNKNOWN",
      directionalEfficiency: null,
      atrRatio: null,
      observationCount: ordered.length,
      reason: "At least 60 unique valid candles are required for a stable regime comparison.",
    };
  }

  const period = 20;
  const start = ordered.length - period - 1;
  const netMove = Math.abs(ordered[ordered.length - 1].close - ordered[start].close);
  let pathLength = 0;
  for (let i = start + 1; i < ordered.length; i++) {
    pathLength += Math.abs(ordered[i].close - ordered[i - 1].close);
  }
  const efficiency = pathLength > 0 ? netMove / pathLength : 0;

  const ranges = ordered.slice(1).map((candle, index) =>
    trueRange(candle, ordered[index].close)
  );
  const atrPeriod = 14;
  const currentAtr = ranges.slice(-atrPeriod).reduce((sum, value) => sum + value, 0) / atrPeriod;
  const historicalAtr: number[] = [];
  // The baseline must end before the first candle in the current ATR window.
  const lastHistoricalEnd = ranges.length - atrPeriod - 1;
  const firstHistoricalEnd = Math.max(atrPeriod - 1, lastHistoricalEnd - 29);
  for (let end = firstHistoricalEnd; end <= lastHistoricalEnd; end++) {
    const window = ranges.slice(end - atrPeriod + 1, end + 1);
    if (window.length === atrPeriod) {
      historicalAtr.push(window.reduce((sum, value) => sum + value, 0) / atrPeriod);
    }
  }
  const baselineAtr = median(historicalAtr);
  if (!(baselineAtr > 0) || !Number.isFinite(currentAtr)) {
    return {
      regime: "UNKNOWN",
      directionalEfficiency: efficiency,
      atrRatio: null,
      observationCount: ordered.length,
      reason: "Volatility baseline is degenerate; regime gate is not applied.",
    };
  }
  const atrRatio = currentAtr / baselineAtr;

  if (efficiency >= 0.55 && atrRatio >= 1.2) {
    return {
      regime: "HIGH_TREND_BREAKOUT",
      directionalEfficiency: efficiency,
      atrRatio,
      observationCount: ordered.length,
      reason: "Directional efficiency and current ATR expansion both exceed the configured breakout thresholds.",
    };
  }
  if (session === "ASIA" && atrRatio <= 0.75) {
    return {
      regime: "LOW_VOL_ASIA",
      directionalEfficiency: efficiency,
      atrRatio,
      observationCount: ordered.length,
      reason: "Asian session volatility is below 75% of its recent ATR baseline.",
    };
  }
  if (efficiency <= 0.25) {
    return {
      regime: "RANGE",
      directionalEfficiency: efficiency,
      atrRatio,
      observationCount: ordered.length,
      reason: "Net displacement is small relative to the total 20-candle path.",
    };
  }
  return {
    regime: "MIXED",
    directionalEfficiency: efficiency,
    atrRatio,
    observationCount: ordered.length,
    reason: "The market does not meet a high-confidence trend, range, or low-volatility Asian classification.",
  };
}

export function isStrategyRegimeCompatible(
  style: StrategyStyle,
  regime: MarketRegime
): { allowed: boolean; reason: string } {
  if (regime === "UNKNOWN" || regime === "MIXED") {
    return { allowed: true, reason: "Regime evidence is insufficient or mixed; no regime-specific suppression applied." };
  }
  if ((regime === "HIGH_TREND_BREAKOUT" || regime === "LOW_VOL_ASIA") && style === "UNKNOWN") {
    return { allowed: false, reason: "Strategy style cannot be classified safely in an extreme market regime." };
  }
  if (regime === "HIGH_TREND_BREAKOUT" && style === "MEAN_REVERSION") {
    return { allowed: false, reason: "Mean-reversion setup suppressed during a high-efficiency, expanding-volatility breakout." };
  }
  if (regime === "LOW_VOL_ASIA" && style === "TREND") {
    return { allowed: false, reason: "Trend-breakout setup suppressed during low-volatility Asian-session conditions." };
  }
  return { allowed: true, reason: "Strategy style is compatible with the measured market regime." };
}

export function assessNearestNeighbors(
  query: {
    symbol: string;
    direction: "BUY" | "SELL";
    ruleFamily: string;
    featureVector: number[];
    predictionTimeUtc: string;
  },
  memory: EpisodicTradeMemory[],
  options: {
    k?: number;
    maximumRmsDistance?: number;
  } = {}
): NeighborAssessment {
  const k = options.k ?? DEFAULT_NEIGHBOR_COUNT;
  const maximumRmsDistance = options.maximumRmsDistance ?? DEFAULT_MAX_NEIGHBOR_RMS_DISTANCE;
  const predictionTime = Date.parse(query.predictionTimeUtc);
  if (!Number.isFinite(predictionTime) || query.featureVector.length !== FEATURE_VECTOR_LENGTH ||
      !query.featureVector.every(Number.isFinite)) {
    throw new Error("k-NN query requires a valid prediction timestamp and a finite 19-feature vector.");
  }
  if (!Number.isInteger(k) || k < 1 || !Number.isFinite(maximumRmsDistance) || maximumRmsDistance <= 0) {
    throw new Error("k-NN configuration is invalid.");
  }

  const candidates: NeighborMatch[] = [];
  for (const item of memory) {
    if (item.symbol !== query.symbol || item.direction !== query.direction ||
        item.ruleFamily !== query.ruleFamily || item.featureVector.length !== FEATURE_VECTOR_LENGTH ||
        !item.featureVector.every(Number.isFinite) ||
        !Number.isFinite(item.netReturnUnits)) continue;
    const closedAt = Date.parse(item.closedAt);
    // Strictly exclude outcomes that were not known at the decision timestamp.
    if (!Number.isFinite(closedAt) || closedAt >= predictionTime) continue;
    let squared = 0;
    for (let i = 0; i < FEATURE_VECTOR_LENGTH; i++) {
      const delta = query.featureVector[i] - item.featureVector[i];
      squared += delta * delta;
    }
    const distance = Math.sqrt(squared / FEATURE_VECTOR_LENGTH);
    candidates.push({ ...item, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.closedAt.localeCompare(b.closedAt));
  const matches = candidates.slice(0, k);
  const maximumDistance = matches.length ? Math.max(...matches.map(item => item.distance)) : null;
  const meanDistance = matches.length
    ? matches.reduce((sum, item) => sum + item.distance, 0) / matches.length
    : null;

  if (matches.length < k) {
    return {
      status: "INSUFFICIENT_HISTORY",
      neighborsFound: matches.length,
      requiredNeighbors: k,
      meanDistance,
      maximumDistance,
      weightedExpectedReturnUnits: null,
      winRate: null,
      veto: false,
      matches,
      reason: "Not enough earlier settled trades exist in this pair, direction, and strategy family; k-NN remains advisory-neutral.",
    };
  }
  if (maximumDistance !== null && maximumDistance > maximumRmsDistance) {
    return {
      status: "WEAK_SIMILARITY",
      neighborsFound: matches.length,
      requiredNeighbors: k,
      meanDistance,
      maximumDistance,
      weightedExpectedReturnUnits: null,
      winRate: null,
      veto: false,
      matches,
      reason: "The ten nearest historical setups are not sufficiently close to this market context.",
    };
  }

  const weighted = matches.reduce((acc, item) => {
    const weight = 1 / Math.max(0.05, item.distance);
    acc.weight += weight;
    acc.return += weight * item.netReturnUnits;
    if (item.outcome === "WIN") acc.wins += weight;
    return acc;
  }, { weight: 0, return: 0, wins: 0 });
  const expectedReturn = weighted.weight > 0 ? weighted.return / weighted.weight : 0;
  const winRate = weighted.weight > 0 ? weighted.wins / weighted.weight : 0;
  const veto = expectedReturn <= 0;
  return {
    status: veto ? "NEGATIVE_EXPECTANCY" : "SUPPORTIVE",
    neighborsFound: matches.length,
    requiredNeighbors: k,
    meanDistance,
    maximumDistance,
    weightedExpectedReturnUnits: expectedReturn,
    winRate,
    veto,
    matches,
    reason: veto
      ? "The ten sufficiently similar, strictly earlier outcomes have non-positive inverse-distance-weighted binary return."
      : "The ten sufficiently similar, strictly earlier outcomes have positive inverse-distance-weighted binary return.",
  };
}
