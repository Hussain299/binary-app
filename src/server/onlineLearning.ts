/**
 * SignalForge online learner.
 *
 * Inspired by River's prequential learn/predict discipline and adaptive-window
 * drift monitoring. This is a compact TypeScript FTRL-Proximal logistic model.
 * It is permanently shadow-only: its score is telemetry, never a trade gate.
 */

export const ONLINE_LEARNER_VERSION = 'ftrl-logistic-shadow-v1';
export const ONLINE_LEARNER_MIN_REPORTING_SAMPLE = 100;
export const ONLINE_LEARNER_FEATURE_DIMENSIONS = 45;

const MARKET_FEATURE_COUNT = 19;
const SYMBOLS = [
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'EUR/JPY', 'AUD/USD', 'USD/CAD',
  'EUR/GBP', 'AUD/CAD', 'AUD/CHF', 'AUD/JPY', 'AUD/NZD', 'EUR/AUD',
  'EUR/CAD', 'EUR/CHF', 'EUR/NZD', 'GBP/AUD', 'GBP/CAD', 'GBP/CHF',
  'GBP/JPY', 'GBP/NZD',
] as const;
const RULE_FAMILIES = [
  'momentum_5',
  'mean_reversion_20',
  'wick_reversal',
  'volatility_squeeze',
] as const;

const FTRL_ALPHA = 0.05;
const FTRL_BETA = 1;
const FTRL_L1 = 0.0001;
const FTRL_L2 = 0.1;
const MAX_RECENT_ERRORS = 256;
const MIN_DRIFT_SUBWINDOW = 32;
const DRIFT_DELTA = 0.002;

export interface OnlineLearningContext {
  symbol: string;
  direction: 'BUY' | 'SELL';
  ruleFamily: string;
  marketFeatureVector: number[];
}

export interface OnlineLearnerState {
  version: 1;
  z: number[];
  n: number[];
  sampleCount: number;
  wins: number;
  losses: number;
  brierSum: number;
  logLossSum: number;
  recentBrierErrors: number[];
  driftEvents: number;
  lastDriftAt: string | null;
  updatedAt: string | null;
}

export interface OnlinePrediction {
  version: typeof ONLINE_LEARNER_VERSION;
  probability: number;
  sampleSize: number;
  status: 'WARMUP' | 'SHADOW_ONLY';
  isActionable: false;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function sigmoid(value: number): number {
  const safe = clamp(value, -20, 20);
  return 1 / (1 + Math.exp(-safe));
}

function buildContextVector(context: OnlineLearningContext): number[] {
  if (!Array.isArray(context.marketFeatureVector) ||
      context.marketFeatureVector.length !== MARKET_FEATURE_COUNT ||
      !context.marketFeatureVector.every(value => Number.isFinite(value))) {
    throw new Error('Online learning requires a finite 19-dimensional causal market vector.');
  }
  if (context.direction !== 'BUY' && context.direction !== 'SELL') {
    throw new Error('Online learning direction must be BUY or SELL.');
  }

  const symbol = context.symbol.toUpperCase();
  const family = context.ruleFamily;
  return [
    1, // intercept
    ...context.marketFeatureVector.map(value => clamp(value, -1, 1)),
    ...SYMBOLS.map(item => item === symbol ? 1 : 0),
    context.direction === 'BUY' ? 1 : -1,
    ...RULE_FAMILIES.map(item => item === family ? 1 : 0),
  ];
}

export function createInitialOnlineLearnerState(): OnlineLearnerState {
  return {
    version: 1,
    z: Array(ONLINE_LEARNER_FEATURE_DIMENSIONS).fill(0),
    n: Array(ONLINE_LEARNER_FEATURE_DIMENSIONS).fill(0),
    sampleCount: 0,
    wins: 0,
    losses: 0,
    brierSum: 0,
    logLossSum: 0,
    recentBrierErrors: [],
    driftEvents: 0,
    lastDriftAt: null,
    updatedAt: null,
  };
}

/** Defensive migration for state written by an interrupted or older process. */
export function normalizeOnlineLearnerState(value: unknown): OnlineLearnerState {
  const initial = createInitialOnlineLearnerState();
  if (!value || typeof value !== 'object') return initial;
  const candidate = value as Partial<OnlineLearnerState>;
  const validVector = (vector: unknown): vector is number[] =>
    Array.isArray(vector) &&
    vector.length === ONLINE_LEARNER_FEATURE_DIMENSIONS &&
    vector.every(item => Number.isFinite(item));
  const z = validVector(candidate.z) ? [...candidate.z] : initial.z;
  const n = validVector(candidate.n) ? candidate.n.map(item => Math.max(0, item)) : initial.n;
  const recentBrierErrors = Array.isArray(candidate.recentBrierErrors)
    ? candidate.recentBrierErrors.filter(item => Number.isFinite(item) && item >= 0 && item <= 1).slice(-MAX_RECENT_ERRORS)
    : [];
  return {
    version: 1,
    z,
    n,
    sampleCount: Number.isInteger(candidate.sampleCount) && (candidate.sampleCount ?? -1) >= 0 ? candidate.sampleCount! : 0,
    wins: Number.isInteger(candidate.wins) && (candidate.wins ?? -1) >= 0 ? candidate.wins! : 0,
    losses: Number.isInteger(candidate.losses) && (candidate.losses ?? -1) >= 0 ? candidate.losses! : 0,
    brierSum: Number.isFinite(candidate.brierSum) && (candidate.brierSum ?? -1) >= 0 ? candidate.brierSum! : 0,
    logLossSum: Number.isFinite(candidate.logLossSum) && (candidate.logLossSum ?? -1) >= 0 ? candidate.logLossSum! : 0,
    recentBrierErrors,
    driftEvents: Number.isInteger(candidate.driftEvents) && (candidate.driftEvents ?? -1) >= 0 ? candidate.driftEvents! : 0,
    lastDriftAt: typeof candidate.lastDriftAt === 'string' ? candidate.lastDriftAt : null,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : null,
  };
}

function getWeight(state: OnlineLearnerState, index: number): number {
  const z = state.z[index];
  const n = state.n[index];
  if (Math.abs(z) <= FTRL_L1) return 0;
  const sign = z < 0 ? -1 : 1;
  return -(z - sign * FTRL_L1) /
    ((FTRL_BETA + Math.sqrt(n)) / FTRL_ALPHA + FTRL_L2);
}

function predictFromVector(state: OnlineLearnerState, vector: number[]): number {
  let score = 0;
  for (let index = 0; index < vector.length; index++) {
    score += getWeight(state, index) * vector[index];
  }
  return Number(sigmoid(score).toFixed(6));
}

export function predictOnlineOutcome(
  stateInput: OnlineLearnerState,
  context: OnlineLearningContext
): OnlinePrediction {
  const state = normalizeOnlineLearnerState(stateInput);
  const vector = buildContextVector(context);
  return {
    version: ONLINE_LEARNER_VERSION,
    probability: predictFromVector(state, vector),
    sampleSize: state.sampleCount,
    status: state.sampleCount < ONLINE_LEARNER_MIN_REPORTING_SAMPLE ? 'WARMUP' : 'SHADOW_ONLY',
    isActionable: false,
  };
}

/**
 * Hoeffding two-subwindow check in the spirit of ADWIN. It detects a sustained
 * change in recent prequential Brier error; it never resets weights or changes
 * trade eligibility by itself.
 */
function findDriftCut(errors: number[]): number | null {
  if (errors.length < MIN_DRIFT_SUBWINDOW * 2) return null;
  let bestCut: number | null = null;
  let strongestDifference = 0;
  const logTerm = Math.log(4 / DRIFT_DELTA);
  for (let cut = MIN_DRIFT_SUBWINDOW; cut <= errors.length - MIN_DRIFT_SUBWINDOW; cut += 8) {
    const left = errors.slice(0, cut);
    const right = errors.slice(cut);
    const leftMean = left.reduce((sum, item) => sum + item, 0) / left.length;
    const rightMean = right.reduce((sum, item) => sum + item, 0) / right.length;
    const difference = Math.abs(leftMean - rightMean);
    const bound = Math.sqrt(0.5 * logTerm * (1 / left.length + 1 / right.length));
    if (difference > bound && difference > strongestDifference && difference >= 0.12) {
      strongestDifference = difference;
      bestCut = cut;
    }
  }
  return bestCut;
}

/**
 * Update only after a verified WIN/LOSS. decisionProbability is the score
 * frozen at signal creation and is used for prequential metrics. The FTRL
 * gradient uses the current weights when delayed feedback finally arrives.
 */
export function learnOnlineOutcome(
  stateInput: OnlineLearnerState,
  context: OnlineLearningContext,
  outcome: 'WIN' | 'LOSS',
  decisionProbability: number,
  observedAt = new Date().toISOString()
): OnlineLearnerState {
  if (outcome !== 'WIN' && outcome !== 'LOSS') {
    throw new Error('Online learner accepts only verified WIN or LOSS outcomes.');
  }
  if (!Number.isFinite(decisionProbability) || decisionProbability < 0 || decisionProbability > 1) {
    throw new Error('The frozen decision probability must be finite and between zero and one.');
  }
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new Error('Online-learning observation timestamp is invalid.');
  }

  const state = normalizeOnlineLearnerState(stateInput);
  const vector = buildContextVector(context);
  const target = outcome === 'WIN' ? 1 : 0;
  const frozenProbability = clamp(decisionProbability, 1e-6, 1 - 1e-6);
  const brierError = Math.pow(frozenProbability - target, 2);
  const logLoss = -(target * Math.log(frozenProbability) + (1 - target) * Math.log(1 - frozenProbability));

  // The label may arrive after other trades have settled. Score the current
  // model for the gradient, but retain the frozen prediction for evaluation.
  const currentProbability = predictFromVector(state, vector);
  const z = [...state.z];
  const n = [...state.n];
  for (let index = 0; index < vector.length; index++) {
    const weight = getWeight(state, index);
    const gradient = (currentProbability - target) * vector[index];
    const nextN = n[index] + gradient * gradient;
    const sigma = (Math.sqrt(nextN) - Math.sqrt(n[index])) / FTRL_ALPHA;
    z[index] += gradient - sigma * weight;
    n[index] = nextN;
  }

  const recentBrierErrors = [...state.recentBrierErrors, brierError].slice(-MAX_RECENT_ERRORS);
  const driftCut = findDriftCut(recentBrierErrors);
  const driftEvents = state.driftEvents + (driftCut === null ? 0 : 1);
  const retainedErrors = driftCut === null
    ? recentBrierErrors
    : recentBrierErrors.slice(driftCut);

  return {
    version: 1,
    z,
    n,
    sampleCount: state.sampleCount + 1,
    wins: state.wins + (outcome === 'WIN' ? 1 : 0),
    losses: state.losses + (outcome === 'LOSS' ? 1 : 0),
    brierSum: state.brierSum + brierError,
    logLossSum: state.logLossSum + logLoss,
    recentBrierErrors: retainedErrors,
    driftEvents,
    lastDriftAt: driftCut === null ? state.lastDriftAt : observedAt,
    updatedAt: observedAt,
  };
}

export function getOnlineLearnerSummary(stateInput: OnlineLearnerState) {
  const state = normalizeOnlineLearnerState(stateInput);
  const sampleCount = state.sampleCount;
  const meanBrierScore = sampleCount ? state.brierSum / sampleCount : null;
  const meanLogLoss = sampleCount ? state.logLossSum / sampleCount : null;
  return {
    version: ONLINE_LEARNER_VERSION,
    mode: 'SHADOW_ONLY' as const,
    status: sampleCount < ONLINE_LEARNER_MIN_REPORTING_SAMPLE ? 'WARMUP' as const : 'OBSERVING' as const,
    isUsedForTradeSelection: false as const,
    sampleCount,
    wins: state.wins,
    losses: state.losses,
    meanBrierScore: meanBrierScore === null ? null : Number(meanBrierScore.toFixed(5)),
    meanLogLoss: meanLogLoss === null ? null : Number(meanLogLoss.toFixed(5)),
    brierSkillVs50Baseline: meanBrierScore === null ? null : Number((1 - meanBrierScore / 0.25).toFixed(5)),
    logLossSkillVs50Baseline: meanLogLoss === null ? null : Number((1 - meanLogLoss / Math.log(2)).toFixed(5)),
    brier50Baseline: 0.25,
    logLoss50Baseline: Number(Math.log(2).toFixed(5)),
    recentBrierWindow: state.recentBrierErrors.length,
    driftEvents: state.driftEvents,
    lastDriftAt: state.lastDriftAt,
    updatedAt: state.updatedAt,
    minimumReportingSample: ONLINE_LEARNER_MIN_REPORTING_SAMPLE,
  };
}


export interface OnlineReplayRecord {
  signalId: string;
  predictionTimeUtc: string;
  outcomeTimeUtc: string;
  outcome: 'WIN' | 'LOSS';
  context: OnlineLearningContext;
  storedPrediction?: number;
  storedVersion?: string;
}

export interface OnlineReplayResult {
  state: OnlineLearnerState;
  processedSignalIds: string[];
  reconstructedPredictions: number;
  decisionProbabilities: Map<string, number>;
}

/**
 * Deterministic event-time replay. This is intentionally separate from ordinary
 * array-order iteration because several trades can overlap: a result only
 * becomes available at outcomeTimeUtc, not at the time another trade is closed.
 */
export function replayOnlineLearnerHistory(records: OnlineReplayRecord[]): OnlineReplayResult {
  type Event = { timestampMs: number; kind: 'PREDICT' | 'OUTCOME'; record: OnlineReplayRecord };
  const events: Event[] = [];
  for (const record of records) {
    const predictionMs = Date.parse(record.predictionTimeUtc);
    const outcomeMs = Date.parse(record.outcomeTimeUtc);
    if (!record.signalId || !Number.isFinite(predictionMs) ||
        !Number.isFinite(outcomeMs) || outcomeMs <= predictionMs ||
        !['WIN', 'LOSS'].includes(record.outcome)) continue;
    // Validate the vector before inserting events so malformed historical data
    // is skipped rather than aborting the complete replay.
    try {
      buildContextVector(record.context);
    } catch {
      continue;
    }
    events.push({ timestampMs: predictionMs, kind: 'PREDICT', record });
    events.push({ timestampMs: outcomeMs, kind: 'OUTCOME', record });
  }

  events.sort((a, b) =>
    a.timestampMs - b.timestampMs ||
    (a.kind === b.kind
      ? a.record.signalId.localeCompare(b.record.signalId)
      : a.kind === 'PREDICT' ? -1 : 1)
  );

  let state = createInitialOnlineLearnerState();
  const decisionProbabilities = new Map<string, number>();
  const processedSignalIds: string[] = [];
  const processed = new Set<string>();
  let reconstructedPredictions = 0;

  for (const event of events) {
    const record = event.record;
    if (event.kind === 'PREDICT') {
      const hasStoredScore = record.storedVersion === ONLINE_LEARNER_VERSION &&
        Number.isFinite(record.storedPrediction) &&
        record.storedPrediction! >= 0 && record.storedPrediction! <= 1;
      const probability = hasStoredScore
        ? record.storedPrediction!
        : predictOnlineOutcome(state, record.context).probability;
      if (!hasStoredScore) reconstructedPredictions++;
      decisionProbabilities.set(record.signalId, probability);
    } else {
      const probability = decisionProbabilities.get(record.signalId);
      if (probability === undefined || processed.has(record.signalId)) continue;
      state = learnOnlineOutcome(
        state,
        record.context,
        record.outcome,
        probability,
        record.outcomeTimeUtc,
      );
      processed.add(record.signalId);
      processedSignalIds.push(record.signalId);
    }
  }

  return { state, processedSignalIds, reconstructedPredictions, decisionProbabilities };
}
