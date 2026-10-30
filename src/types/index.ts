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

export type MarketSessionId = 'ASIA' | 'LONDON' | 'OVERLAP' | 'NEW_YORK';

export interface MarketSessionInfo {
  id: MarketSessionId;
  name: string;
  shortName: string;
  utcRange: string;
  istRange: string;
  isActive: boolean;
  winRate: number;
  hasMeasuredData: boolean;
  totalTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  netPips: number;
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
  source: 'biquote' | 'dukascopy' | 'yahoo' | 'synthetic' | 'imported';
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
  confidence: number; // 0.0 - 1.0
  calibrationStatus: 'CALIBRATED' | 'UNCALIBRATED' | 'OVERCONFIDENT';
  lifecycleState: SignalLifecycleState;
  lifecycleHistory: SignalLifecycleEvent[];
  
  // Outcome & Returns
  grossReturnPips: number | null;
  estimatedSpreadPips: number;
  netReturnPips: number | null;
  outcomeResult: 'WIN' | 'LOSS' | 'SCRATCH' | 'PENDING' | 'CANCELLED';
  
  // Model Meta & 5-Minute Candle Synchronization
  ruleFamily: string;
  modelVersion: string;
  notes?: string;
  strategyName?: string;
  /** Measured historical test win rate only; undefined means not validated. */
  strategyWinRate?: number;
  strategyHistoricalSampleSize?: number;
  strategyEvidenceStatus?: 'UNVALIDATED' | 'BACKTESTED';
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
  grossReturnPips: number;
  netReturnPips: number;
  spreadPips: number;
  marketSession: string;
  rootCause:
    | 'SPREAD_EXPANSION_SLIPPAGE'
    | 'MICRO_WICK_FALSE_ABSORPTION'
    | 'MOMENTUM_EXHAUSTION_DIVERGENCE'
    | 'SESSION_BOUNDARY_LIQUIDITY_VACUUM'
    | 'NON_LINEAR_OPERATOR_OVERFITTING';
  rootCauseExplanation: string;
  lessonsLearned: string[];
  antidoteStrategyGeneId: string;
  antidoteStrategyName: string;
  antidoteFormula: string;
  antidoteOperator: string;
  timestamp: string;
}

export interface StrategyBacktestMetrics {
  trainSampleSize: number;
  validationSampleSize: number;
  trainWinRate: number;
  validationWinRate: number;
  testWinRate: number;
  testAccuracy: number;
  testSampleSize: number;
  testScoredSampleSize: number;
  testWins: number;
  testLosses: number;
  expectedValuePips: number;
  profitFactor: number;
  confidenceInterval95: [number, number];
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
  netPips: number;
  positivePips: number;
  negativePips: number;
  updatedAt: string;
}

export interface StrategyPaperMetrics {
  trades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number;
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
  nonLinearOperator: 'tanh_polynomial' | 'fractal_power' | 'exponential_decay' | 'harmonic_dispersion';
  /** The same coefficients used by the live evaluator and historical backtester. */
  operatorParameters?: { alpha: number; beta: number; gamma: number; exponent: number; threshold: number };
  /** Currency pair used to validate this candidate against historical data. */
  symbol?: ForexSymbol;
  optimalHorizonMinutes: 5 | 10 | 15 | 20 | 25 | 30;
  sessionAffinity: MarketSessionId | 'ALL';
  /** Measured untouched-test win rate. Zero means no verified result exists. */
  verifiedAccuracy: number;
  /** Number of out-of-sample test trades, never a generated estimate. */
  sampleCount: number;
  accuracyStatus?: 'UNVALIDATED' | 'BACKTESTED';
  backtestMetrics?: StrategyBacktestMetrics;
  paperMetrics?: StrategyPaperMetrics;
  livePerformance?: StrategyPerformanceRecord;
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
  experimentType?: 'BACKTEST' | 'LIVE_TRADE';
  liveOutcome?: 'WIN' | 'LOSS' | 'SCRATCH';
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
  totalLiveObservations?: number;
  lastCronRun: string | null;
  nextCronRun: string | null;
  isCronRunning: boolean;
  providers: ProviderHealth[];
}

export interface VerificationTestResult {
  category: 'DATA' | 'ML' | 'ENTRY_EXIT' | 'RESEARCH' | 'SYSTEM';
  name: string;
  passed: boolean;
  durationMs: number;
  details: string;
  error?: string;
}
