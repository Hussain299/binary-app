/**
 * SignalForge ML — Type Definitions
 * Complete schemas for forex feeds, causal execution, ML research, and D1 export.
 */

export type ForexSymbol =
  | 'EUR/USD'
  | 'GBP/USD'
  | 'USD/JPY'
  | 'EUR/JPY'
  | 'AUD/USD'
  | 'USD/CAD'
  | 'EUR/GBP'
  | 'AUD/CAD'
  | 'AUD/CHF'
  | 'AUD/JPY'
  | 'AUD/NZD'
  | 'EUR/AUD'
  | 'EUR/CAD'
  | 'EUR/CHF'
  | 'EUR/NZD'
  | 'GBP/AUD'
  | 'GBP/CAD'
  | 'GBP/CHF'
  | 'GBP/JPY'
  | 'GBP/NZD';

export const FOREX_PAIRS: ForexSymbol[] = [
  'EUR/USD',
  'GBP/USD',
  'USD/JPY',
  'EUR/JPY',
  'AUD/USD',
  'USD/CAD',
  'EUR/GBP',
  'AUD/CAD',
  'AUD/CHF',
  'AUD/JPY',
  'AUD/NZD',
  'EUR/AUD',
  'EUR/CAD',
  'EUR/CHF',
  'EUR/NZD',
  'GBP/AUD',
  'GBP/CAD',
  'GBP/CHF',
  'GBP/JPY',
  'GBP/NZD',
];

export type MarketSessionId = 'ASIA' | 'LONDON' | 'OVERLAP' | 'NEW_YORK' | 'LATE_NEW_YORK';

export interface MarketSessionInfo {
  id: MarketSessionId;
  name: string;
  shortName: string;
  hoursLabel: string;
  utcRange: string;
  istRange: string;
  isActive: boolean;
  winRate: number;
  hasMeasuredData: boolean;
  totalTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  /** Aggregate payout-adjusted binary contract return, measured in stake units. */
  netReturnUnits: number;
  bestStrategy: string;
}

export interface AppNotification {
  id: string;
  signalId: string;
  symbol: ForexSymbol;
  direction: SignalDirection;
  title: string;
  message: string;
  timestamp: string;
  triggerPrice: number;
  expiryMinutes: number;
  read: boolean;
  paperOnly?: boolean;
  candleOpenTimeIst?: string;
  candleCloseTimeIst?: string;
  advanceNoticeText?: string;
}

export interface Candle {
  symbol: ForexSymbol;
  timestamp: string; // ISO UTC string
  timestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: 'biquote' | 'dukascopy' | 'yahoo' | 'synthetic' | 'imported' | 'test_fixture';
}

export interface ProviderHealth {
  provider: 'biquote' | 'dukascopy' | 'yahoo';
  symbol: ForexSymbol;
  status: 'ONLINE' | 'DEGRADED' | 'FAILED';
  latencyMs: number;
  lastSuccess: string;
  consecutiveFailures: number;
  attribution: string;
  errorMessage?: string;
}

export type SignalDirection = 'BUY' | 'SELL';

export type SignalLifecycleState =
  | 'DETECTED'
  | 'WAITING_FOR_ENTRY'
  | 'ENTRY_TRIGGERED'
  | 'ACTIVE'
  | 'EXIT_PENDING'
  | 'CLOSED'
  | 'EXPIRED'
  | 'INVALIDATED'
  | 'AMBIGUOUS';

export interface SignalLifecycleEvent {
  timestamp: string; // ISO UTC
  fromState: SignalLifecycleState;
  toState: SignalLifecycleState;
  reason: string;
  price?: number;
}

export type OpportunityHypothesisType =
  | 'TREND_CONTINUATION'
  | 'MEAN_REVERSION'
  | 'WICK_REJECTION'
  | 'MOMENTUM_BREAKOUT'
  | 'VOLATILITY_EXPANSION'
  | 'EVOLVED_GENOME';

export type OpportunityDirection = SignalDirection | 'NO_TRADE';
export type OpportunityAuditStatus =
  | 'SHORTLISTED'
  | 'REJECTED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'NO_TRADE';
export type OpportunityHumanStatus =
  | 'PENDING'
  | 'APPROVED_FOR_PAPER_REVIEW'
  | 'REJECTED_BY_HUMAN'
  | 'SUPERSEDED';

export interface OpportunityForecastPoint {
  minute: number;
  q10: number;
  q25: number;
  median: number;
  q75: number;
  q90: number;
}

export interface OpportunityHistoricalCandle {
  /** Completed one-minute candle offset from the snapshot; the latest candle is minute 0. */
  minuteOffset: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface OpportunityForecast {
  status: 'AVAILABLE' | 'INSUFFICIENT_HISTORY';
  points: OpportunityForecastPoint[];
  /** Historical analogue terminal prices are retained for human direction revisions. */
  terminalPrices: number[];
  analogueCount: number;
  meanDistance: number | null;
  winRate: number | null;
  lowerConfidenceBound: number | null;
  payoutBreakEvenProbability: number;
  expectedValueLowerBound: number | null;
}

export interface OpportunityAudit {
  status: OpportunityAuditStatus;
  rankScore: number;
  /** Later chronological holdout metrics; separated from the analogue library used for the graph. */
  holdoutSampleSize: number;
  holdoutWins: number;
  holdoutLosses: number;
  holdoutScratches: number;
  holdoutWinRate: number | null;
  holdoutLowerConfidenceBound: number | null;
  holdoutExpectedValueLowerBound: number | null;
  holdoutWindowStatus: 'FRESH' | 'ALREADY_INSPECTED' | 'REVISION_NOT_TESTED';
  holdoutWindowStartUtc: string;
  holdoutWindowEndUtc: string;
  reasons: string[];
  counterEvidence: string[];
  auditedAt: string;
}

export interface OpportunityHumanDecision {
  status: OpportunityHumanStatus;
  direction?: SignalDirection;
  horizonMinutes?: 5 | 10 | 15 | 20 | 25 | 30;
  entryPrice?: number;
  decidedAt: string;
  notes?: string;
  parentOpportunityId?: string;
}

export interface TradeOpportunity {
  id: string;
  batchId: string;
  symbol: ForexSymbol;
  hypothesisType: OpportunityHypothesisType;
  hypothesisName: string;
  hypothesis: string;
  sourceKind: 'EXPLORATORY_HEURISTIC' | 'HISTORICALLY_VALIDATED_GENOME';
  strategyGeneId?: string;
  direction: OpportunityDirection;
  rawHypothesisScore: number;
  activationThreshold: number;
  horizonMinutes: 5 | 10 | 15 | 20 | 25 | 30;
  generatedAt: string;
  snapshotAt: string;
  staleAfter: string;
  entryTimeUtc: string;
  expiryTimeUtc: string;
  snapshotPrice: number;
  proposedEntryPrice: number;
  dataSource: string;
  marketDataQuality: number;
  datasetFingerprint: string;
  featureSchemaVersion: string;
  modelVersion: string;
  marketFeatureVector: number[];
  recentPriceHistory: OpportunityHistoricalCandle[];
  forecast: OpportunityForecast;
  audit: OpportunityAudit;
  humanDecision: OpportunityHumanDecision;
}

export interface ResearchSignal {
  id: string;
  symbol: ForexSymbol;
  direction: SignalDirection;
  predictionTimeUtc: string;
  predictionTimeIst: string;
  signalCandleTime: string;
  
  // Causal Entry Parameters
  entryCondition: string;
  entryWindowStartUtc: string;
  entryWindowEndUtc: string;
  triggerPrice: number;
  invalidationPrice: number;
  
  // Observed Execution Data
  actualEntryTimeUtc: string | null;
  actualEntryPrice: number | null;
  entrySource: string | null;
  
  // Causal Exit Parameters
  expiryMinutes: number;
  plannedExitTimeUtc: string | null;
  actualExitTimeUtc: string | null;
  actualExitPrice: number | null;
  
  // Confidence & Verification
  /** Raw model/strategy activation score; never present this as a win probability. */
  confidence: number;
  calibrationStatus: 'CALIBRATED' | 'UNCALIBRATED' | 'OVERCONFIDENT';
  /** Empirical probability calibrated only from earlier settled outcomes; absent until sample suffices. */
  calibratedProbability?: number;
  calibratedProbabilityLowerBound?: number;
  calibrationSampleSize?: number;
  calibrationBrierScore?: number;
  lifecycleState: SignalLifecycleState;
  lifecycleHistory: SignalLifecycleEvent[];
  
  // Outcome & Returns
  grossReturnPips: number | null;
  estimatedSpreadPips: number;
  netReturnPips: number | null;
  /** Assumed or observed binary-option payout at entry; recorded with each outcome. */
  payoutPct?: number;
  payoutSource?: 'ASSUMED_MINIMUM' | 'BROKER_OBSERVED';
  /** Binary-option profit/loss in stake units: +payout on win, -1 on loss, 0 on push. */
  netReturnUnits?: number | null;
  outcomeResult: 'WIN' | 'LOSS' | 'SCRATCH' | 'PENDING' | 'CANCELLED';
  
  // Model metadata and 5–30 minute entry-candle synchronization
  ruleFamily: string;
  modelVersion: string;
  notes?: string;
  strategyName?: string;
  /** Measured historical test win rate only; undefined means not validated. */
  strategyWinRate?: number;
  strategyHistoricalSampleSize?: number;
  strategyEvidenceStatus?: 'UNVALIDATED' | 'INSUFFICIENT_SAMPLE' | 'BACKTESTED';
  /** Forward evidence gate only; paperOnly remains true regardless. */
  strategyForwardApproved?: boolean;
  strategyId?: string;
  advanceNoticeMinutes?: number;
  candleOpenTimeUtc?: string;
  candleCloseTimeUtc?: string;
  candleOpenTimeIst?: string;
  candleCloseTimeIst?: string;
  marketSession?: MarketSessionId;
  marketSessionName?: string;
  confluenceStrategies?: string[];
  confluenceScore?: number;
  isStackedStrategy?: boolean;
  isNovelAiSynthesized?: boolean;
  synthesizedGeneId?: string;
  mathematicalFormula?: string;
  whyHumansMissThis?: string;
  /** True when this is an internal forward-paper observation, not an approved actionable alert. */
  paperOnly?: boolean;
  /** Entry candle timeframe; a supported 5–30 minute boundary, aligned with the expiry horizon. */
  entryTimeframeMinutes?: 5 | 10 | 15 | 20 | 25 | 30;
  /** Frozen causal 19-feature context captured when this prediction was made. */
  marketFeatureVector?: number[];
  lossAutopsy?: LossAutopsy;
}

export interface LossAutopsy {
  id: string;
  signalId: string;
  symbol: ForexSymbol;
  direction: SignalDirection;
  strategyName: string;
  mathematicalFormula?: string;
  entryPrice: number;
  exitPrice: number;
  /** Legacy forex diagnostics, absent for payout-settled binary contracts. */
  grossReturnPips?: number;
  netReturnPips?: number;
  spreadPips?: number;
  /** Actual binary return, if the signal was settled under the binary model. */
  netReturnUnits?: number;
  marketSession: string;
  strategyGeneId?: string;
  /** OBSERVED_ADVERSE_SETTLEMENT is an outcome label, not a causal explanation. */
  rootCause:
    | 'OBSERVED_ADVERSE_SETTLEMENT'
    | 'SPREAD_EXPANSION_SLIPPAGE'
    | 'MICRO_WICK_FALSE_ABSORPTION'
    | 'MOMENTUM_EXHAUSTION_DIVERGENCE'
    | 'SESSION_BOUNDARY_LIQUIDITY_VACUUM'
    | 'NON_LINEAR_OPERATOR_OVERFITTING';
  /** Evidence state prevents old heuristic labels from being mistaken for proven causes. */
  evidenceStatus?: 'OBSERVATION_ONLY' | 'HYPOTHESIS' | 'SUPPORTED';
  rootCauseExplanation: string;
  lessonsLearned: string[];
  /** Historical heuristic claims are retained for audit but never treated as evidence. */
  legacyUnverifiedExplanation?: string;
  legacyUnverifiedLessons?: string[];
  /** Deprecated legacy fields; new observations never fabricate antidote genomes. */
  antidoteStrategyGeneId?: string;
  antidoteStrategyName?: string;
  antidoteFormula?: string;
  antidoteOperator?: string;
  timestamp: string;
}

export type StrategyFeatureName =
  | 'return_1' | 'return_3' | 'return_5' | 'return_13'
  | 'body_direction' | 'body_ratio' | 'wick_imbalance' | 'close_location'
  | 'ema_spread' | 'ema_curvature' | 'rsi_centered' | 'rsi_momentum'
  | 'range_position_13' | 'range_position_34' | 'volatility_ratio'
  | 'directional_efficiency' | 'return_autocorrelation'
  | 'wick_pressure_change' | 'range_expansion';

export type StrategyExpressionNode =
  | { kind: 'feature'; feature: StrategyFeatureName }
  | { kind: 'constant'; value: number }
  | { kind: 'unary'; operator: 'tanh' | 'abs' | 'signed_power' | 'log_abs' | 'sin' | 'cos' | 'sqrt_abs' | 'negate'; exponent: number; input: StrategyExpressionNode }
  | { kind: 'binary'; operator: 'add' | 'subtract' | 'multiply' | 'protected_divide' | 'max' | 'min' | 'hypot' | 'atan2'; left: StrategyExpressionNode; right: StrategyExpressionNode };

export interface StrategyGenome {
  version: 1;
  expression: StrategyExpressionNode;
  activationThreshold: number;
  signature: string;
  complexity: number;
}

export interface StrategyDiscoveryMetrics {
  trainScoredTrades: number;
  validationScoredTrades: number;
  trainWinRate: number;
  validationWinRate: number;
  /** Validation expectancy in stake units per contract at the recorded binary payout. */
  validationExpectedValueUnits: number;
  validationProfitFactor: number;
  minimumPayoutPct?: number;
}

export interface StrategyBacktestMetrics {
  trainSampleSize: number;
  trainScoredSampleSize: number;
  validationSampleSize: number;
  validationScoredSampleSize: number;
  trainWinRate: number;
  validationWinRate: number;
  testWinRate: number;
  testAccuracy: number;
  testSampleSize: number;
  testScoredSampleSize: number;
  testWins: number;
  testLosses: number;
  /** Historical binary payout used by the backtest (80% conservative floor). */
  binaryPayoutPct: number;
  excludedZeroVolumeFlatCandles: number;
  /** Net profit/loss in stake units per contract, after binary settlement. */
  expectedValueUnits: number;
  profitFactor: number;
  confidenceInterval95: [number, number];
  /** One-sided lower bound after Bonferroni correction across the ten holdout finalists. */
  multipleTestingLowerBound?: number;
  /** Win rates for the latest three consecutive 100-trade blocks in the untouched test. */
  testBlockWinRates: number[];
  trainPeriod: { start: string; end: string };
  validationPeriod: { start: string; end: string };
  testPeriod: { start: string; end: string };
}

export interface StrategyPerformanceRecord {
  strategyId: string;
  trades: number;
  wins: number;
  losses: number;
  scratches: number;
  /** Legacy pip fields retained for reading earlier research snapshots; never used for binary approval. */
  netPips: number;
  positivePips: number;
  negativePips: number;
  /** Binary contract return units accumulated from outcomes collected under the new settlement model. */
  netReturnUnits?: number;
  positiveReturnUnits?: number;
  binaryTrades?: number;
  binaryWins?: number;
  binaryLosses?: number;
  binaryPushes?: number;
  minimumPayoutPct?: number;
  negativeReturnUnits?: number;
  /** Recent unique completed outcomes; rawScore enables strictly historical score calibration. */
  scoredOutcomes?: Array<{
    result: 'WIN' | 'LOSS';
    netReturnUnits: number;
    payoutPct: number;
    rawScore?: number;
  }>;
  /** Recent signal IDs prevent the same outcome from being counted more than once. */
  signalIds?: string[];
  /** Beta(1,1) posterior updated exactly once per decisive forward outcome. */
  bayesAlpha?: number;
  bayesBeta?: number;
  updatedAt: string;
}

export interface StrategyPaperMetrics {
  trades: number;
  scoredTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  /** Rolling win rate across the latest 300 scored forward outcomes once available. */
  winRate: number;
  allTimeWinRate?: number;
  rollingWinRates: number[];
  /** Binary-option return in stake units over the rolling scored outcomes. */
  netReturnUnits: number;
  /** Lowest payout represented in the rolling 300 completed outcomes. */
  minimumPayoutPct: number;
  /** Legacy field retained for old clients; not used for strategy approval. */
  netPips: number;
  profitFactor: number;
  confidenceInterval95: [number, number];
}

export interface SynthesizedStrategyGene {
  id: string;
  name: string;
  code: string;
  generation: number;
  mathematicalFormula: string;
  parents: string[];
  mutationRate: number;
  /** Legacy operator label. New symbolic genomes do not use this field. */
  nonLinearOperator?: 'tanh_polynomial' | 'fractal_power' | 'exponential_decay' | 'harmonic_dispersion';
  /** The same coefficients used by the live evaluator and historical backtester. */
  operatorParameters?: { alpha: number; beta: number; gamma: number; exponent: number; threshold: number };
  /** Executable symbolic-expression genome shared by the historical and live evaluators. */
  genome?: StrategyGenome;
  /** Candidate belongs to a 300-strategy search run. */
  searchBatchId?: string;
  /** Exact reproduction metadata for the evolutionary search that produced this candidate. */
  researchSeed?: string;
  datasetFingerprint?: string;
  featureSchemaVersion?: string;
  researchEngineVersion?: string;
  validationFailureReason?: string;
  /** Train/validation-only metrics used to select finalists before the untouched test is opened. */
  discoveryMetrics?: StrategyDiscoveryMetrics;
  /** Currency pair used to validate this candidate against historical data. */
  symbol?: ForexSymbol;
  optimalHorizonMinutes: 5 | 10 | 15 | 20 | 25 | 30;
  sessionAffinity: MarketSessionId | 'ALL';
  /** Measured untouched-test win rate. Zero means no verified result exists. */
  verifiedAccuracy: number;
  /** Number of out-of-sample test trades, never a generated estimate. */
  sampleCount: number;
  accuracyStatus?: 'UNVALIDATED' | 'INSUFFICIENT_SAMPLE' | 'BACKTESTED';
  backtestMetrics?: StrategyBacktestMetrics;
  paperMetrics?: StrategyPaperMetrics;
  forwardPerformance?: StrategyPerformanceRecord;
  status: 'PROMOTED_ACTIVE' | 'PAPER_TRADING' | 'EXPERIMENTING' | 'MUTATING' | 'REJECTED';
  scientificHypothesis: string;
  whyHumansMissThis: string;
  createdAt: string;
}

export type RuleFamily =
  | 'momentum_5'
  | 'mean_reversion_20'
  | 'wick_reversal'
  | 'range_breakout'
  | 'volatility_squeeze'
  | 'order_flow_imbalance';

export interface ExperimentMetrics {
  sampleSize: number;
  scoredTradeSampleSize: number;
  trainSampleSize: number;
  validationSampleSize: number;
  trainAccuracy: number;
  valAccuracy: number;
  testAccuracy: number;
  balancedAccuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  brierScore: number;
  calibrationError: number;
  winRate: number;
  expectedValuePips: number;
  profitFactor: number;
  maxDrawdownPips: number;
  confidenceInterval95: [number, number];
  confusionMatrix: {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
  };
}

export interface ResearchExperiment {
  id: string;
  experimentType?: 'BACKTEST' | 'LIVE_TRADE' | 'FORWARD_OBSERVATION';
  liveOutcome?: 'WIN' | 'LOSS' | 'SCRATCH';
  /** One forward observation's actual net result; not a model expected value. */
  observedNetPips?: number;
  /** One forward binary contract's return in stake units; separate from forex pips. */
  observedNetReturnUnits?: number;
  observedPayoutPct?: number;
  generation: number;
  name: string;
  symbol: ForexSymbol;
  ruleFamily: RuleFamily;
  horizonMinutes: number;
  parameters: Record<string, number | string>;
  featuresUsed: string[];
  metrics: ExperimentMetrics;
  
  // Split Metadata
  trainPeriod: { start: string; end: string };
  valPeriod: { start: string; end: string };
  testPeriod: { start: string; end: string };
  purgedWindowCandles: number;
  
  // Research Trinity Reviews
  scientistHypothesis: string;
  scientistDisproofCondition: string;
  engineerConfigNotes: string;
  auditorVerdict: 'ACCEPTED' | 'REJECTED' | 'PROVISIONAL';
  auditorConcerns: string[];
  
  createdAt: string;
}

export interface AgentReview {
  id: string;
  experimentId: string;
  role: 'SCIENTIST' | 'ENGINEER' | 'SKEPTICAL_AUDITOR';
  title: string;
  content: string;
  timestamp: string;
  verdict?: 'PROCEED' | 'HOLD' | 'REJECT';
  score?: number; // 0 - 100
}

export interface EvolutionSubGenerationMetrics {
  generation: number;
  candidateCount: number;
  qualifiedParentCount: number;
  distinctSpecies: number;
  bestValidationExpectedValueUnits: number;
  bestValidationWinRate: number;
  meanMutationRate: number;
}

export interface EvolutionGeneration {
  generation: number;
  timestamp: string;
  totalExperiments: number;
  acceptedCount: number;
  rejectedCount: number;
  topExperimentId: string | null;
  bestF1Score: number;
  summary: string;
  lessonsLearned: string[];
  /** Present only for real 300-candidate symbolic search batches. */
  researchBatchId?: string;
  /** Exact reproduction manifest for this evolutionary batch. */
  researchSeed?: string;
  datasetFingerprint?: string;
  featureSchemaVersion?: string;
  researchEngineVersion?: string;
  status?: 'COMPLETED' | 'FAILED';
  symbol?: ForexSymbol;
  bestValidationExpectedValueUnits?: number;
  holdoutPeriod?: { start: string; end: string };
  subGenerations?: EvolutionSubGenerationMetrics[];
}

export interface AutopilotLog {
  id: string;
  timestamp: string;
  role: 'MIND' | 'SCIENTIST' | 'ENGINEER' | 'AUDITOR' | 'EXECUTION';
  message: string;
  symbol?: ForexSymbol;
  signalId?: string;
}

export interface SystemHealthState {
  uptimeSeconds: number;
  dbType: 'JSON File Store' | 'Cloudflare D1';
  dbPath: string;
  totalCandlesStored: number;
  activeSignalsCount: number;
  totalExperimentsRun: number;
  totalForwardObservations?: number;
  lastCronRun: string | null;
  nextCronRun: string | null;
  isCronRunning: boolean;
  providers: ProviderHealth[];
  scheduler?: {
    schedulerStarted: boolean;
    serviceMode: string;
    pulseIntervalSeconds: number;
    lastHeartbeatAt: string | null;
    lastPulseAgeSeconds: number | null;
    pulseHealthy: boolean;
    warmupPending: boolean;
    cycleRunning: boolean;
    market: { isOpen: boolean; status: string; message: string };
    lastPulseSkippedReason: string | null;
    lastPulseError: string | null;
    paperStrategiesEligible: number;
    storedStrategyCandidates: number;
    strategyReadiness: string;
    strategyEligibility?: {
      storedCandidates: number;
      eligibleForPaperSignals: number;
      paperTradingCandidates: number;
      promotedCandidates: number;
      experimentingCandidates: number;
      rejectedCandidates: number;
      mutatingCandidates: number;
      statusCounts: Record<string, number>;
      historicalFailureCounts: Record<string, number>;
      forwardFailureCounts: Record<string, number>;
    };
    freshPairs: number;
    pairsScanned: number;
    blockedPairReasons: Array<{ reason: string; count: number }>;
    lastPulseResult?: { durationMs: number; pairsProcessed: number; signalsCreated: number; signalsUpdated: number } | null;
    pairDiagnostics: Array<{
      symbol: ForexSymbol;
      source: string;
      freshFeed: boolean;
      newestCandleAt: string | null;
      ageSeconds: number | null;
      candleCount: number;
      eligibleTimeframes: number[];
      eligibleStrategyPoolCount?: number;
      sessionCompatibleStrategyCount?: number;
      timeframeCompatibleStrategyCount?: number;
      strategiesEvaluated?: number;
      regimeRejected?: number;
      activationPassed?: number;
      memoryVetoes?: number;
      selectedTimeframe?: number | null;
      lastStrategyName?: string | null;
      signalPersisted?: boolean;
      signalCreationError?: string | null;
      result: string;
    }>;
  };
  evolutionResearch?: {
    status: string;
    message: string;
    nextScanAt?: string | null;
    requiredNewM1Candles: number;
  };
  strategyReadiness?: {
    storedCandidates: number;
    historicallyQualified: number;
    promoted: number;
    paperTrading: number;
    eligibilityDiagnostics?: {
      storedCandidates: number;
      eligibleForPaperSignals: number;
      paperTradingCandidates: number;
      promotedCandidates: number;
      experimentingCandidates: number;
      rejectedCandidates: number;
      mutatingCandidates: number;
      statusCounts: Record<string, number>;
      historicalFailureCounts: Record<string, number>;
      forwardFailureCounts: Record<string, number>;
    };
    status: string;
    researchStatus: string;
    researchMessage: string;
    requiredImportedM1Candles: number;
  };
  hosting?: {
    platform: string;
    backgroundCpuConfiguration: string;
    warning: string;
  };
  storage?: {
    mode: string;
    durableAcrossInstanceReplacement: boolean | null;
    multiInstanceSafe: boolean;
    warning: string;
  };
}

export interface VerificationTestResult {
  category: 'DATA' | 'ML' | 'ENTRY_EXIT' | 'RESEARCH' | 'SYSTEM' | 'MARKET_HOURS' | 'SCHEDULER';
  name: string;
  passed: boolean;
  durationMs: number;
  details: string;
  error?: string;
}
