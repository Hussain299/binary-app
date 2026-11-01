/**
 * Forward-learning ledger.
 * Predictions are immutable snapshots. Outcomes are resolved only from the exact
 * entry/expiry M1 window. Missing or synthetic data is never silently substituted.
 * Research/paper-only: this module contains no broker integration.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Candle, ForexSymbol, OpportunityHistoricalCandle, TradeOpportunity, VerificationTestResult } from '../types/index.js';
import { db } from './db.js';
import { calculateBinarySettlement } from './binarySettlement.js';

export type LearningStatus = 'PENDING' | 'RESOLVED' | 'INVALID_DATA';
export type LearningDirectionOutcome = 'WIN' | 'LOSS' | 'SCRATCH';
export type MarketRegime = 'TRENDING' | 'RANGING' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY' | 'TRANSITIONAL' | 'UNKNOWN';
export type AssetAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
export type BrokerAcceptance = 'ACCEPTED' | 'REJECTED' | 'UNKNOWN';

export interface MarketRegimeSnapshot {
  label: MarketRegime;
  method: 'OHLC_DIAGNOSTIC_V1';
  sampleSize: number;
  directionalEfficiency: number | null;
  relativeVolatility: number | null;
}

export interface LearningExecutionProfile {
  payoutPct: number;
  spreadPips: number | null;
  slippagePips: number | null;
  latencyMs: number | null;
  assetAvailability: AssetAvailability;
  brokerAcceptance: BrokerAcceptance;
}

export interface LearningOutcome {
  resolvedAt: string;
  entryCandleAt: string;
  expiryCandleAt: string;
  entryPrice: number;
  expiryPrice: number;
  directionOutcome: LearningDirectionOutcome;
  referenceReturnUnits: number;
  sourceProviders: string[];
  pathCandleCount: number;
  pathFingerprint: string;
  execution: {
    status: 'REFERENCE_ONLY' | 'SIMULATED' | 'ASSET_UNAVAILABLE' | 'BROKER_REJECTED' | 'PROFILE_INCOMPLETE' | 'LATENCY_NOT_REPLAYABLE';
    reason: string;
    assumedPayoutPct: number;
    adjustedEntryPrice?: number;
    adjustedExpiryPrice?: number;
    simulatedOutcome?: LearningDirectionOutcome;
    simulatedReturnUnits?: number;
  };
}

export interface LearningPrediction {
  id: string;
  opportunityId: string;
  predictionHash: string;
  capturedAt: string;
  snapshotAt: string;
  entryTimeUtc: string;
  expiryTimeUtc: string;
  symbol: ForexSymbol;
  direction: 'BUY' | 'SELL';
  hypothesisType: TradeOpportunity['hypothesisType'];
  hypothesisName: string;
  horizonMinutes: number;
  modelVersion: string;
  datasetFingerprint: string;
  featureSchemaVersion: string;
  dataSource: string;
  marketDataQuality: number;
  snapshotPrice: number;
  proposedEntryReference: number;
  forecastProbability: number | null;
  forecastLowerBound: number | null;
  forecastPoints: TradeOpportunity['forecast']['points'];
  regime: MarketRegimeSnapshot;
  executionProfile: LearningExecutionProfile;
  originalDecision: {
    batchId: string;
    sourceKind: TradeOpportunity['sourceKind'];
    rawHypothesisScore: number;
    activationThreshold: number;
    auditRankScore: number;
    holdoutSampleSize: number;
    holdoutLowerConfidenceBound: number | null;
    humanDecisionAt: string;
    parentOpportunityId?: string;
  };
  status: LearningStatus;
  outcome?: LearningOutcome;
  invalidReason?: string;
}

export interface LearningEvent {
  id: string;
  predictionId: string;
  kind: 'PREDICTION_CAPTURED' | 'OUTCOME_RESOLVED' | 'DATA_INVALIDATED' | 'CHAMPION_CHANGED' | 'EXECUTION_PROFILE_CHANGED';
  occurredAt: string;
  eventHash: string;
  details: Record<string, string | number | boolean | null>;
}

export interface LearningPlatformPersistedState {
  predictions: LearningPrediction[];
  events: LearningEvent[];
  executionProfile: LearningExecutionProfile;
  champions: Record<string, string>;
}

export interface LearningPersistenceAdapter {
  read(): LearningPlatformPersistedState;
  write(state: LearningPlatformPersistedState): void;
}

const TRUSTED_PROVIDERS = new Set(['biquote', 'dukascopy', 'yahoo', 'imported']);
const INVALID_DATA_GRACE_MS = 3 * 60_000;
const M1_MS = 60_000;
const CALIBRATION_MINIMUM = 50;
const PAIRED_PROMOTION_MINIMUM = 50;
const INITIAL_CHAMPION_MINIMUM = 100;

export const DEFAULT_LEARNING_EXECUTION_PROFILE: LearningExecutionProfile = {
  payoutPct: 80,
  spreadPips: null,
  slippagePips: null,
  latencyMs: null,
  assetAvailability: 'UNKNOWN',
  brokerAcceptance: 'UNKNOWN',
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function hashObject(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isTrustedSource(value: string): boolean {
  const normalized = String(value || '').toLowerCase();
  return [...TRUSTED_PROVIDERS].some(provider => normalized.includes(provider)) &&
    !normalized.includes('synthetic') &&
    !normalized.includes('fixture') &&
    !normalized.includes('test');
}

function isTrustedCandle(candle: Candle): boolean {
  return TRUSTED_PROVIDERS.has(candle.source) &&
    Number.isFinite(candle.timestampMs) &&
    finitePositive(candle.open) &&
    finitePositive(candle.high) &&
    finitePositive(candle.low) &&
    finitePositive(candle.close) &&
    candle.high >= Math.max(candle.open, candle.close, candle.low) &&
    candle.low <= Math.min(candle.open, candle.close, candle.high);
}

export function classifyMarketRegime(history: OpportunityHistoricalCandle[]): MarketRegimeSnapshot {
  const bars = [...history].sort((a, b) => a.minuteOffset - b.minuteOffset);
  const valid = bars.filter(bar =>
    finitePositive(bar.open) &&
    finitePositive(bar.high) &&
    finitePositive(bar.low) &&
    finitePositive(bar.close) &&
    bar.high >= Math.max(bar.open, bar.close, bar.low) &&
    bar.low <= Math.min(bar.open, bar.close, bar.high)
  );
  if (valid.length < 30) {
    return { label: 'UNKNOWN', method: 'OHLC_DIAGNOSTIC_V1', sampleSize: valid.length, directionalEfficiency: null, relativeVolatility: null };
  }

  const closes = valid.map(bar => bar.close);
  const pathLength = closes.slice(1).reduce((sum, close, index) => sum + Math.abs(close - closes[index]), 0);
  const netMove = Math.abs(closes[closes.length - 1] - closes[0]);
  const directionalEfficiency = pathLength > 0 ? Math.min(1, netMove / pathLength) : 0;
  const normalizedRanges = valid.map(bar => (bar.high - bar.low) / Math.max(bar.close, 1e-12));
  const recent = normalizedRanges.slice(-10);
  const baseline = normalizedRanges.slice(-30, -10);
  const recentVolatility = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const baselineVolatility = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
  const relativeVolatility = baselineVolatility > 0 ? recentVolatility / baselineVolatility : null;

  let label: MarketRegime = 'TRANSITIONAL';
  if (relativeVolatility === null) label = 'UNKNOWN';
  else if (relativeVolatility >= 1.8) label = 'HIGH_VOLATILITY';
  else if (relativeVolatility <= 0.65) label = 'LOW_VOLATILITY';
  else if (directionalEfficiency >= 0.55) label = 'TRENDING';
  else if (directionalEfficiency <= 0.22) label = 'RANGING';

  return {
    label,
    method: 'OHLC_DIAGNOSTIC_V1',
    sampleSize: valid.length,
    directionalEfficiency: Number(directionalEfficiency.toFixed(4)),
    relativeVolatility: Number(relativeVolatility.toFixed(4)),
  };
}

export interface CalibrationSample {
  probability: number;
  outcome: 0 | 1;
}

export interface CalibrationMetrics {
  sampleSize: number;
  brierScore: number | null;
  logLoss: number | null;
  expectedCalibrationError: number | null;
  evidenceStatus: 'INSUFFICIENT_SAMPLE' | 'MEASURED';
  reliabilityBins: Array<{
    bucket: number;
    lowerProbability: number;
    upperProbability: number;
    meanPredicted: number | null;
    observedRate: number | null;
    sampleSize: number;
  }>;
}

export function calculateCalibrationMetrics(samples: CalibrationSample[]): CalibrationMetrics {
  const valid = samples.filter(sample =>
    Number.isFinite(sample.probability) &&
    sample.probability >= 0 &&
    sample.probability <= 1 &&
    (sample.outcome === 0 || sample.outcome === 1)
  );
  const sampleSize = valid.length;
  const reliabilityBins = Array.from({ length: 10 }, (_, bucket) => {
    const items = valid.filter(sample => Math.min(9, Math.floor(sample.probability * 10)) === bucket);
    return {
      bucket,
      lowerProbability: bucket / 10,
      upperProbability: (bucket + 1) / 10,
      meanPredicted: items.length ? items.reduce((sum, item) => sum + item.probability, 0) / items.length : null,
      observedRate: items.length ? items.reduce((sum, item) => sum + item.outcome, 0) / items.length : null,
      sampleSize: items.length,
    };
  });
  if (!sampleSize) {
    return {
      sampleSize: 0,
      brierScore: null,
      logLoss: null,
      expectedCalibrationError: null,
      evidenceStatus: 'INSUFFICIENT_SAMPLE',
      reliabilityBins,
    };
  }
  const epsilon = 1e-6;
  const brierScore = valid.reduce((sum, item) => sum + Math.pow(item.probability - item.outcome, 2), 0) / sampleSize;
  const logLoss = valid.reduce((sum, item) => {
    const probability = Math.max(epsilon, Math.min(1 - epsilon, item.probability));
    return sum - (item.outcome === 1 ? Math.log(probability) : Math.log(1 - probability));
  }, 0) / sampleSize;
  const expectedCalibrationError = reliabilityBins.reduce((sum, bin) => {
    if (!bin.sampleSize || bin.meanPredicted === null || bin.observedRate === null) return sum;
    return sum + (bin.sampleSize / sampleSize) * Math.abs(bin.meanPredicted - bin.observedRate);
  }, 0);
  return {
    sampleSize,
    brierScore: Number(brierScore.toFixed(6)),
    logLoss: Number(logLoss.toFixed(6)),
    expectedCalibrationError: Number(expectedCalibrationError.toFixed(6)),
    evidenceStatus: sampleSize >= CALIBRATION_MINIMUM ? 'MEASURED' : 'INSUFFICIENT_SAMPLE',
    reliabilityBins,
  };
}

export interface ForwardResolution {
  kind: 'PENDING' | 'INVALID_DATA' | 'RESOLVED';
  reason?: string;
  outcome?: Omit<LearningOutcome, 'resolvedAt'>;
}

function pipSize(symbol: ForexSymbol): number {
  return symbol.includes('JPY') ? 0.01 : 0.0001;
}

function buildScenarioExecution(
  direction: 'BUY' | 'SELL',
  symbol: ForexSymbol,
  rawEntry: number,
  rawExpiry: number,
  profile: LearningExecutionProfile,
): LearningOutcome['execution'] {
  const base = { assumedPayoutPct: profile.payoutPct };
  if (profile.assetAvailability === 'UNAVAILABLE') {
    return { ...base, status: 'ASSET_UNAVAILABLE', reason: 'Configured scenario: asset unavailable.' };
  }
  if (profile.brokerAcceptance === 'REJECTED') {
    return { ...base, status: 'BROKER_REJECTED', reason: 'Configured scenario: simulated broker rejection.' };
  }
  if (profile.spreadPips === null || profile.slippagePips === null || profile.latencyMs === null ||
      profile.assetAvailability !== 'AVAILABLE' || profile.brokerAcceptance !== 'ACCEPTED') {
    return { ...base, status: 'PROFILE_INCOMPLETE', reason: 'Spread, slippage, zero-latency M1 replay, asset availability and acceptance assumptions are not all configured.' };
  }
  if (profile.latencyMs !== 0) {
    return { ...base, status: 'LATENCY_NOT_REPLAYABLE', reason: 'M1 OHLC cannot reconstruct sub-minute execution latency. Tick/quote data is required.' };
  }
  const pip = pipSize(symbol);
  const halfSpread = profile.spreadPips * pip / 2;
  const slippage = profile.slippagePips * pip;
  const adjustedEntryPrice = direction === 'BUY' ? rawEntry + halfSpread + slippage : rawEntry - halfSpread - slippage;
  const adjustedExpiryPrice = direction === 'BUY' ? rawExpiry - halfSpread : rawExpiry + halfSpread;
  if (!finitePositive(adjustedEntryPrice) || !finitePositive(adjustedExpiryPrice)) {
    return { ...base, status: 'REFERENCE_ONLY', reason: 'Execution-cost assumptions produced an invalid quote; no simulated P/L was recorded.' };
  }
  const settlement = calculateBinarySettlement(direction, adjustedEntryPrice, adjustedExpiryPrice, profile.payoutPct);
  return {
    ...base,
    status: 'SIMULATED',
    reason: 'Scenario only: user-entered spread, slippage, payout and availability assumptions applied to real M1 OHLC. Not a broker fill.',
    adjustedEntryPrice,
    adjustedExpiryPrice,
    simulatedOutcome: settlement.outcome,
    simulatedReturnUnits: settlement.netReturnUnits,
  };
}

export function resolveForwardOutcome(
  prediction: Pick<LearningPrediction, 'symbol' | 'direction' | 'horizonMinutes' | 'entryTimeUtc' | 'expiryTimeUtc' | 'executionProfile'>,
  candleInput: Candle[],
  nowMs: number,
): ForwardResolution {
  const entryMs = Date.parse(prediction.entryTimeUtc);
  const expiryMs = Date.parse(prediction.expiryTimeUtc);
  if (!Number.isFinite(entryMs) || !Number.isFinite(expiryMs) ||
      expiryMs - entryMs !== prediction.horizonMinutes * M1_MS ||
      entryMs % M1_MS !== 0 || expiryMs % M1_MS !== 0) {
    return { kind: 'INVALID_DATA', reason: 'The frozen entry/expiry schedule is not aligned to the exact M1 contract window.' };
  }
  if (nowMs < expiryMs) return { kind: 'PENDING' };

  const bars = candleInput.filter(candle => candle.symbol === prediction.symbol).sort((a, b) => a.timestampMs - b.timestampMs);
  const byTime = new Map<number, Candle>();
  for (const bar of bars) if (!byTime.has(bar.timestampMs)) byTime.set(bar.timestampMs, bar);
  const entry = byTime.get(entryMs);
  const expectedLast = expiryMs - M1_MS;
  const last = byTime.get(expectedLast);
  const path: Candle[] = [];
  let missingOrInvalid = false;
  let invalidReason = 'The exact entry-to-expiry M1 path is incomplete or contains untrusted candles.';
  for (let timestamp = entryMs; timestamp <= expectedLast; timestamp += M1_MS) {
    const candle = byTime.get(timestamp);
    if (!candle) {
      missingOrInvalid = true;
      invalidReason = 'Missing exact M1 candle at ' + new Date(timestamp).toISOString() + '.';
      break;
    }
    if (!isTrustedCandle(candle)) {
      missingOrInvalid = true;
      invalidReason = 'Untrusted or malformed candle at ' + new Date(timestamp).toISOString() + '.';
      break;
    }
    path.push(candle);
  }

  if (!entry || !last || missingOrInvalid || path.length !== prediction.horizonMinutes) {
    if (nowMs < expiryMs + INVALID_DATA_GRACE_MS) return { kind: 'PENDING' };
    return { kind: 'INVALID_DATA', reason: invalidReason };
  }

  const reference = calculateBinarySettlement(prediction.direction, entry.open, last.close, prediction.executionProfile.payoutPct);
  const sources = [...new Set(path.map(candle => candle.source))].sort();
  const pathFingerprint = hashObject(path.map(candle => [
    candle.timestampMs, candle.open, candle.high, candle.low, candle.close, candle.source,
  ]));
  const execution = buildScenarioExecution(
    prediction.direction,
    prediction.symbol,
    entry.open,
    last.close,
    prediction.executionProfile,
  );
  return {
    kind: 'RESOLVED',
    outcome: {
      entryCandleAt: entry.timestamp,
      expiryCandleAt: last.timestamp,
      entryPrice: entry.open,
      expiryPrice: last.close,
      directionOutcome: reference.outcome,
      referenceReturnUnits: reference.netReturnUnits,
      sourceProviders: sources,
      pathCandleCount: path.length,
      pathFingerprint,
      execution,
    },
  };
}

function defaultState(): LearningPlatformPersistedState {
  return {
    predictions: [],
    events: [],
    executionProfile: clone(DEFAULT_LEARNING_EXECUTION_PROFILE),
    champions: {},
  };
}

function normalizeProfile(profile: Partial<LearningExecutionProfile>): LearningExecutionProfile {
  const payoutPct = Number(profile.payoutPct);
  if (!Number.isFinite(payoutPct) || payoutPct < 0 || payoutPct > 100) {
    throw new Error('Payout assumption must be between 0 and 100 percent.');
  }
  const optionalNonNegative = (value: number | null, label: string) => {
    if (value === null) return null;
    if (!Number.isFinite(value) || value < 0) throw new Error(label + ' must be a non-negative finite number or blank.');
    return value;
  };
  const spreadPips = optionalNonNegative(profile.spreadPips ?? null, 'Spread');
  const slippagePips = optionalNonNegative(profile.slippagePips ?? null, 'Slippage');
  const latencyMs = optionalNonNegative(profile.latencyMs ?? null, 'Latency');
  const assetAvailability = profile.assetAvailability ?? 'UNKNOWN';
  const brokerAcceptance = profile.brokerAcceptance ?? 'UNKNOWN';
  if (!['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'].includes(assetAvailability)) throw new Error('Invalid asset-availability assumption.');
  if (!['ACCEPTED', 'REJECTED', 'UNKNOWN'].includes(brokerAcceptance)) throw new Error('Invalid broker-acceptance assumption.');
  return { payoutPct, spreadPips, slippagePips, latencyMs, assetAvailability, brokerAcceptance };
}

export interface LearningCaptureSummary {
  captured: number;
  duplicates: number;
  rejected: number;
  reasons: Record<string, number>;
}

export interface LearningBoard {
  generatedAt: string;
  summary: {
    predictions: number;
    pending: number;
    resolved: number;
    invalidData: number;
    decisive: number;
    wins: number;
    losses: number;
    scratches: number;
    referenceWinRate: number | null;
  };
  calibration: CalibrationMetrics & {
    last50Brier: number | null;
    prior50Brier: number | null;
    drift: 'IMPROVING' | 'DETERIORATING' | 'STABLE' | 'INSUFFICIENT_SAMPLE';
  };
  regimeBreakdown: Array<{ regime: MarketRegime; sampleSize: number; wins: number; losses: number; scratches: number; winRate: number | null }>;
  familyBreakdown: Array<{ hypothesisType: string; sampleSize: number; wins: number; losses: number; winRate: number | null; meanBrier: number | null }>;
  models: Array<{
    cohortKey: string;
    symbol: ForexSymbol;
    hypothesisType: string;
    horizonMinutes: number;
    modelVersion: string;
    sampleSize: number;
    brierScore: number | null;
    logLoss: number | null;
    isChampion: boolean;
    pairedSampleSize: number;
    pairedBrierImprovement: number | null;
    promotionStatus: 'CURRENT_CHAMPION' | 'INITIAL_REVIEW_READY' | 'CHALLENGER_ELIGIBLE' | 'INSUFFICIENT_PAIRED_EVIDENCE' | 'NO_CLEAR_IMPROVEMENT' | 'NOT_BETTER';
  }>;
  executionProfile: LearningExecutionProfile;
  champions: Record<string, string>;
  ledger: LearningPrediction[];
  recentLosses: LearningPrediction[];
  latestEvents: LearningEvent[];
}

export class LearningPlatformService {
  private state: LearningPlatformPersistedState;
  private adapter: LearningPersistenceAdapter;

  constructor(adapter?: LearningPersistenceAdapter) {
    this.adapter = adapter || {
      read: () => db.getLearningPlatformState(),
      write: value => db.saveLearningPlatformState(value),
    };
    const existing = this.adapter.read();
    this.state = {
      predictions: Array.isArray(existing?.predictions) ? existing.predictions : [],
      events: Array.isArray(existing?.events) ? existing.events : [],
      executionProfile: normalizeProfile(existing?.executionProfile || DEFAULT_LEARNING_EXECUTION_PROFILE),
      champions: existing?.champions && typeof existing.champions === 'object' ? existing.champions : {},
    };
  }

  private persist(): void {
    this.adapter.write(clone(this.state));
  }

  private appendEvent(
    predictionId: string,
    kind: LearningEvent['kind'],
    occurredAt: string,
    details: LearningEvent['details'],
  ): void {
    const eventHash = hashObject({ predictionId, kind, occurredAt, details });
    if (this.state.events.some(event => event.eventHash === eventHash)) return;
    this.state.events.push({
      id: 'lev_' + randomUUID(),
      predictionId,
      kind,
      occurredAt,
      eventHash,
      details,
    });
  }

  public getExecutionProfile(): LearningExecutionProfile {
    return clone(this.state.executionProfile);
  }

  public updateExecutionProfile(input: Partial<LearningExecutionProfile>, nowMs = Date.now()): LearningExecutionProfile {
    this.state.executionProfile = normalizeProfile({ ...this.state.executionProfile, ...input });
    this.appendEvent('system', 'EXECUTION_PROFILE_CHANGED', new Date(nowMs).toISOString(), {
      payoutPct: this.state.executionProfile.payoutPct,
      spreadPips: this.state.executionProfile.spreadPips,
      slippagePips: this.state.executionProfile.slippagePips,
      latencyMs: this.state.executionProfile.latencyMs,
      assetAvailability: this.state.executionProfile.assetAvailability,
      brokerAcceptance: this.state.executionProfile.brokerAcceptance,
    });
    this.persist();
    return this.getExecutionProfile();
  }

  public captureApprovedOpportunities(opportunities: TradeOpportunity[], nowMs = Date.now()): LearningCaptureSummary {
    const summary: LearningCaptureSummary = { captured: 0, duplicates: 0, rejected: 0, reasons: {} };
    const existingOpportunityIds = new Set(this.state.predictions.map(item => item.opportunityId));
    const nowIso = new Date(nowMs).toISOString();
    for (const opportunity of opportunities) {
      if (existingOpportunityIds.has(opportunity.id)) {
        summary.duplicates += 1;
        continue;
      }
      const reject = (reason: string) => {
        summary.rejected += 1;
        summary.reasons[reason] = (summary.reasons[reason] || 0) + 1;
      };
      if (opportunity.humanDecision?.status !== 'APPROVED_FOR_PAPER_REVIEW') { reject('NOT_HUMAN_APPROVED'); continue; }
      if (opportunity.audit?.status !== 'SHORTLISTED') { reject('NOT_SHORTLISTED'); continue; }
      if (opportunity.direction !== 'BUY' && opportunity.direction !== 'SELL') { reject('NO_DIRECTIONAL_HYPOTHESIS'); continue; }
      if (!isTrustedSource(opportunity.dataSource)) { reject('UNTRUSTED_DATA_SOURCE'); continue; }
      const snapshotMs = Date.parse(opportunity.snapshotAt);
      const staleMs = Date.parse(opportunity.staleAfter);
      const entryMs = Date.parse(opportunity.entryTimeUtc);
      const expiryMs = Date.parse(opportunity.expiryTimeUtc);
      if (![snapshotMs, staleMs, entryMs, expiryMs].every(Number.isFinite) ||
          snapshotMs > nowMs ||
          nowMs - snapshotMs > 25_000 ||
          nowMs >= staleMs ||
          entryMs <= nowMs ||
          entryMs - snapshotMs !== 180_000 ||
          expiryMs - entryMs !== opportunity.horizonMinutes * M1_MS ||
          entryMs % M1_MS !== 0 ||
          expiryMs % M1_MS !== 0) {
        reject('STALE_OR_MISALIGNED_T_MINUS_3_SCHEDULE');
        continue;
      }
      if (!finitePositive(opportunity.snapshotPrice) ||
          !finitePositive(opportunity.proposedEntryPrice) ||
          opportunity.forecast?.status !== 'AVAILABLE' ||
          !Array.isArray(opportunity.forecast.points) ||
          opportunity.forecast.points.length < 2) {
        reject('INCOMPLETE_FORECAST_OR_PRICE');
        continue;
      }

      const compactOriginal = {
        batchId: opportunity.batchId,
        sourceKind: opportunity.sourceKind,
        rawHypothesisScore: opportunity.rawHypothesisScore,
        activationThreshold: opportunity.activationThreshold,
        auditRankScore: opportunity.audit.rankScore,
        holdoutSampleSize: opportunity.audit.holdoutSampleSize,
        holdoutLowerConfidenceBound: opportunity.audit.holdoutLowerConfidenceBound,
        humanDecisionAt: opportunity.humanDecision.decidedAt,
        parentOpportunityId: opportunity.humanDecision.parentOpportunityId,
      };
      const snapshot = {
        opportunityId: opportunity.id,
        capturedAt: nowIso,
        snapshotAt: opportunity.snapshotAt,
        entryTimeUtc: opportunity.entryTimeUtc,
        expiryTimeUtc: opportunity.expiryTimeUtc,
        symbol: opportunity.symbol,
        direction: opportunity.direction,
        hypothesisType: opportunity.hypothesisType,
        hypothesisName: opportunity.hypothesisName,
        horizonMinutes: opportunity.horizonMinutes,
        modelVersion: opportunity.modelVersion,
        datasetFingerprint: opportunity.datasetFingerprint,
        featureSchemaVersion: opportunity.featureSchemaVersion,
        dataSource: opportunity.dataSource,
        marketDataQuality: opportunity.marketDataQuality,
        snapshotPrice: opportunity.snapshotPrice,
        proposedEntryReference: opportunity.proposedEntryPrice,
        forecastProbability: Number.isFinite(opportunity.forecast.winRate) ? opportunity.forecast.winRate : null,
        forecastLowerBound: Number.isFinite(opportunity.forecast.lowerConfidenceBound) ? opportunity.forecast.lowerConfidenceBound : null,
        forecastPoints: clone(opportunity.forecast.points),
        regime: classifyMarketRegime(opportunity.recentPriceHistory || []),
        executionProfile: clone(this.state.executionProfile),
        originalDecision: compactOriginal,
      };
      const predictionHash = hashObject(snapshot);
      const prediction: LearningPrediction = {
        id: 'lp_' + randomUUID(),
        ...snapshot,
        predictionHash,
        status: 'PENDING',
      };
      this.state.predictions.push(prediction);
      existingOpportunityIds.add(opportunity.id);
      this.appendEvent(prediction.id, 'PREDICTION_CAPTURED', nowIso, {
        opportunityId: opportunity.id,
        modelVersion: opportunity.modelVersion,
        predictionHash,
      });
      summary.captured += 1;
    }
    if (summary.captured) this.persist();
    return summary;
  }

  public reconcileDuePredictions(
    getCandles: (symbol: ForexSymbol) => Candle[],
    nowMs = Date.now(),
  ): { resolved: number; invalidated: number; pending: number } {
    const result = { resolved: 0, invalidated: 0, pending: 0 };
    const candleCache = new Map<ForexSymbol, Candle[]>();
    let changed = false;
    for (const prediction of this.state.predictions) {
      if (prediction.status !== 'PENDING') continue;
      const expiryMs = Date.parse(prediction.expiryTimeUtc);
      if (!Number.isFinite(expiryMs)) {
        prediction.status = 'INVALID_DATA';
        prediction.invalidReason = 'The frozen expiry timestamp is malformed.';
        this.appendEvent(prediction.id, 'DATA_INVALIDATED', new Date(nowMs).toISOString(), { reason: prediction.invalidReason });
        result.invalidated += 1;
        changed = true;
        continue;
      }
      if (nowMs < expiryMs) { result.pending += 1; continue; }
      if (!candleCache.has(prediction.symbol)) candleCache.set(prediction.symbol, getCandles(prediction.symbol));
      const resolution = resolveForwardOutcome(prediction, candleCache.get(prediction.symbol) || [], nowMs);
      if (resolution.kind === 'PENDING') { result.pending += 1; continue; }
      if (resolution.kind === 'INVALID_DATA') {
        prediction.status = 'INVALID_DATA';
        prediction.invalidReason = resolution.reason || 'The outcome could not be scored from exact trusted candles.';
        this.appendEvent(prediction.id, 'DATA_INVALIDATED', new Date(nowMs).toISOString(), { reason: prediction.invalidReason });
        result.invalidated += 1;
        changed = true;
        continue;
      }
      prediction.status = 'RESOLVED';
      prediction.outcome = { ...resolution.outcome!, resolvedAt: new Date(nowMs).toISOString() };
      this.appendEvent(prediction.id, 'OUTCOME_RESOLVED', prediction.outcome.resolvedAt, {
        directionOutcome: prediction.outcome.directionOutcome,
        entryPrice: prediction.outcome.entryPrice,
        expiryPrice: prediction.outcome.expiryPrice,
        pathFingerprint: prediction.outcome.pathFingerprint,
      });
      result.resolved += 1;
      changed = true;
    }
    if (changed) this.persist();
    return result;
  }

  private modelEvidence(): LearningBoard['models'] {
    const resolved = this.state.predictions.filter(item =>
      item.status === 'RESOLVED' && item.outcome &&
      item.forecastProbability !== null &&
      item.outcome.directionOutcome !== 'SCRATCH'
    );
    const cohorts = new Map<string, LearningPrediction[]>();
    for (const prediction of resolved) {
      const key = prediction.symbol + '|' + prediction.hypothesisType + '|' + prediction.horizonMinutes;
      if (!cohorts.has(key)) cohorts.set(key, []);
      cohorts.get(key)!.push(prediction);
    }
    const rows: LearningBoard['models'] = [];
    for (const [cohortKey, cohort] of cohorts) {
      const [symbol, hypothesisType, horizonRaw] = cohortKey.split('|');
      const championVersion = this.state.champions[cohortKey];
      const byVersion = new Map<string, LearningPrediction[]>();
      for (const item of cohort) {
        if (!byVersion.has(item.modelVersion)) byVersion.set(item.modelVersion, []);
        byVersion.get(item.modelVersion)!.push(item);
      }
      const championItems = championVersion ? byVersion.get(championVersion) || [] : [];
      const championByTarget = new Map(championItems.map(item => [
        item.entryTimeUtc + '|' + item.expiryTimeUtc,
        item,
      ]));
      for (const [modelVersion, items] of byVersion) {
        const calibration = calculateCalibrationMetrics(items.map(item => ({
          probability: item.forecastProbability!,
          outcome: item.outcome!.directionOutcome === 'WIN' ? 1 : 0,
        })));
        const isChampion = !!championVersion && modelVersion === championVersion;
        const paired = isChampion ? [] : items.flatMap(item => {
          const baseline = championByTarget.get(item.entryTimeUtc + '|' + item.expiryTimeUtc);
          return baseline ? [{ challenger: item, champion: baseline }] : [];
        });
        const pairedChampion = paired.map(pair => ({
          probability: pair.champion.forecastProbability!,
          outcome: pair.champion.outcome!.directionOutcome === 'WIN' ? 1 : 0,
        }));
        const pairedChallenger = paired.map(pair => ({
          probability: pair.challenger.forecastProbability!,
          outcome: pair.challenger.outcome!.directionOutcome === 'WIN' ? 1 : 0,
        }));
        const pairedChampionBrier = pairedChampion.length
          ? pairedChampion.reduce((sum, item) => sum + Math.pow(item.probability - item.outcome, 2), 0) / pairedChampion.length
          : null;
        const pairedChallengerBrier = pairedChallenger.length
          ? pairedChallenger.reduce((sum, item) => sum + Math.pow(item.probability - item.outcome, 2), 0) / pairedChallenger.length
          : null;
        const improvement = pairedChampionBrier !== null && pairedChallengerBrier !== null
          ? pairedChampionBrier - pairedChallengerBrier
          : null;
        let promotionStatus: LearningBoard['models'][number]['promotionStatus'];
        if (isChampion) promotionStatus = 'CURRENT_CHAMPION';
        else if (!championVersion) {
          promotionStatus = items.length >= INITIAL_CHAMPION_MINIMUM ? 'INITIAL_REVIEW_READY' : 'INSUFFICIENT_PAIRED_EVIDENCE';
        } else if (paired.length < PAIRED_PROMOTION_MINIMUM) {
          promotionStatus = 'INSUFFICIENT_PAIRED_EVIDENCE';
        } else if ((improvement ?? 0) >= 0.02) {
          promotionStatus = 'CHALLENGER_ELIGIBLE';
        } else if ((improvement ?? 0) <= -0.02) {
          promotionStatus = 'NOT_BETTER';
        } else {
          promotionStatus = 'NO_CLEAR_IMPROVEMENT';
        }
        rows.push({
          cohortKey,
          symbol: symbol as ForexSymbol,
          hypothesisType,
          horizonMinutes: Number(horizonRaw),
          modelVersion,
          sampleSize: items.length,
          brierScore: calibration.brierScore,
          logLoss: calibration.logLoss,
          isChampion,
          pairedSampleSize: paired.length,
          pairedBrierImprovement: improvement === null ? null : Number(improvement.toFixed(6)),
          promotionStatus,
        });
      }
    }
    return rows.sort((a, b) =>
      a.symbol.localeCompare(b.symbol) ||
      a.hypothesisType.localeCompare(b.hypothesisType) ||
      a.horizonMinutes - b.horizonMinutes ||
      a.modelVersion.localeCompare(b.modelVersion)
    );
  }

  public setChampion(cohortKey: string, modelVersion: string, nowMs = Date.now()): void {
    if (!cohortKey || cohortKey.length > 200 || !modelVersion || modelVersion.length > 100) {
      throw new Error('A valid cohort and model version are required.');
    }
    const row = this.modelEvidence().find(item => item.cohortKey === cohortKey && item.modelVersion === modelVersion);
    if (!row || !['INITIAL_REVIEW_READY', 'CHALLENGER_ELIGIBLE'].includes(row.promotionStatus)) {
      throw new Error('This model does not meet the evidence gate for human champion review.');
    }
    const previous = this.state.champions[cohortKey] || null;
    this.state.champions[cohortKey] = modelVersion;
    this.appendEvent('system', 'CHAMPION_CHANGED', new Date(nowMs).toISOString(), {
      cohortKey,
      previousChampion: previous,
      newChampion: modelVersion,
      pairedSampleSize: row.pairedSampleSize,
      promotionStatus: row.promotionStatus,
    });
    this.persist();
  }

  public getBoard(limit = 150): LearningBoard {
    const predictions = this.state.predictions;
    const resolved = predictions.filter(item => item.status === 'RESOLVED' && item.outcome);
    const decisive = resolved.filter(item => item.outcome!.directionOutcome !== 'SCRATCH');
    const wins = decisive.filter(item => item.outcome!.directionOutcome === 'WIN').length;
    const losses = decisive.length - wins;
    const scratches = resolved.length - decisive.length;
    const ordered = [...decisive].sort((a, b) => Date.parse(a.outcome!.resolvedAt) - Date.parse(b.outcome!.resolvedAt));
    const samples = ordered
      .filter(item => item.forecastProbability !== null)
      .map(item => ({
        probability: item.forecastProbability!,
        outcome: item.outcome!.directionOutcome === 'WIN' ? 1 as const : 0 as const,
      }));
    const calibration = calculateCalibrationMetrics(samples);
    const brier = (slice: typeof samples) => slice.length
      ? slice.reduce((sum, item) => sum + Math.pow(item.probability - item.outcome, 2), 0) / slice.length
      : null;
    const last50 = samples.slice(-50);
    const prior50 = samples.slice(-100, -50);
    const last50Brier = last50.length === 50 ? brier(last50) : null;
    const prior50Brier = prior50.length === 50 ? brier(prior50) : null;
    const delta = last50Brier !== null && prior50Brier !== null ? last50Brier - prior50Brier : null;
    const drift = delta === null ? 'INSUFFICIENT_SAMPLE' : delta > 0.05 ? 'DETERIORATING' : delta < -0.05 ? 'IMPROVING' : 'STABLE';

    const regimes = new Map<MarketRegime, LearningPrediction[]>();
    for (const item of resolved) {
      if (!regimes.has(item.regime.label)) regimes.set(item.regime.label, []);
      regimes.get(item.regime.label)!.push(item);
    }
    const regimeBreakdown = [...regimes.entries()].map(([regime, items]) => {
      const regimeWins = items.filter(item => item.outcome!.directionOutcome === 'WIN').length;
      const regimeLosses = items.filter(item => item.outcome!.directionOutcome === 'LOSS').length;
      const regimeScratches = items.filter(item => item.outcome!.directionOutcome === 'SCRATCH').length;
      const scored = regimeWins + regimeLosses;
      return { regime, sampleSize: items.length, wins: regimeWins, losses: regimeLosses, scratches: regimeScratches, winRate: scored ? regimeWins / scored : null };
    }).sort((a, b) => b.sampleSize - a.sampleSize);

    const families = new Map<string, LearningPrediction[]>();
    for (const item of resolved) {
      if (!families.has(item.hypothesisType)) families.set(item.hypothesisType, []);
      families.get(item.hypothesisType)!.push(item);
    }
    const familyBreakdown = [...families.entries()].map(([hypothesisType, items]) => {
      const scored = items.filter(item => item.outcome!.directionOutcome !== 'SCRATCH');
      const familyWins = scored.filter(item => item.outcome!.directionOutcome === 'WIN').length;
      const familyBrier = items.filter(item => item.forecastProbability !== null && item.outcome!.directionOutcome !== 'SCRATCH');
      return {
        hypothesisType,
        sampleSize: items.length,
        wins: familyWins,
        losses: scored.length - familyWins,
        winRate: scored.length ? familyWins / scored.length : null,
        meanBrier: familyBrier.length ? familyBrier.reduce((sum, item) =>
          sum + Math.pow(item.forecastProbability! - (item.outcome!.directionOutcome === 'WIN' ? 1 : 0), 2), 0) / familyBrier.length : null,
      };
    }).sort((a, b) => b.sampleSize - a.sampleSize);

    const ledger = [...predictions]
      .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))
      .slice(0, Math.max(1, Math.min(500, limit)));
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        predictions: predictions.length,
        pending: predictions.filter(item => item.status === 'PENDING').length,
        resolved: resolved.length,
        invalidData: predictions.filter(item => item.status === 'INVALID_DATA').length,
        decisive: decisive.length,
        wins,
        losses,
        scratches,
        referenceWinRate: decisive.length ? wins / decisive.length : null,
      },
      calibration: {
        ...calibration,
        last50Brier: last50Brier === null ? null : Number(last50Brier.toFixed(6)),
        prior50Brier: prior50Brier === null ? null : Number(prior50Brier.toFixed(6)),
        drift,
      },
      regimeBreakdown,
      familyBreakdown,
      models: this.modelEvidence(),
      executionProfile: clone(this.state.executionProfile),
      champions: { ...this.state.champions },
      ledger,
      recentLosses: [...resolved]
        .filter(item => item.outcome!.directionOutcome === 'LOSS')
        .sort((a, b) => Date.parse(b.outcome!.resolvedAt) - Date.parse(a.outcome!.resolvedAt))
        .slice(0, 20),
      latestEvents: [...this.state.events].slice(-20).reverse(),
    };
  }
}

export const learningPlatform = new LearningPlatformService();

export async function runLearningPlatformVerificationTests(): Promise<VerificationTestResult[]> {
  const results: VerificationTestResult[] = [];
  const run = async (name: string, fn: () => void | Promise<void>) => {
    const started = Date.now();
    try {
      await fn();
      results.push({
        category: 'RESEARCH',
        name: 'Forward learning · ' + name,
        passed: true,
        durationMs: Date.now() - started,
        details: 'Passed all assertions.',
      });
    } catch (error: any) {
      results.push({
        category: 'RESEARCH',
        name: 'Forward learning · ' + name,
        passed: false,
        durationMs: Date.now() - started,
        details: 'Assertion failure.',
        error: String(error?.message || error),
      });
    }
  };
  const memoryAdapter = (): LearningPersistenceAdapter => {
    let state = defaultState();
    return { read: () => clone(state), write: value => { state = clone(value); } };
  };
  const makeOpportunity = (snapshotMs: number): TradeOpportunity => {
    const history: OpportunityHistoricalCandle[] = Array.from({ length: 40 }, (_, index) => {
      const close = 1.1 + index * 0.0001;
      return { minuteOffset: index - 39, open: close - 0.00005, high: close + 0.00008, low: close - 0.00008, close };
    });
    const snapshotAt = new Date(snapshotMs).toISOString();
    const entryMs = snapshotMs + 180_000;
    const expiryMs = entryMs + 5 * M1_MS;
    return {
      id: 'opp_test_forward_1',
      batchId: 'batch_test_forward',
      symbol: 'EUR/USD',
      hypothesisType: 'TREND_CONTINUATION',
      hypothesisName: 'Test trend continuation',
      hypothesis: 'Test-only immutable opportunity fixture.',
      sourceKind: 'EXPLORATORY_HEURISTIC',
      direction: 'BUY',
      rawHypothesisScore: 0.72,
      activationThreshold: 0.6,
      horizonMinutes: 5,
      generatedAt: snapshotAt,
      snapshotAt,
      staleAfter: new Date(snapshotMs + 240_000).toISOString(),
      entryTimeUtc: new Date(entryMs).toISOString(),
      expiryTimeUtc: new Date(expiryMs).toISOString(),
      snapshotPrice: 1.1,
      proposedEntryPrice: 1.1001,
      dataSource: 'biquote',
      marketDataQuality: 95,
      datasetFingerprint: 'test-dataset-fingerprint',
      featureSchemaVersion: 'test-feature-v1',
      modelVersion: 'test-model-v1',
      marketFeatureVector: Array.from({ length: 19 }, (_, index) => index / 19),
      recentPriceHistory: history,
      forecast: {
        status: 'AVAILABLE',
        points: [
          { minute: 0, q10: 1.099, q25: 1.0995, median: 1.1001, q75: 1.1005, q90: 1.101 },
          { minute: 5, q10: 1.099, q25: 1.100, median: 1.101, q75: 1.102, q90: 1.103 },
        ],
        terminalPrices: [1.099, 1.1, 1.101, 1.102],
        analogueCount: 120,
        meanDistance: 0.2,
        winRate: 0.7,
        lowerConfidenceBound: 0.62,
        payoutBreakEvenProbability: 0.5556,
        expectedValueLowerBound: 0.1,
      },
      audit: {
        status: 'SHORTLISTED',
        rankScore: 88,
        holdoutSampleSize: 120,
        holdoutWins: 80,
        holdoutLosses: 40,
        holdoutScratches: 0,
        holdoutWinRate: 0.6667,
        holdoutLowerConfidenceBound: 0.6,
        holdoutExpectedValueLowerBound: 0.1,
        holdoutWindowStatus: 'FRESH',
        holdoutWindowStartUtc: new Date(snapshotMs - 60_000).toISOString(),
        holdoutWindowEndUtc: snapshotAt,
        reasons: [],
        counterEvidence: [],
        auditedAt: snapshotAt,
      },
      humanDecision: {
        status: 'APPROVED_FOR_PAPER_REVIEW',
        direction: 'BUY',
        horizonMinutes: 5,
        entryPrice: 1.1001,
        decidedAt: snapshotAt,
        notes: 'Unit test approval.',
      },
    };
  };

  await run('captures an immutable fresh T-3 snapshot exactly once', () => {
    const service = new LearningPlatformService(memoryAdapter());
    const now = 1_800_000_000_000;
    const opportunity = makeOpportunity(now - 1_000);
    const first = service.captureApprovedOpportunities([opportunity], now);
    opportunity.direction = 'SELL';
    const second = service.captureApprovedOpportunities([opportunity], now);
    const ledger = service.getBoard().ledger;
    if (first.captured !== 1 || second.captured !== 0 || second.duplicates !== 1) throw new Error('Capture must be idempotent by opportunity ID.');
    if (ledger[0]?.direction !== 'BUY' || !ledger[0]?.predictionHash) throw new Error('Original direction/hash must stay frozen after source object changes.');
  });

  await run('settles only from the exact complete trusted M1 window', () => {
    const service = new LearningPlatformService(memoryAdapter());
    const now = 1_800_000_000_000;
    const opportunity = makeOpportunity(now - 1_000);
    service.captureApprovedOpportunities([opportunity], now);
    const entryMs = Date.parse(opportunity.entryTimeUtc);
    const expiryMs = Date.parse(opportunity.expiryTimeUtc);
    const candles: Candle[] = Array.from({ length: 5 }, (_, index) => {
      const timestampMs = entryMs + index * M1_MS;
      const open = 1.1 + index * 0.0001;
      const close = open + 0.00008;
      return {
        symbol: 'EUR/USD',
        timestampMs,
        timestamp: new Date(timestampMs).toISOString(),
        open,
        high: close + 0.00002,
        low: open - 0.00002,
        close,
        volume: 100,
        source: 'biquote',
      };
    });
    const first = service.reconcileDuePredictions(() => candles, expiryMs + 1_000);
    const second = service.reconcileDuePredictions(() => candles, expiryMs + 2_000);
    const record = service.getBoard().ledger[0];
    if (first.resolved !== 1 || second.resolved !== 0 || record?.status !== 'RESOLVED') throw new Error('Exact expiry outcome must resolve once and remain idempotent.');
    if (record.outcome?.pathCandleCount !== 5 || record.outcome?.directionOutcome !== 'WIN') throw new Error('Settlement did not use the complete trusted M1 path.');
    if (record.outcome.execution.status !== 'PROFILE_INCOMPLETE') throw new Error('An incomplete profile must remain reference-only, never claim a simulated fill.');
  });

  await run('does not fill a missing minute from a later candle', () => {
    const service = new LearningPlatformService(memoryAdapter());
    const now = 1_800_000_000_000;
    const opportunity = makeOpportunity(now - 1_000);
    service.captureApprovedOpportunities([opportunity], now);
    const entryMs = Date.parse(opportunity.entryTimeUtc);
    const expiryMs = Date.parse(opportunity.expiryTimeUtc);
    const incomplete: Candle[] = Array.from({ length: 5 }, (_, index) => index)
      .filter(index => index !== 2)
      .map(index => {
        const timestampMs = entryMs + index * M1_MS;
        return {
          symbol: 'EUR/USD',
          timestampMs,
          timestamp: new Date(timestampMs).toISOString(),
          open: 1.1,
          high: 1.101,
          low: 1.099,
          close: 1.1005,
          volume: 100,
          source: 'biquote' as const,
        };
      });
    const settled = service.reconcileDuePredictions(() => incomplete, expiryMs + INVALID_DATA_GRACE_MS + 1);
    const record = service.getBoard().ledger[0];
    if (settled.invalidated !== 1 || record?.status !== 'INVALID_DATA' || record.outcome) throw new Error('A missing minute must be quarantined without fabricated result.');
  });

  await run('rejects synthetic/test candles as outcome evidence', () => {
    const opportunity = makeOpportunity(1_800_000_000_000 - 1_000);
    const entryMs = Date.parse(opportunity.entryTimeUtc);
    const expiryMs = Date.parse(opportunity.expiryTimeUtc);
    const candles: Candle[] = Array.from({ length: 5 }, (_, index) => {
      const timestampMs = entryMs + index * M1_MS;
      return {
        symbol: 'EUR/USD',
        timestampMs,
        timestamp: new Date(timestampMs).toISOString(),
        open: 1.1,
        high: 1.101,
        low: 1.099,
        close: 1.1005,
        volume: 100,
        source: 'test_fixture',
      };
    });
    const result = resolveForwardOutcome({
      symbol: opportunity.symbol,
      direction: 'BUY',
      horizonMinutes: opportunity.horizonMinutes,
      entryTimeUtc: opportunity.entryTimeUtc,
      expiryTimeUtc: opportunity.expiryTimeUtc,
      executionProfile: DEFAULT_LEARNING_EXECUTION_PROFILE,
    }, candles, expiryMs + INVALID_DATA_GRACE_MS + 1);
    if (result.kind !== 'INVALID_DATA') throw new Error('Synthetic/test candles must never score a forward outcome.');
  });

  await run('computes Brier and log-loss while withholding small-sample calibration claims', () => {
    const metrics = calculateCalibrationMetrics([
      { probability: 0.9, outcome: 1 },
      { probability: 0.8, outcome: 1 },
      { probability: 0.2, outcome: 0 },
      { probability: 0.1, outcome: 0 },
    ]);
    if (Math.abs((metrics.brierScore ?? 1) - 0.025) > 1e-9) throw new Error('Brier score was not calculated correctly: ' + metrics.brierScore);
    if (metrics.logLoss === null || metrics.logLoss <= 0 || metrics.evidenceStatus !== 'INSUFFICIENT_SAMPLE') throw new Error('Small sample must not be presented as measured calibration.');
  });

  await run('abstains from regime classification below the evidence minimum', () => {
    const trend = Array.from({ length: 40 }, (_, index) => {
      const close = 1.1 + index * 0.0001;
      return { minuteOffset: index - 39, open: close - 0.00005, high: close + 0.00008, low: close - 0.00008, close };
    });
    if (classifyMarketRegime(trend).label !== 'TRENDING') throw new Error('Expected the deterministic snapshot-only trend diagnostic.');
    if (classifyMarketRegime(trend.slice(0, 20)).label !== 'UNKNOWN') throw new Error('Regime classifier must abstain below 30 bars.');
  });

  return results;
}
