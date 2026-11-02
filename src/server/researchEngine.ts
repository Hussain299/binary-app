/**
 * SignalForge ML — Historical research and strategy-validation engine.
 * Trains local models on chronological data and evaluates untouched outcomes.
 */
import type {
  AgentReview,
  Candle,
  ExperimentMetrics,
  MarketSessionId,
  ForexSymbol,
  ResearchExperiment,
  RuleFamily,
  SynthesizedStrategyGene,
  LossAutopsy,
  ResearchSignal,
  StrategyBacktestMetrics,
  StrategyExpressionNode,
  StrategyFeatureName,
  StrategyGenome,
} from '../types/index.ts';
import { db } from './db.ts';
import { calculateBinarySettlement, DEFAULT_BINARY_PAYOUT_PERCENT } from './binarySettlement.ts';
import { binaryBreakEvenWinRate, calculateAdaptiveMutationRate, outcomeFitsResearchWindow, selectEvolutionParents, wilsonLowerBound } from './evolutionEngine.ts';
import {
  ADVANCE_NOTICE_MS,
  ENTRY_CANDLE_TIMEFRAME_MINUTES,
  EXPIRY_HORIZONS_MINUTES,
  M1_CANDLE_MS,
  getNextCandleOpenMs,
  type ExpiryHorizonMinutes,
} from './tradingClock.ts';
import {
  createSeededRandom,
  deriveResearchSeed,
  FEATURE_SCHEMA_VERSION,
  fingerprintCandles,
  RESEARCH_ENGINE_VERSION,
  stableHash,
} from './researchReproducibility.ts';

type StrategyHorizon = ExpiryHorizonMinutes;
type GeneFeatureVector = Record<StrategyFeatureName, number>;

interface GeneResearchRow {
  decisionIndex: number;
  expiryMinutes: StrategyHorizon;
  candle: Candle;
  previousCandle: Candle;
  entryIndex: number;
  entryTimeMs: number;
  exitIndices: Record<number, number>;
  features: GeneFeatureVector;
  session: MarketSessionId;
}

interface PreparedGeneResearchData {
  candles: Candle[];
  closes: number[];
  ema9: number[];
  ema21: number[];
  rsi14: number[];
  rows: GeneResearchRow[];
  trainEndMs: number;
  validationStartMs: number;
  validationEndMs: number;
  testStartMs: number;
  payoutPct: number;
  excludedZeroVolumeFlatCandles: number;
}

export class ResearchEngine {
  private evolutionBatchRunning = false;

  public isEvolutionBatchRunning(): boolean {
    return this.evolutionBatchRunning;
  }

  /** Shared lock prevents UI-triggered and scheduled searches from racing on holdout data. */
  public async runNovelStrategySearchBatch(
    symbol: ForexSymbol,
    candles: Candle[],
    searchBatchId: string,
    baseGeneration: number,
    onProgress: (progress: {
      completed: number;
      passedHistorical: number;
      insufficientSample: number;
      rejected: number;
      replicationFinalists: number;
    }) => void
  ): Promise<SynthesizedStrategyGene[]> {
    if (this.evolutionBatchRunning) {
      throw new Error('An evolutionary research batch is already running.');
    }
    this.evolutionBatchRunning = true;
    try {
      return await this.runNovelStrategySearchBatchInternal(
        symbol, candles, searchBatchId, baseGeneration, onProgress
      );
    } finally {
      this.evolutionBatchRunning = false;
    }
  }


  /**
   * Computes technical features from candles:
   * Returns, Candle body/wick ratios, ATR(14), RSI(14), EMA(9)-EMA(21) slope, Range position.
   */
  public extractFeatures(
    candles: Candle[],
    expiryMinutes: StrategyHorizon = 5
  ): Array<{
    candle: Candle;
    features: number[];
    labels: Record<number, number>;
    futureMoves: Record<number, number>;
    entryTimeMs: number;
    expiryTimeMs: number;
    exitCandleTimeMs: number;
    entryTimeframeMinutes: typeof ENTRY_CANDLE_TIMEFRAME_MINUTES;
    expiryMinutes: StrategyHorizon;
  }> {
    const n = candles.length;
    if (n < 70) return [];
    if (!(EXPIRY_HORIZONS_MINUTES as readonly number[]).includes(expiryMinutes)) {
      throw new Error('Research expiry must be between 5 and 30 minutes in 5-minute steps.');
    }

    const isJpy = candles[0].symbol.includes('JPY');
    const pipFactor = isJpy ? 100 : 10000;
    const samples: Array<{
      candle: Candle;
      features: number[];
      labels: Record<number, number>;
      futureMoves: Record<number, number>;
      entryTimeMs: number;
      expiryTimeMs: number;
      exitCandleTimeMs: number;
      entryTimeframeMinutes: typeof ENTRY_CANDLE_TIMEFRAME_MINUTES;
      expiryMinutes: StrategyHorizon;
    }> = [];

    const closes = candles.map(item => item.close);
    const ema9 = this.calculateEMA(closes, 9);
    const ema21 = this.calculateEMA(closes, 21);
    const rsi14 = this.calculateRSI(closes, 14);
    const atr14 = this.calculateATR(candles, 14);

    // The M1 decision candle closes exactly three minutes before the next M5
    // entry candle opens. The strategy's independent expiry horizon is measured
    // from that M5 open and settles on the exact M1 candle at entry + expiry.
    for (let i = 25; i < n - expiryMinutes - 5; i++) {
      const candle = candles[i];
      const previous = candles[i - 1];
      const decisionTime = candle.timestampMs + M1_CANDLE_MS;
      const entryTime = getNextCandleOpenMs(
        decisionTime,
        ENTRY_CANDLE_TIMEFRAME_MINUTES
      );
      if (Math.abs(entryTime - decisionTime - ADVANCE_NOTICE_MS) > 5_000) continue;

      let entryIndex = i + 1;
      while (entryIndex < n && candles[entryIndex].timestampMs < entryTime - 5_000) entryIndex++;
      if (entryIndex >= n || Math.abs(candles[entryIndex].timestampMs - entryTime) > 5_000) continue;

      const expiryTime = entryTime + expiryMinutes * M1_CANDLE_MS;
      const exitCandleTime = expiryTime - M1_CANDLE_MS;
      let exitIndex = entryIndex;
      while (exitIndex < n && candles[exitIndex].timestampMs < exitCandleTime - 5_000) exitIndex++;
      if (exitIndex >= n ||
          Math.abs(candles[exitIndex].timestampMs - exitCandleTime) > 5_000) continue;

      const range = Math.max(0.00001, candle.high - candle.low);
      const body = Math.abs(candle.close - candle.open);
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      let min20 = Infinity;
      let max20 = -Infinity;
      for (let k = i - 19; k <= i; k++) {
        min20 = Math.min(min20, candles[k].low);
        max20 = Math.max(max20, candles[k].high);
      }
      const features = [
        (candle.close - previous.close) * pipFactor,
        body / range,
        upperWick / range,
        lowerWick / range,
        (ema9[i] - ema21[i]) * pipFactor,
        (rsi14[i] || 50) / 100,
        (atr14[i] || 0.0005) * pipFactor,
        (candle.close - min20) / Math.max(0.00001, max20 - min20),
      ];
      const move = candles[exitIndex].close - candles[entryIndex].open;
      samples.push({
        candle,
        features,
        labels: { [expiryMinutes]: move > 0 ? 1 : 0 },
        futureMoves: { [expiryMinutes]: move },
        entryTimeMs: entryTime,
        expiryTimeMs: expiryTime,
        exitCandleTimeMs: candles[exitIndex].timestampMs,
        entryTimeframeMinutes: ENTRY_CANDLE_TIMEFRAME_MINUTES,
        expiryMinutes,
      });
    }
    return samples;
  }

  /**
   * Executes a Purged Walk-Forward validation experiment.
   * Train (60%), Purge Embargo (H candles), Validation (20%), Purge Embargo (H candles), Test (20%).
   */
  public runWalkForwardExperiment(
    symbol: ForexSymbol,
    candles: Candle[],
    ruleFamily: RuleFamily,
    horizonMinutes: number,
    generation: number,
    options: { allowTestFixtures?: boolean } = {}
  ): ResearchExperiment {
    if (![5, 10, 15, 20, 25, 30].includes(horizonMinutes)) {
      throw new Error('Supported research horizons are 5, 10, 15, 20, 25 and 30 minutes.');
    }
    if (candles.some(c => c.source === 'synthetic' || (c.source === 'test_fixture' && !options.allowTestFixtures))) {
      throw new Error('Research backtests require uploaded non-synthetic market candles. Synthetic and test-fixture candles are not eligible.');
    }
    if (!candles.every(c => Number.isFinite(c.timestampMs) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close))) {
      throw new Error('Historical dataset contains invalid candle values.');
    }

    // Only after validating input eligibility do we reject production use of
    // this legacy endpoint. Isolated test fixtures may exercise its calculations.
    if (!options.allowTestFixtures) {
      throw new Error('Legacy single-rule walk-forward experiments are disabled. Use the registered 300-candidate evolutionary batch with one-time holdout reservation.');
    }

    const minuteSteps = candles.slice(1).filter((c, i) =>
      Math.abs((c.timestampMs - candles[i].timestampMs) - 60_000) <= 5_000
    ).length;
    if (minuteSteps / Math.max(1, candles.length - 1) < 0.75) {
      throw new Error('Dataset is not a sufficiently continuous one-minute candle series. Import suitable M1 history.');
    }

    // Only rows with a valid, causal 3-minute advance decision and exact scheduled
    // M5 entry/expiry candles are eligible for this execution-aligned model study.
    const dataset = this.extractFeatures(candles, horizonMinutes as StrategyHorizon).filter(item =>
      Number.isFinite(item.labels[horizonMinutes]) &&
      Number.isFinite(item.futureMoves[horizonMinutes])
    );
    const total = dataset.length;
    if (total < 100) {
      throw new Error(`Insufficient eligible scheduled-entry samples (${total}). Import more suitable one-minute historical candles.`);
    }

    // Samples occur at each M5 entry boundary, regardless of expiry. Purge
    // enough M5 opportunities to cover the selected forward expiry label.
    const purgeSamples = Math.ceil(horizonMinutes / ENTRY_CANDLE_TIMEFRAME_MINUTES);
    const trainEnd = Math.floor(total * 0.60);
    const validationStart = trainEnd + purgeSamples;
    const validationEnd = Math.min(total, validationStart + Math.floor(total * 0.20));
    const testStart = validationEnd + purgeSamples;
    const trainSet = dataset.slice(0, trainEnd);
    const validationSet = dataset.slice(validationStart, validationEnd);
    const testSet = dataset.slice(testStart);
    if (trainSet.length < 50 || validationSet.length < 30 || testSet.length < 30) {
      throw new Error(
        `Insufficient independent chronological samples after embargo (train=${trainSet.length}, validation=${validationSet.length}, test=${testSet.length}). Import more history.`
      );
    }

    const featureDefinitions = [
      'Normalized M1 Return',
      'Candle Body Ratio',
      'Upper Wick Ratio',
      'Lower Wick Ratio',
      'EMA 9/21 Spread',
      'RSI 14',
      'ATR 14 (Pips)',
      '20-Candle Range Position',
    ];
    const featureSelection: Record<RuleFamily, number[]> = {
      momentum_5: [0, 1, 4, 6],
      mean_reversion_20: [0, 5, 6, 7],
      wick_reversal: [1, 2, 3, 5],
      range_breakout: [0, 1, 4, 6, 7],
      volatility_squeeze: [1, 2, 3, 6, 7],
      order_flow_imbalance: [0, 1, 2, 3, 4, 6],
    };
    const selectedIndices = featureSelection[ruleFamily];
    const selectedFeatures = selectedIndices.map(index => featureDefinitions[index]);

    // Fit standardization strictly on the training set.
    const featureCount = selectedIndices.length;
    const means = new Array(featureCount).fill(0);
    const stds = new Array(featureCount).fill(0);
    for (const item of trainSet) {
      selectedIndices.forEach((sourceIndex, featureIndex) => {
        means[featureIndex] += item.features[sourceIndex];
      });
    }
    for (let j = 0; j < featureCount; j++) means[j] /= trainSet.length;
    for (const item of trainSet) {
      selectedIndices.forEach((sourceIndex, featureIndex) => {
        stds[featureIndex] += Math.pow(item.features[sourceIndex] - means[featureIndex], 2);
      });
    }
    for (let j = 0; j < featureCount; j++) stds[j] = Math.sqrt(stds[j] / trainSet.length) || 1;
    const scaleFeatures = (features: number[]) =>
      selectedIndices.map((sourceIndex, featureIndex) =>
        Math.max(-8, Math.min(8, (features[sourceIndex] - means[featureIndex]) / stds[featureIndex]))
      );

    // Actual logistic-regression fitting. Coefficients are learned from TRAIN only;
    // no family-specific fixed weights or test-set tuning are used.
    const epochs = 600;
    const learningRate = 0.03;
    const l2Penalty = 0.001;
    const weights = new Array(featureCount).fill(0);
    let bias = 0;
    const sigmoid = (value: number) => 1 / (1 + Math.exp(-Math.max(-25, Math.min(25, value))));
    for (let epoch = 0; epoch < epochs; epoch++) {
      const gradients = new Array(featureCount).fill(0);
      let biasGradient = 0;
      for (const item of trainSet) {
        const z = scaleFeatures(item.features);
        const logit = z.reduce((sum, value, index) => sum + value * weights[index], bias);
        const error = sigmoid(logit) - item.labels[horizonMinutes];
        for (let j = 0; j < featureCount; j++) gradients[j] += error * z[j];
        biasGradient += error;
      }
      for (let j = 0; j < featureCount; j++) {
        weights[j] -= learningRate * (gradients[j] / trainSet.length + l2Penalty * weights[j]);
      }
      bias -= learningRate * biasGradient / trainSet.length;
    }

    const predictProbability = (item: (typeof dataset)[number]) => {
      const z = scaleFeatures(item.features);
      return sigmoid(z.reduce((sum, value, index) => sum + value * weights[index], bias));
    };

    const isJpy = symbol.includes('JPY');
    const pipFactor = isJpy ? 100 : 10000;
    const pairSpreads: Record<string, number> = {
      'EUR/USD': 1.1, 'GBP/USD': 1.6, 'USD/JPY': 1.2, 'EUR/JPY': 1.8,
      'AUD/USD': 1.4, 'USD/CAD': 1.7, 'EUR/GBP': 1.2, 'AUD/CAD': 1.8,
      'AUD/CHF': 1.9, 'AUD/JPY': 1.7, 'AUD/NZD': 2.0, 'EUR/AUD': 1.9,
      'EUR/CAD': 1.8, 'EUR/CHF': 1.6, 'EUR/NZD': 2.2, 'GBP/AUD': 2.2,
      'GBP/CAD': 2.0, 'GBP/CHF': 2.1, 'GBP/JPY': 2.0, 'GBP/NZD': 2.4,
    };
    const modeledSpreadPips = pairSpreads[symbol] ?? 1.5;

    const evaluateSet = (items: typeof dataset, threshold: number) => {
      let trades = 0, correct = 0, tp = 0, fp = 0, tn = 0, fn = 0;
      let brierSum = 0, totalPips = 0;
      const calibrationBins = Array.from({ length: 10 }, () => ({ count: 0, probabilitySum: 0, actualSum: 0 }));
      let positivePips = 0, negativePips = 0, wins = 0, losses = 0, scratches = 0;
      let peakPips = 0, maxDrawdown = 0;
      for (const item of items) {
        const probability = predictProbability(item);
        const actual = item.labels[horizonMinutes];
        brierSum += Math.pow(probability - actual, 2);
        const calibrationBinIndex = Math.min(9, Math.floor(probability * 10));
        const calibrationBin = calibrationBins[calibrationBinIndex];
        calibrationBin.count++;
        calibrationBin.probabilitySum += probability;
        calibrationBin.actualSum += actual;

        // The validation-selected threshold abstains on low-conviction samples.
        let prediction: number | null = null;
        if (probability >= threshold) prediction = 1;
        else if (probability <= 1 - threshold) prediction = 0;
        if (prediction === null) continue;

        trades++;
        if (prediction === actual) correct++;
        if (prediction === 1 && actual === 1) tp++;
        else if (prediction === 1 && actual === 0) fp++;
        else if (prediction === 0 && actual === 0) tn++;
        else fn++;

        const grossMovePips = item.futureMoves[horizonMinutes] * pipFactor;
        const netTradePips = (prediction === 1 ? grossMovePips : -grossMovePips) - modeledSpreadPips;
        totalPips += netTradePips;
        if (netTradePips > 0.5) { wins++; positivePips += netTradePips; }
        else if (netTradePips < -0.5) { losses++; negativePips += Math.abs(netTradePips); }
        else scratches++;
        if (totalPips > peakPips) peakPips = totalPips;
        maxDrawdown = Math.max(maxDrawdown, peakPips - totalPips);
      }

      const scoredTrades = wins + losses;
      const denominator = Math.max(1, trades);
      const expectedCalibrationError = calibrationBins.reduce((sum, bin) => {
        if (bin.count === 0) return sum;
        const averageProbability = bin.probabilitySum / bin.count;
        const observedFrequency = bin.actualSum / bin.count;
        return sum + (bin.count / Math.max(1, items.length)) * Math.abs(averageProbability - observedFrequency);
      }, 0);
      const sensitivity = tp / Math.max(1, tp + fn);
      const specificity = tn / Math.max(1, tn + fp);
      const precision = tp / Math.max(1, tp + fp);
      const recall = sensitivity;
      const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
      return {
        trades, wins, losses, scratches, correct, tp, fp, tn, fn,
        accuracy: correct / denominator,
        balancedAccuracy: (sensitivity + specificity) / 2,
        precision, recall, f1,
        brierScore: brierSum / Math.max(1, items.length),
        calibrationError: expectedCalibrationError,
        winRate: wins / Math.max(1, scoredTrades),
        expectedValuePips: totalPips / denominator,
        profitFactor: negativePips > 0 ? positivePips / negativePips : (positivePips > 0 ? 99 : 0),
        totalPips,
        maxDrawdown,
        positivePips,
        negativePips,
      };
    };

    // Tune only the abstention threshold on validation data. The untouched test
    // period is evaluated once, after this choice is frozen.
    const thresholdCandidates = [0.50, 0.525, 0.55, 0.575, 0.60, 0.625, 0.65];
    let selectedThreshold = 0.50;
    let bestValidation: ReturnType<typeof evaluateSet> | null = null;
    for (const candidateThreshold of thresholdCandidates) {
      const candidateMetrics = evaluateSet(validationSet, candidateThreshold);
      if (candidateMetrics.trades < 20) continue;
      if (
        !bestValidation ||
        candidateMetrics.expectedValuePips > bestValidation.expectedValuePips
      ) {
        selectedThreshold = candidateThreshold;
        bestValidation = candidateMetrics;
      }
    }
    if (!bestValidation) {
      if (options.allowTestFixtures) {
        selectedThreshold = 0.50;
        bestValidation = evaluateSet(validationSet, selectedThreshold);
      } else {
        throw new Error('Validation period did not produce at least 20 eligible trades for threshold selection.');
      }
    }

    const trainMetrics = evaluateSet(trainSet, selectedThreshold);
    const validationMetrics = bestValidation;
    const testMetrics = evaluateSet(testSet, selectedThreshold);
    // Synthetic fixtures exercise calculation and report wiring only. These
    // results never enter the real database or approval pipeline.
    if (!options.allowTestFixtures &&
        (trainMetrics.trades < 30 || validationMetrics.trades < 20 || testMetrics.trades < 30)) {
      throw new Error(
        `Insufficient executed model trades (train=${trainMetrics.trades}, validation=${validationMetrics.trades}, test=${testMetrics.trades}). Import more historical data.`
      );
    }

    // Wilson interval for the untouched test-set net-positive win rate.
    const zCrit = 1.96;
    const scoredTestTrades = Math.max(1, testMetrics.wins + testMetrics.losses);
    const p = testMetrics.wins / scoredTestTrades;
    const denominator = 1 + (zCrit * zCrit) / scoredTestTrades;
    const center = (p + (zCrit * zCrit) / (2 * scoredTestTrades)) / denominator;
    const margin = (
      zCrit * Math.sqrt(
        (p * (1 - p)) / scoredTestTrades +
        (zCrit * zCrit) / (4 * scoredTestTrades * scoredTestTrades)
      )
    ) / denominator;
    const ciLow = Math.max(0, Number((center - margin).toFixed(3)));
    const ciHigh = Math.min(1, Number((center + margin).toFixed(3)));

    const testTotal = testMetrics.trades;
    const trainAccuracy = Number(trainMetrics.accuracy.toFixed(3));
    const valAccuracy = Number(validationMetrics.accuracy.toFixed(3));
    const testAccuracy = Number(testMetrics.accuracy.toFixed(3));
    const balancedAccuracy = Number(testMetrics.balancedAccuracy.toFixed(3));
    const precision = Number(testMetrics.precision.toFixed(3));
    const recall = Number(testMetrics.recall.toFixed(3));
    const f1Score = Number(testMetrics.f1.toFixed(3));
    const brierScore = Number(testMetrics.brierScore.toFixed(4));
    const calibrationError = Number(testMetrics.calibrationError.toFixed(3));
    const winRate = Number(testMetrics.winRate.toFixed(3));
    const profitFactor = Number(testMetrics.profitFactor.toFixed(2));
    const totalPips = testMetrics.totalPips;
    const maxDrawdownPips = Number(testMetrics.maxDrawdown.toFixed(2));

    const auditorConcerns: string[] = [];
    if (trainAccuracy - valAccuracy > 0.10) {
      auditorConcerns.push(`Training directional accuracy exceeds validation by more than 10 percentage points.`);
    }
    if (scoredTestTrades < 100) {
      auditorConcerns.push(`Insufficient untouched scored WIN/LOSS outcomes (${scoredTestTrades}); minimum 100 required for acceptance.`);
    }
    if (testAccuracy < 0.52) {
      auditorConcerns.push(`Out-of-sample directional accuracy below 52% (${testAccuracy}).`);
    }
    if (brierScore > 0.25) {
      auditorConcerns.push(`Poor probability calibration (Brier score ${brierScore}).`);
    }
    if (profitFactor < 1.15 || testMetrics.expectedValuePips <= 0) {
      auditorConcerns.push(`Transaction-cost-adjusted expectancy is not robust (PF ${profitFactor}, EV ${testMetrics.expectedValuePips.toFixed(2)} pips).`);
    }

    let auditorVerdict: 'ACCEPTED' | 'REJECTED' | 'PROVISIONAL' = 'ACCEPTED';
    if (auditorConcerns.length >= 2 || testAccuracy < 0.50 || scoredTestTrades < 100) {
      auditorVerdict = 'REJECTED';
    } else if (auditorConcerns.length === 1) {
      auditorVerdict = 'PROVISIONAL';
    }

    const metrics: ExperimentMetrics = {
      sampleSize: testTotal,
      scoredTradeSampleSize: scoredTestTrades,
      trainSampleSize: trainMetrics.trades,
      validationSampleSize: validationMetrics.trades,
      trainAccuracy,
      valAccuracy,
      testAccuracy,
      balancedAccuracy,
      precision,
      recall,
      f1Score,
      brierScore,
      calibrationError,
      winRate,
      expectedValuePips: Number(testMetrics.expectedValuePips.toFixed(2)),
      profitFactor,
      maxDrawdownPips,
      confidenceInterval95: [ciLow, ciHigh],
      confusionMatrix: { tp: testMetrics.tp, fp: testMetrics.fp, tn: testMetrics.tn, fn: testMetrics.fn },
    };

    const expId = `exp_${Date.now()}_${ruleFamily}_${horizonMinutes}m`;
    const expName = `${symbol} [${ruleFamily}] ${horizonMinutes}m Horizon`;
    const experiment: ResearchExperiment = {
      id: expId,
      experimentType: 'BACKTEST',
      generation,
      name: expName,
      symbol,
      ruleFamily,
      horizonMinutes,
      parameters: {
        threshold: selectedThreshold,
        purgeEmbargoMinutes: purgeSamples * horizonMinutes,
        featureCount,
        spreadModeledPips: modeledSpreadPips,
        algorithm: 'logistic_regression',
        testFixture: options.allowTestFixtures === true ? 'true' : 'false',
        epochs,
        learningRate,
        l2Penalty,
      },
      featuresUsed: selectedFeatures,
      metrics,
      trainPeriod: {
        start: trainSet[0].candle.timestamp,
        end: trainSet[trainSet.length - 1].candle.timestamp,
      },
      valPeriod: {
        start: validationSet[0].candle.timestamp,
        end: validationSet[validationSet.length - 1].candle.timestamp,
      },
      testPeriod: {
        start: testSet[0].candle.timestamp,
        end: testSet[testSet.length - 1].candle.timestamp,
      },
      purgedWindowCandles: purgeSamples * horizonMinutes,
      scientistHypothesis: `A train-fitted logistic-regression model using ${ruleFamily} features may predict direction at the scheduled ${horizonMinutes}-minute expiry.`,
      scientistDisproofCondition: `Disproven if untouched test directional accuracy is below 52%, or after modeled spread the test EV is not positive and profit factor is below 1.15.`,
      engineerConfigNotes: `Logistic regression fitted on ${trainSet.length} training opportunities. Feature means/stds fitted on training only. Threshold ${selectedThreshold} tuned on ${validationSet.length} validation opportunities. Each opportunity uses the 3-minute advance alert, scheduled next M5 open and ${horizonMinutes}-minute expiry; pair-specific modeled spread ${modeledSpreadPips} pips.`,
      auditorVerdict,
      auditorConcerns,
      createdAt: new Date().toISOString(),
    };

    if (!options.allowTestFixtures) db.addExperiment(experiment);
    return experiment;
  }

  /** Creates deterministic role-based review notes from the recorded metrics and audit flags. */
  public async generateTrinityReviews(exp: ResearchExperiment): Promise<AgentReview[]> {
    const reviews: AgentReview[] = [];
    const nowIso = new Date().toISOString();
    const isForwardObservation = exp.experimentType === 'FORWARD_OBSERVATION' || exp.experimentType === 'LIVE_TRADE';

    const scientistContent = isForwardObservation
      ? `One forward observation was recorded: outcome ${exp.liveOutcome || 'not recorded'}, net result ${(exp.observedNetPips ?? 0) > 0 ? '+' : ''}${(exp.observedNetPips ?? 0)} pips. A single trade cannot estimate win rate, expected value, calibration, or market-regime effects.`
      : `The stated hypothesis was: "${exp.scientistHypothesis}". The untouched test contained ${exp.metrics.sampleSize} opportunities and ${exp.metrics.scoredTradeSampleSize} scored WIN/LOSS outcomes. Observed balanced accuracy was ${(exp.metrics.balancedAccuracy * 100).toFixed(1)}% and modeled expected value was ${exp.metrics.expectedValuePips} pips. This run does not establish a market-regime effect. Falsification screen: ${exp.metrics.balancedAccuracy >= 0.52 ? 'the balanced-accuracy screen was crossed; independent evidence is still required.' : 'the balanced-accuracy screen was not crossed.'}`;

    const scientistReview: AgentReview = {
      id: `rev_sci_${exp.id}`,
      experimentId: exp.id,
      role: 'SCIENTIST',
      title: `Hypothesis & Evidence Review: ${exp.name}`,
      content: scientistContent,
      timestamp: nowIso,
      verdict: isForwardObservation ? 'HOLD' : exp.metrics.balancedAccuracy >= 0.52 ? 'PROCEED' : 'REJECT',
    };

    const engineerContent = isForwardObservation
      ? `Forward observation record only. Entry: ${exp.parameters.actualEntryPrice ?? 'not recorded'}; exit: ${exp.parameters.actualExitPrice ?? 'not recorded'}; expiry: ${exp.horizonMinutes}m. No model training or historical validation metrics are computed from this row.`
      : `Research pipeline configuration for generation ${exp.generation}.
- Model: logistic regression fitted only on the chronological training partition.
- Threshold: selected from a fixed candidate set using validation EV, then frozen before the untouched test.
- Execution alignment: closed M1 decision exactly three minutes before the ${exp.horizonMinutes}m entry candle open and matching expiry.
- Purged embargo: ${exp.purgedWindowCandles} M1 candles between partitions.
- Test opportunities: n=${exp.metrics.sampleSize}; scored WIN/LOSS outcomes: n=${exp.metrics.scoredTradeSampleSize}.`;

    const engineerReview: AgentReview = {
      id: `rev_eng_${exp.id}`,
      experimentId: exp.id,
      role: 'ENGINEER',
      title: 'Data, Model and Execution Configuration Review',
      content: engineerContent,
      timestamp: nowIso,
      verdict: isForwardObservation ? 'HOLD' : 'PROCEED',
    };

    const spreadPips = Number(exp.parameters.spreadModeledPips ?? 0);
    const auditorContent = isForwardObservation
      ? `Skeptical audit: PROVISIONAL. One forward trade is retained for outcome tracking only. It cannot pass or fail the strategy's historical validation gate. No model-accuracy, confidence-interval, or profit-factor claim is made from this record.`
      : `Skeptical audit verdict: ${exp.auditorVerdict}.
- Train accuracy: ${(exp.metrics.trainAccuracy * 100).toFixed(1)}%; validation accuracy: ${(exp.metrics.valAccuracy * 100).toFixed(1)}%.
- Brier score: ${exp.metrics.brierScore}; calibration error: ${(exp.metrics.calibrationError * 100).toFixed(1)}%.
- Modeled transaction cost: ${spreadPips.toFixed(2)} pips; resulting profit factor: ${exp.metrics.profitFactor}.
${exp.auditorConcerns.length > 0 ? `Identified concerns:\n${exp.auditorConcerns.map(c => `• ${c}`).join('\n')}` : 'No configured audit threshold was breached in this run; this is not a guarantee of future performance.'}
Policy: ${exp.auditorVerdict === 'ACCEPTED'
  ? 'Eligible for candidate-pool consideration only; forward testing is still required.'
  : exp.auditorVerdict === 'PROVISIONAL'
    ? 'Hold for more evidence; do not promote.'
    : 'Rejected; do not promote.'}`;

    const auditorReview: AgentReview = {
      id: `rev_aud_${exp.id}`,
      experimentId: exp.id,
      role: 'SKEPTICAL_AUDITOR',
      title: 'Skeptical Evidence and Overfitting Audit',
      content: auditorContent,
      timestamp: nowIso,
      verdict: isForwardObservation || exp.auditorVerdict === 'PROVISIONAL'
        ? 'HOLD'
        : exp.auditorVerdict === 'ACCEPTED' ? 'PROCEED' : 'REJECT',
    };

    reviews.push(scientistReview, engineerReview, auditorReview);
    if (exp.parameters.testFixture !== 'true') {
      for (const review of reviews) db.addReview(review);
    }
    return reviews;
  }

  public calculateEMA(values: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const emaArray: number[] = [];
    let prevEma = values[0] || 0;
    emaArray.push(prevEma);

    for (let i = 1; i < values.length; i++) {
      const current = values[i] * k + prevEma * (1 - k);
      emaArray.push(current);
      prevEma = current;
    }
    return emaArray;
  }

  public calculateRSI(prices: number[], period: number = 14): number[] {
    const rsi: number[] = new Array(prices.length).fill(50);
    if (prices.length <= period) return rsi;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff >= 0) {
        avgGain = (avgGain * (period - 1) + diff) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) - diff) / period;
      }

      if (avgLoss === 0) {
        rsi[i] = 100;
      } else {
        const rs = avgGain / avgLoss;
        rsi[i] = Number((100 - 100 / (1 + rs)).toFixed(1));
      }
    }

    return rsi;
  }

  public calculateATR(candles: Candle[], period: number = 14): number[] {
    const atr: number[] = new Array(candles.length).fill(0.001);
    if (candles.length <= period) return atr;

    const tr: number[] = [candles[0].high - candles[0].low];
    for (let i = 1; i < candles.length; i++) {
      const h = candles[i].high;
      const l = candles[i].low;
      const prevC = candles[i - 1].close;
      const trueRange = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
      tr.push(trueRange);
    }

    let sum = 0;
    for (let i = 0; i < period; i++) sum += tr[i];
    let prevAtr = sum / period;
    atr[period - 1] = prevAtr;

    for (let i = period; i < candles.length; i++) {
      const currentAtr = (prevAtr * (period - 1) + tr[i]) / period;
      atr[i] = currentAtr;
      prevAtr = currentAtr;
    }

    return atr;
  }

  /** Samples a formula candidate and stores its exact executable parameters; this is not validation. */
  private clamp(value: number, min = -8, max = 8): number {
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;
  }

  private readonly genomeFeatures: StrategyFeatureName[] = [
    'return_1', 'return_3', 'return_5', 'return_13',
    'body_direction', 'body_ratio', 'wick_imbalance', 'close_location',
    'ema_spread', 'ema_curvature', 'rsi_centered', 'rsi_momentum',
    'range_position_13', 'range_position_34', 'volatility_ratio',
    'directional_efficiency', 'return_autocorrelation',
    'wick_pressure_change', 'range_expansion',
  ];

  private buildGeneFeatureVector(
    candle: Candle,
    previous: Candle,
    closes: number[],
    ema9: number[],
    ema21: number[],
    rsi14: number[],
    index: number
  ): GeneFeatureVector {
    const pipFactor = candle.symbol.includes('JPY') ? 100 : 10000;
    const close = closes[index] ?? candle.close;
    const safeRange = Math.max(1e-8, candle.high - candle.low);
    const body = candle.close - candle.open;
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const wickImbalance = (lowerWick - upperWick) / safeRange;
    const currentEmaSpread = ((ema9[index] ?? close) - (ema21[index] ?? close)) * pipFactor;
    const previousEmaSpread = ((ema9[Math.max(0, index - 1)] ?? close) - (ema21[Math.max(0, index - 1)] ?? close)) * pipFactor;
    const currentRsi = rsi14[index] || 50;
    const previousRsi = rsi14[Math.max(0, index - 3)] || currentRsi;

    const absReturns: number[] = [];
    const returns: number[] = [];
    for (let i = Math.max(1, index - 60); i <= index; i++) {
      const change = (closes[i] - closes[i - 1]) * pipFactor;
      returns.push(change);
      absReturns.push(Math.abs(change));
    }
    const meanAbs = absReturns.length
      ? absReturns.reduce((sum, value) => sum + value, 0) / absReturns.length
      : 0.1;
    const scale = Math.max(0.05, meanAbs * 1.5);

    const normalizedReturn = (lookback: number) => {
      const prior = closes[Math.max(0, index - lookback)] ?? close;
      return Math.tanh(((close - prior) * pipFactor) / (scale * Math.sqrt(lookback) * 2.5));
    };
    const rangePosition = (lookback: number) => {
      const start = Math.max(0, index - lookback + 1);
      let low = Infinity, high = -Infinity;
      for (let i = start; i <= index; i++) {
        low = Math.min(low, closes[i]);
        high = Math.max(high, closes[i]);
      }
      const width = Math.max(1e-8, high - low);
      return this.clamp(((close - low) / width) * 2 - 1, -1, 1);
    };
    const volatility = (period: number) => {
      const values = returns.slice(-period);
      if (values.length < 2) return 0;
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
      return Math.sqrt(Math.max(0, variance));
    };
    const shortVol = volatility(5);
    const longVol = Math.max(0.01, volatility(21));
    const efficiencyWindow = Math.min(13, index);
    let pathLength = 0;
    for (let i = index - efficiencyWindow + 1; i <= index; i++) {
      if (i > 0) pathLength += Math.abs((closes[i] - closes[i - 1]) * pipFactor);
    }
    const directionalEfficiency = pathLength > 0
      ? ((close - (closes[index - efficiencyWindow] ?? close)) * pipFactor) / pathLength
      : 0;

    const corrReturns = returns.slice(-21);
    let autocorrelation = 0;
    if (corrReturns.length >= 4) {
      const left = corrReturns.slice(1);
      const right = corrReturns.slice(0, -1);
      const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
      const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
      let numerator = 0, leftVariance = 0, rightVariance = 0;
      for (let i = 0; i < left.length; i++) {
        const x = left[i] - leftMean;
        const y = right[i] - rightMean;
        numerator += x * y;
        leftVariance += x * x;
        rightVariance += y * y;
      }
      autocorrelation = leftVariance > 0 && rightVariance > 0
        ? numerator / Math.sqrt(leftVariance * rightVariance)
        : 0;
    }

    const previousRange = Math.max(1e-8, previous.high - previous.low);
    const previousWick = (
      Math.min(previous.open, previous.close) - previous.low -
      (previous.high - Math.max(previous.open, previous.close))
    ) / previousRange;
    const rangeExpansion = (safeRange * pipFactor) / Math.max(0.05, meanAbs * 8);

    return {
      return_1: normalizedReturn(1),
      return_3: normalizedReturn(3),
      return_5: normalizedReturn(5),
      return_13: normalizedReturn(13),
      body_direction: this.clamp(body / safeRange, -1, 1),
      body_ratio: this.clamp(Math.abs(body) / safeRange, 0, 1) * 2 - 1,
      wick_imbalance: this.clamp(wickImbalance, -1, 1),
      close_location: this.clamp(((candle.close - candle.low) / safeRange) * 2 - 1, -1, 1),
      ema_spread: Math.tanh(currentEmaSpread / Math.max(0.1, scale * 8)),
      ema_curvature: Math.tanh((currentEmaSpread - previousEmaSpread) / Math.max(0.1, scale * 2)),
      rsi_centered: this.clamp((currentRsi - 50) / 50, -1, 1),
      rsi_momentum: Math.tanh((currentRsi - previousRsi) / 12),
      range_position_13: rangePosition(13),
      range_position_34: rangePosition(34),
      volatility_ratio: Math.tanh((shortVol / longVol) - 1),
      directional_efficiency: this.clamp(directionalEfficiency, -1, 1),
      return_autocorrelation: this.clamp(autocorrelation, -1, 1),
      wick_pressure_change: this.clamp(wickImbalance - previousWick, -1, 1),
      range_expansion: Math.tanh(rangeExpansion - 1),
    };
  }

  /** Returns the exact ordered normalized feature vector used by symbolic genomes. */
  public extractCausalFeatureVector(
    candle: Candle,
    previous: Candle,
    closes: number[],
    ema9: number[],
    ema21: number[],
    rsi14: number[],
    index: number = closes.length - 1
  ): number[] {
    if (index < 34 || index >= closes.length ||
        ![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) {
      throw new Error("Causal feature extraction requires a valid candle and at least 35 indexed closes.");
    }
    const features = this.buildGeneFeatureVector(candle, previous, closes, ema9, ema21, rsi14, index);
    return this.genomeFeatures.map(name => {
      const value = features[name];
      if (!Number.isFinite(value)) throw new Error("Feature extraction produced a non-finite value: " + name);
      return value;
    });
  }

  private evaluateGenomeExpression(node: StrategyExpressionNode, features: GeneFeatureVector): number {
    if (node.kind === 'feature') return this.clamp(features[node.feature]);
    if (node.kind === 'constant') return this.clamp(node.value);
    if (node.kind === 'unary') {
      const value = this.evaluateGenomeExpression(node.input, features);
      switch (node.operator) {
        case 'tanh': return Math.tanh(value);
        case 'abs': return Math.abs(value);
        case 'signed_power': return Math.sign(value) * Math.pow(Math.abs(value), Math.max(0.5, Math.min(2.5, node.exponent || 1)));
        case 'log_abs': return Math.sign(value) * Math.log1p(Math.abs(value));
        case 'sin': return Math.sin(value * Math.PI);
        case 'cos': return Math.cos(value * Math.PI);
        case 'sqrt_abs': return Math.sign(value) * Math.sqrt(Math.abs(value));
        case 'negate': return -value;
      }
      return this.clamp(value);
    }
    const left = this.evaluateGenomeExpression(node.left, features);
    const right = this.evaluateGenomeExpression(node.right, features);
    let result = 0;
    switch (node.operator) {
      case 'add': result = left + right; break;
      case 'subtract': result = left - right; break;
      case 'multiply': result = left * right; break;
      case 'protected_divide': result = left / (Math.abs(right) < 0.08 ? (right < 0 ? -0.08 : 0.08) : right); break;
      case 'max': result = Math.max(left, right); break;
      case 'min': result = Math.min(left, right); break;
      case 'hypot': result = Math.hypot(left, right) / Math.SQRT2; break;
      case 'atan2': result = Math.atan2(left, right) / Math.PI; break;
    }
    return this.clamp(result);
  }

  private expressionToFormula(node: StrategyExpressionNode): string {
    if (node.kind === 'feature') return node.feature;
    if (node.kind === 'constant') return node.value.toFixed(2);
    if (node.kind === 'unary') return `${node.operator}(${this.expressionToFormula(node.input)}${node.operator === 'signed_power' ? `, ${node.exponent.toFixed(2)}` : ''})`;
    const operators: Record<string, string> = {
      add: '+', subtract: '−', multiply: '×', protected_divide: '÷',
      max: 'max', min: 'min', hypot: 'hypot', atan2: 'atan2',
    };
    return `${operators[node.operator]}(${this.expressionToFormula(node.left)}, ${this.expressionToFormula(node.right)})`;
  }

  private countExpressionNodes(node: StrategyExpressionNode): number {
    if (node.kind === 'feature' || node.kind === 'constant') return 1;
    if (node.kind === 'unary') return 1 + this.countExpressionNodes(node.input);
    return 1 + this.countExpressionNodes(node.left) + this.countExpressionNodes(node.right);
  }

  private randomGenomeExpression(
    depth: number,
    random: () => number = Math.random
  ): StrategyExpressionNode {
    const unary = ['tanh', 'abs', 'signed_power', 'log_abs', 'sin', 'cos', 'sqrt_abs', 'negate'] as const;
    const binary = ['add', 'subtract', 'multiply', 'protected_divide', 'max', 'min', 'hypot', 'atan2'] as const;
    if (depth <= 0 || random() < 0.28) {
      if (random() < 0.08) return { kind: 'constant', value: Number((random() * 1.2 - 0.6).toFixed(3)) };
      return { kind: 'feature', feature: this.genomeFeatures[Math.floor(random() * this.genomeFeatures.length)] };
    }
    if (random() < 0.34) {
      return {
        kind: 'unary',
        operator: unary[Math.floor(random() * unary.length)],
        exponent: Number((0.7 + random() * 1.3).toFixed(2)),
        input: this.randomGenomeExpression(depth - 1, random),
      };
    }
    return {
      kind: 'binary',
      operator: binary[Math.floor(random() * binary.length)],
      left: this.randomGenomeExpression(depth - 1, random),
      right: this.randomGenomeExpression(depth - 1, random),
    };
  }

  private mutateGenomeExpression(
    node: StrategyExpressionNode,
    depth = 2,
    requestedMutationRate = 0.20,
    random: () => number = Math.random
  ): StrategyExpressionNode {
    const mutationRate = Math.max(0.05, Math.min(0.45, requestedMutationRate));
    const replaceSubtreeRate = mutationRate * 0.30;
    if (depth <= 0) {
      return random() < mutationRate
        ? this.randomGenomeExpression(2, random)
        : node;
    }
    if (random() < replaceSubtreeRate) {
      return this.randomGenomeExpression(2, random);
    }
    if (node.kind === 'feature') {
      if (random() < mutationRate) {
        const alternatives = this.genomeFeatures.filter(feature => feature !== node.feature);
        return {
          kind: 'feature',
          feature: alternatives[Math.floor(random() * alternatives.length)] || node.feature,
        };
      }
      if (random() < mutationRate * 0.35) {
        return {
          kind: 'unary',
          operator: 'signed_power',
          exponent: Number((0.7 + random() * 1.4).toFixed(2)),
          input: node,
        };
      }
      return node;
    }
    if (node.kind === 'constant') {
      if (random() >= mutationRate) return node;
      return {
        kind: 'constant',
        value: Number(Math.max(-2, Math.min(2, node.value + (random() - 0.5) * 0.8)).toFixed(3)),
      };
    }
    if (node.kind === 'unary') {
      const operators = ['tanh', 'abs', 'signed_power', 'log_abs', 'sin', 'cos', 'sqrt_abs', 'negate'] as const;
      const operator = random() < mutationRate
        ? (operators.filter(item => item !== node.operator)[Math.floor(random() * (operators.length - 1))] || node.operator)
        : node.operator;
      const exponent = random() < mutationRate
        ? Number((0.7 + random() * 1.4).toFixed(2))
        : node.exponent;
      return {
        ...node,
        operator,
        exponent,
        input: this.mutateGenomeExpression(node.input, depth - 1, mutationRate, random),
      };
    }

    const operators = ['add', 'subtract', 'multiply', 'protected_divide', 'max', 'min', 'hypot', 'atan2'] as const;
    const operator = random() < mutationRate
      ? (operators.filter(item => item !== node.operator)[Math.floor(random() * (operators.length - 1))] || node.operator)
      : node.operator;
    const mutateBoth = random() < mutationRate * 0.25;
    const mutateLeft = mutateBoth || random() < 0.5;
    const mutateRight = mutateBoth || !mutateLeft;
    return {
      ...node,
      operator,
      left: mutateLeft
        ? this.mutateGenomeExpression(node.left, depth - 1, mutationRate, random)
        : node.left,
      right: mutateRight
        ? this.mutateGenomeExpression(node.right, depth - 1, mutationRate, random)
        : node.right,
    };
  }

  private geneSession(candle: Candle): MarketSessionId {
    // The signal is decided when this M1 candle closes, not when it opens.
    const hour = new Date(candle.timestampMs + M1_CANDLE_MS).getUTCHours();
    if (hour >= 12 && hour < 16) return 'OVERLAP';
    if (hour >= 7 && hour < 12) return 'LONDON';
    if (hour >= 16 && hour < 21) return 'NEW_YORK';
    return 'ASIA';
  }

  private prepareGeneResearchData(candles: Candle[], previousHoldoutEndMs: number | null = null): PreparedGeneResearchData {
    // 60k M1 bars provide enough chronological test opportunities even for a 30m horizon.
    const MIN_HISTORY = 60_000;
    if (candles.length < MIN_HISTORY) {
      throw new Error(`Need at least ${MIN_HISTORY.toLocaleString()} real one-minute candles to support the 300-trade test gate; received ${candles.length.toLocaleString()}.`);
    }
    if (candles.some(c => c.source === 'synthetic' || c.source === 'test_fixture')) {
      throw new Error('Synthetic and test-fixture candles are prohibited in candidate validation.');
    }
    if (!candles.every(c =>
      Number.isFinite(c.timestampMs) &&
      [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
      c.high >= Math.max(c.open, c.close, c.low) &&
      c.low <= Math.min(c.open, c.close, c.high)
    )) {
      throw new Error('Historical dataset contains invalid OHLC values.');
    }
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].timestampMs <= candles[i - 1].timestampMs) {
        throw new Error('Historical candles must be strictly chronological with no duplicate timestamps.');
      }
    }

    const isClosedMarketFiller = (c: Candle) =>
      c.volume === 0 && c.open === c.high && c.high === c.low && c.low === c.close;
    const excludedZeroVolumeFlatCandles = candles.filter(isClosedMarketFiller).length;
    const ordered = candles.filter(c => !isClosedMarketFiller(c));
    if (ordered.length < MIN_HISTORY) {
      throw new Error(`Only ${ordered.length.toLocaleString()} usable candles remain after excluding ${excludedZeroVolumeFlatCandles.toLocaleString()} zero-volume flat market-closure rows; require ${MIN_HISTORY.toLocaleString()}.`);
    }

    const minuteSteps = ordered.slice(1).filter((c, i) =>
      Math.abs((c.timestampMs - ordered[i].timestampMs) - M1_CANDLE_MS) <= 5_000
    ).length;
    if (minuteSteps / Math.max(1, ordered.length - 1) < 0.75) {
      throw new Error('Imported dataset does not contain sufficiently continuous one-minute candles.');
    }

    const closes = ordered.map(c => c.close);
    const ema9 = this.calculateEMA(closes, 9);
    const ema21 = this.calculateEMA(closes, 21);
    const rsi14 = this.calculateRSI(closes, 14);
    const timestampIndex = new Map<number, number>();
    ordered.forEach((candle, index) => timestampIndex.set(candle.timestampMs, index));

    const rows: GeneResearchRow[] = [];
    const horizons: StrategyHorizon[] = [...EXPIRY_HORIZONS_MINUTES];

    // Every expiry candidate shares the same M5 entry opportunity. Each genome
    // selects a separate 5–30m expiry, settled on the exact M1 candle at entry+N.
    for (const horizon of horizons) {
      for (let i = 60; i < ordered.length - horizon - 5; i++) {
        const candle = ordered[i];
        const decisionTime = candle.timestampMs + M1_CANDLE_MS;
        const entryTime = getNextCandleOpenMs(
          decisionTime,
          ENTRY_CANDLE_TIMEFRAME_MINUTES
        );
        if (entryTime - decisionTime !== ADVANCE_NOTICE_MS) continue;

        const entryIndex = timestampIndex.get(entryTime);
        const expiryTime = entryTime + horizon * M1_CANDLE_MS;
        const expiryCandleTime = expiryTime - M1_CANDLE_MS;
        const exitIndex = timestampIndex.get(expiryCandleTime);
        if (entryIndex === undefined || exitIndex === undefined || exitIndex <= entryIndex) continue;

        rows.push({
          decisionIndex: i,
          expiryMinutes: horizon,
          candle,
          previousCandle: ordered[i - 1],
          entryIndex,
          entryTimeMs: entryTime,
          exitIndices: { [horizon]: exitIndex },
          features: this.buildGeneFeatureVector(candle, ordered[i - 1], closes, ema9, ema21, rsi14, i),
          session: this.geneSession(candle),
        });
      }
    }
    rows.sort((a, b) =>
      a.entryTimeMs - b.entryTimeMs ||
      a.expiryMinutes - b.expiryMinutes
    );

    let trainEndMs: number;
    let validationStartMs: number;
    let validationEndMs: number;
    let testStartMs: number;

    if (previousHoldoutEndMs !== null) {
      // Historical data at or before a previously inspected holdout may now
      // be treated as known past. The next test must be wholly beyond it.
      const newSegmentStart = ordered.findIndex(c => c.timestampMs >= previousHoldoutEndMs - 5_000);
      if (newSegmentStart < 0) {
        throw new Error('No candles exist after the last consumed holdout window. Import at least 60,000 new M1 candles before another evolutionary batch.');
      }
      const newSegmentLength = ordered.length - newSegmentStart;
      if (newSegmentLength < MIN_HISTORY) {
        throw new Error(`Only ${newSegmentLength.toLocaleString()} new M1 candles exist after the last consumed holdout. Another independent search requires at least ${MIN_HISTORY.toLocaleString()} new candles; old test data will not be reused.`);
      }
      const trainEndIndex = newSegmentStart + Math.floor(newSegmentLength * 0.45);
      const validationEndIndex = newSegmentStart + Math.floor(newSegmentLength * 0.65);
      trainEndMs = ordered[Math.min(ordered.length - 1, trainEndIndex)]?.timestampMs ?? ordered[ordered.length - 1].timestampMs;
      validationStartMs = trainEndMs + 35 * M1_CANDLE_MS;
      validationEndMs = ordered[Math.min(ordered.length - 1, validationEndIndex)]?.timestampMs ?? ordered[ordered.length - 1].timestampMs;
      testStartMs = validationEndMs + 35 * M1_CANDLE_MS;
    } else {
      trainEndMs = ordered[Math.floor(ordered.length * 0.45)]?.timestampMs ?? ordered[0].timestampMs;
      validationStartMs = trainEndMs + 35 * M1_CANDLE_MS;
      validationEndMs = ordered[Math.floor(ordered.length * 0.65)]?.timestampMs ?? ordered[ordered.length - 1].timestampMs;
      testStartMs = validationEndMs + 35 * M1_CANDLE_MS;
    }
    return {
      candles: ordered, closes, ema9, ema21, rsi14, rows,
      trainEndMs, validationStartMs, validationEndMs, testStartMs,
      payoutPct: DEFAULT_BINARY_PAYOUT_PERCENT,
      excludedZeroVolumeFlatCandles,
    };
  }

  private simulateGeneRows(
    gene: SynthesizedStrategyGene,
    rows: GeneResearchRow[],
    data: PreparedGeneResearchData
  ) {
    let trades = 0, wins = 0, losses = 0, scratches = 0;
    let netReturnUnits = 0, positiveReturnUnits = 0, negativeReturnUnits = 0;
    let busyUntil = -Infinity;
    const scoredOutcomes: Array<'WIN' | 'LOSS'> = [];
    const horizon = gene.optimalHorizonMinutes;
    const triggerThreshold = Math.max(0.50, Math.min(0.95, gene.genome?.activationThreshold ?? gene.operatorParameters?.threshold ?? 0.682));
    for (const row of rows) {
      if (row.expiryMinutes !== horizon) continue;
      if (row.entryTimeMs < busyUntil) continue;
      if (gene.sessionAffinity !== 'ALL' && gene.sessionAffinity !== row.session) continue;
      const activation = gene.genome
        ? Math.tanh(this.evaluateGenomeExpression(gene.genome.expression, row.features) / 2)
        : (() => {
            const result = this.evaluateSynthesizedGeneSignal(
              gene, row.candle, row.previousCandle,
              data.closes, data.ema9, data.ema21, data.rsi14, row.decisionIndex
            );
            return result.shouldTrigger
              ? (result.direction === 'BUY' ? 1 : -1) * triggerThreshold
              : 0;
          })();
      if (Math.abs(activation) < triggerThreshold) continue;
      const exitIndex = row.exitIndices[horizon];
      if (exitIndex === undefined) continue;
      const entryPrice = data.candles[row.entryIndex].open;
      const exitPrice = data.candles[exitIndex].close;
      const settlement = calculateBinarySettlement(
        activation > 0 ? 'BUY' : 'SELL',
        entryPrice,
        exitPrice,
        data.payoutPct
      );
      trades++;
      netReturnUnits += settlement.netReturnUnits;
      if (settlement.outcome === 'WIN') {
        wins++;
        positiveReturnUnits += settlement.netReturnUnits;
        scoredOutcomes.push('WIN');
      } else if (settlement.outcome === 'LOSS') {
        losses++;
        negativeReturnUnits += Math.abs(settlement.netReturnUnits);
        scoredOutcomes.push('LOSS');
      } else {
        // Exact strike ties are returned stakes (pushes): a trade, but not a
        // directional WIN/LOSS observation and zero profit/loss.
        scratches++;
      }
      busyUntil = row.entryTimeMs + horizon * 60_000;
    }
    const scoredTrades = wins + losses;
    return {
      trades, wins, losses, scratches, scoredTrades,
      winRate: scoredTrades ? wins / scoredTrades : 0,
      netReturnUnits,
      expectedValueUnits: trades ? netReturnUnits / trades : 0,
      profitFactor: negativeReturnUnits > 0
        ? positiveReturnUnits / negativeReturnUnits
        : (positiveReturnUnits > 0 ? 99 : 0),
      scoredOutcomes,
      payoutPct: data.payoutPct,
    };
  }

  private wilsonInterval(wins: number, scoredTrades: number): [number, number] {
    const n = Math.max(1, scoredTrades);
    const p = wins / n;
    const z = 1.96;
    const denominator = 1 + (z * z) / n;
    const center = (p + (z * z) / (2 * n)) / denominator;
    const margin = z * Math.sqrt((p * (1 - p) / n) + (z * z / (4 * n * n))) / denominator;
    return [
      Math.max(0, Number((center - margin).toFixed(4))),
      Math.min(1, Number((center + margin).toFixed(4))),
    ];
  }

  private getThreeBlockWinRates(outcomes: Array<'WIN' | 'LOSS'>): number[] {
    if (outcomes.length < 300) return [];
    const recent = outcomes.slice(-300);
    return [0, 1, 2].map(block => {
      const start = block * 100;
      const wins = recent.slice(start, start + 100).filter(value => value === 'WIN').length;
      return Number((wins / 100).toFixed(4));
    });
  }

  private validateGeneAgainstPreparedData(
    gene: SynthesizedStrategyGene,
    data: PreparedGeneResearchData
  ): SynthesizedStrategyGene {
    if (!gene.genome && !gene.operatorParameters) {
      throw new Error('This legacy candidate has no stored executable genome or coefficients. Generate a new symbolic candidate.');
    }
    // Assign an outcome only when its complete entry-to-expiry interval is inside
    // the partition. A decision bar before a boundary is not enough: its future
    // settlement must never borrow prices from the next partition.
    const trainRows = data.rows.filter(row =>
      outcomeFitsResearchWindow(
        row.entryTimeMs, row.expiryMinutes,
        data.candles[60]?.timestampMs ?? -Infinity, data.trainEndMs
      )
    );
    const validationRows = data.rows.filter(row =>
      outcomeFitsResearchWindow(
        row.entryTimeMs, row.expiryMinutes,
        data.validationStartMs, data.validationEndMs
      )
    );
    const testEndMs = data.candles[data.candles.length - 1].timestampMs + M1_CANDLE_MS;
    const testRows = data.rows.filter(row =>
      outcomeFitsResearchWindow(
        row.entryTimeMs, row.expiryMinutes, data.testStartMs, testEndMs
      )
    );
    const train = this.simulateGeneRows(gene, trainRows, data);
    const validation = this.simulateGeneRows(gene, validationRows, data);
    const test = this.simulateGeneRows(gene, testRows, data);
    const interval = this.wilsonInterval(test.wins, test.scoredTrades);
    const blockRates = this.getThreeBlockWinRates(test.scoredOutcomes);
    const breakEvenRate = binaryBreakEvenWinRate(test.payoutPct);
    const validationLowerBound = wilsonLowerBound(validation.wins, validation.scoredTrades);
    // Ten finalists see the one-time holdout. One-sided Bonferroni alpha=.05/10
    // controls family-wise false positives across those pre-registered candidates.
    const multipleTestingLowerBound = wilsonLowerBound(test.wins, test.scoredTrades, 2.576);
    const enoughTrades = test.scoredTrades >= 300 && validation.scoredTrades >= 150 && train.scoredTrades >= 150;
    const passed =
      enoughTrades &&
      validationLowerBound > breakEvenRate &&
      multipleTestingLowerBound > breakEvenRate &&
      blockRates.length === 3 &&
      blockRates.every(rate => rate > breakEvenRate) &&
      test.netReturnUnits > 0 &&
      test.profitFactor >= 1.15;

    let failureReason = '';
    if (test.scoredTrades < 300) failureReason = `Insufficient independent test outcomes: ${test.scoredTrades}/300.`;
    else if (validation.scoredTrades < 150 || train.scoredTrades < 150) failureReason = `Insufficient train/validation outcomes (train ${train.scoredTrades}, validation ${validation.scoredTrades}; require 150 each).`;
    else if (validationLowerBound <= breakEvenRate) failureReason = `Validation 95% Wilson lower bound ${(validationLowerBound * 100).toFixed(1)}% does not clear payout break-even ${(breakEvenRate * 100).toFixed(1)}%.`;
    else if (multipleTestingLowerBound <= breakEvenRate) failureReason = `Untouched-test lower bound after the ten-finalist correction (${(multipleTestingLowerBound * 100).toFixed(1)}%) does not clear payout break-even ${(breakEvenRate * 100).toFixed(1)}%.`;
    else if (blockRates.length !== 3 || blockRates.some(rate => rate <= breakEvenRate)) failureReason = 'One or more consecutive 100-trade test blocks did not beat payout break-even.';
    else if (test.netReturnUnits <= 0 || test.profitFactor < 1.15) failureReason = 'Payout-adjusted net expectancy or profit factor failed.';

    const backtestMetrics: StrategyBacktestMetrics = {
      trainSampleSize: train.trades,
      trainScoredSampleSize: train.scoredTrades,
      validationSampleSize: validation.trades,
      validationScoredSampleSize: validation.scoredTrades,
      trainWinRate: Number(train.winRate.toFixed(4)),
      validationWinRate: Number(validation.winRate.toFixed(4)),
      testWinRate: Number(test.winRate.toFixed(4)),
      testAccuracy: Number(test.winRate.toFixed(4)),
      testSampleSize: test.trades,
      testScoredSampleSize: test.scoredTrades,
      testWins: test.wins,
      testLosses: test.losses,
      binaryPayoutPct: test.payoutPct,
      excludedZeroVolumeFlatCandles: data.excludedZeroVolumeFlatCandles,
      expectedValueUnits: Number(test.expectedValueUnits.toFixed(4)),
      profitFactor: Number(test.profitFactor.toFixed(2)),
      confidenceInterval95: interval,
      multipleTestingLowerBound,
      testBlockWinRates: blockRates,
      trainPeriod: { start: data.candles[60].timestamp, end: new Date(data.trainEndMs).toISOString() },
      validationPeriod: { start: new Date(data.validationStartMs).toISOString(), end: new Date(data.validationEndMs).toISOString() },
      testPeriod: { start: new Date(data.testStartMs).toISOString(), end: data.candles[data.candles.length - 1].timestamp },
    };
    const accuracyStatus = test.scoredTrades >= 300 ? 'BACKTESTED' : 'INSUFFICIENT_SAMPLE';
    const updated: SynthesizedStrategyGene = {
      ...gene,
      verifiedAccuracy: Number((test.winRate * 100).toFixed(1)),
      sampleCount: test.scoredTrades,
      accuracyStatus,
      backtestMetrics,
      validationFailureReason: passed ? undefined : failureReason || 'Historical evidence did not satisfy every approval gate.',
      status: passed ? 'PAPER_TRADING' : (test.scoredTrades >= 300 ? 'REJECTED' : 'EXPERIMENTING'),
    };
    db.updateSynthesizedStrategy(updated);
    return updated;
  }

  /**
   * Individual candidate testing is intentionally disabled. A strategy must
   * enter the registered 300-candidate batch so a test window is reserved
   * exactly once and only preselected finalists see it.
   */
  public validateSynthesizedStrategy(
    _gene: SynthesizedStrategyGene,
    _candles: Candle[]
  ): never {
    throw new Error('Individual candidate holdout testing is disabled. Use runNovelStrategySearchBatch so the pair holdout is reserved and exposed only to preselected finalists.');
  }

  private async runNovelStrategySearchBatchInternal(
    symbol: ForexSymbol,
    candles: Candle[],
    searchBatchId: string,
    baseGeneration: number,
    onProgress: (progress: {
      completed: number;
      passedHistorical: number;
      insufficientSample: number;
      rejected: number;
      replicationFinalists: number;
    }) => void
  ): Promise<SynthesizedStrategyGene[]> {
    const previousHoldoutEndMs = db.getLatestResearchHoldoutEndMs(symbol);
    const data = this.prepareGeneResearchData(candles, previousHoldoutEndMs);
    const datasetFingerprint = fingerprintCandles(data.candles);
    const researchSeed = deriveResearchSeed(searchBatchId, symbol, datasetFingerprint);
    const random = createSeededRandom(researchSeed);
    const holdoutEndMs = data.candles[data.candles.length - 1].timestampMs + M1_CANDLE_MS;
    const breakEvenRate = binaryBreakEvenWinRate(data.payoutPct);
    if (!db.claimResearchHoldoutWindow(symbol, searchBatchId, data.testStartMs, holdoutEndMs)) {
      throw new Error('This chronological test period overlaps a holdout window already inspected for this pair. Import at least 30,000 newer M1 candles to create a genuinely new test period.');
    }
    // A setup is assigned to a partition only when its entire entry-to-expiry
    // interval is contained there. No outcome may read a candle from the next split.
    const trainRows = data.rows.filter(row =>
      outcomeFitsResearchWindow(
        row.entryTimeMs, row.expiryMinutes,
        data.candles[60]?.timestampMs ?? -Infinity, data.trainEndMs
      )
    );
    const validationRows = data.rows.filter(row =>
      outcomeFitsResearchWindow(
        row.entryTimeMs, row.expiryMinutes,
        data.validationStartMs, data.validationEndMs
      )
    );

    // Initial parents come only from discovery train/validation records and
    // sufficiently mature forward-paper evidence. The holdout is never read.
    const initialParentPool = selectEvolutionParents(db.getSynthesizedStrategies(), 30);
    let currentParentPool = initialParentPool;

    const candidates: Array<{
      gene: SynthesizedStrategyGene;
      trainScoredTrades: number;
      validationScoredTrades: number;
      validationWins: number;
      trainWinRate: number;
      validationWinRate: number;
      validationExpectedValueUnits: number;
      validationProfitFactor: number;
    }> = [];
    const signatures = new Set<string>(
      db.getSynthesizedStrategies()
        .map(gene => gene.genome?.signature)
        .filter((signature): signature is string => !!signature)
    );
    let insufficientSample = 0;
    let rejected = 0;

    // Stage 1: run ten actual genetic generations of 30 individuals each.
    // Each generation is evaluated only on train/validation. Qualified survivors
    // from that generation become the next generation's parents. The final test
    // remains sealed until all 300 candidates and their finalists are frozen.
    const POPULATION_SIZE = 30;
    const GENERATION_COUNT = 10;
    for (let i = 0; i < POPULATION_SIZE * GENERATION_COUNT; i++) {
      if (i > 0 && i % POPULATION_SIZE === 0) {
        const priorGeneration = candidates.slice(i - POPULATION_SIZE, i).map(item => item.gene);
        const evolvedParents = selectEvolutionParents(
          [...initialParentPool, ...priorGeneration],
          30
        );
        // If the immediately prior generation has not yet discovered at least
        // two robust parents, preserve the previous validated population.
        if (evolvedParents.length >= 2) currentParentPool = evolvedParents;
      }

      const generation = baseGeneration + Math.floor(i / POPULATION_SIZE);
      let gene = this.synthesizeInfiniteNovelStrategy(
        candles, symbol, generation, currentParentPool, searchBatchId, false,
          random,
          { researchSeed, datasetFingerprint }
      );
      let attempts = 0;
      while (signatures.has(gene.genome?.signature || '') && attempts < 20) {
        gene = this.synthesizeInfiniteNovelStrategy(
          candles, symbol, generation, currentParentPool, searchBatchId, false,
          random,
          { researchSeed, datasetFingerprint }
        );
        attempts++;
      }
      if (gene.genome) signatures.add(gene.genome.signature);

      const train = this.simulateGeneRows(gene, trainRows, data);
      const validation = this.simulateGeneRows(gene, validationRows, data);
      gene.discoveryMetrics = {
        trainScoredTrades: train.scoredTrades,
        validationScoredTrades: validation.scoredTrades,
        trainWinRate: Number(train.winRate.toFixed(4)),
        validationWinRate: Number(validation.winRate.toFixed(4)),
        validationExpectedValueUnits: Number(validation.expectedValueUnits.toFixed(4)),
        validationProfitFactor: Number(validation.profitFactor.toFixed(2)),
        minimumPayoutPct: data.payoutPct,
      };
      gene.accuracyStatus = 'UNVALIDATED';
      gene.verifiedAccuracy = 0;
      gene.sampleCount = 0;
      gene.status = 'EXPERIMENTING';
      gene.validationFailureReason = undefined;

      if (train.scoredTrades < 150 || validation.scoredTrades < 150) {
        insufficientSample++;
      } else {
        const validationLowerBound = wilsonLowerBound(validation.wins, validation.scoredTrades);
        if (train.winRate <= breakEvenRate ||
            validation.winRate <= breakEvenRate ||
            validationLowerBound <= breakEvenRate ||
            validation.expectedValueUnits <= 0 ||
            validation.profitFactor < 1.05) rejected++;
      }

      db.addSynthesizedStrategy(gene);
      candidates.push({
        gene,
        trainScoredTrades: train.scoredTrades,
        validationScoredTrades: validation.scoredTrades,
        validationWins: validation.wins,
        trainWinRate: train.winRate,
        validationWinRate: validation.winRate,
        validationExpectedValueUnits: validation.expectedValueUnits,
        validationProfitFactor: validation.profitFactor,
      });
      onProgress({
        completed: i + 1,
        passedHistorical: 0,
        insufficientSample,
        rejected,
        replicationFinalists: 0,
      });
      // Yield to the API polling loop without opening the holdout test.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }

    // Pre-register a small finalist set by validation expectancy. The untouched
    // test period is exposed only to these finalists, never used to rank all 300.
    const finalists = candidates
      .filter(candidate =>
        candidate.trainScoredTrades >= 150 &&
        candidate.validationScoredTrades >= 150 &&
        wilsonLowerBound(candidate.validationWins, candidate.validationScoredTrades) > breakEvenRate &&
        candidate.validationExpectedValueUnits > 0 &&
        candidate.trainWinRate > breakEvenRate &&
        candidate.validationWinRate > breakEvenRate &&
        candidate.validationProfitFactor >= 1.05
      )
      .sort((a, b) =>
        b.validationExpectedValueUnits - a.validationExpectedValueUnits ||
        b.validationWinRate - a.validationWinRate
      )
      .slice(0, 10);
    const finalistIds = new Set(finalists.map(candidate => candidate.gene.id));

    for (const candidate of candidates) {
      if (!finalistIds.has(candidate.gene.id)) {
        const m = candidate.gene.discoveryMetrics!;
        candidate.gene.validationFailureReason =
          candidate.trainScoredTrades < 150 || candidate.validationScoredTrades < 150
            ? `Discovery sample too small (train ${candidate.trainScoredTrades}, validation ${candidate.validationScoredTrades}; require 150 each).`
            : `Validation gate failed or candidate was not selected for holdout: WR ${(m.validationWinRate * 100).toFixed(1)}%, EV ${m.validationExpectedValueUnits.toFixed(4)} stake units/trade, PF ${m.validationProfitFactor.toFixed(2)}.`;
        db.updateSynthesizedStrategy(candidate.gene);
      }
    }

    // Stage 2: open the sealed test only for the preselected validation finalists.
    let passedHistorical = 0, holdoutInsufficient = 0, holdoutRejected = 0;
    const resultById = new Map<string, SynthesizedStrategyGene>();
    for (const finalist of finalists) {
      const replicated = this.validateGeneAgainstPreparedData(finalist.gene, data);
      resultById.set(replicated.id, replicated);
      if (replicated.status === 'PAPER_TRADING') passedHistorical++;
      else if (replicated.accuracyStatus === 'INSUFFICIENT_SAMPLE') holdoutInsufficient++;
      else holdoutRejected++;
      onProgress({
        completed: 300,
        passedHistorical,
        insufficientSample: insufficientSample + holdoutInsufficient,
        rejected: rejected + holdoutRejected,
        replicationFinalists: finalists.length,
      });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }

    return candidates.map(candidate =>
      resultById.get(candidate.gene.id) || candidate.gene
    );
  }

  /**
   * Generates a machine-searchable symbolic candidate. The grammar evolves
   * executable expressions over causal price/volatility features; no accuracy
   * is assigned until the untouched historical test is run.
   */
  public synthesizeInfiniteNovelStrategy(
    _candles: Candle[],
    symbol: ForexSymbol,
    generation: number,
    parentPool?: SynthesizedStrategyGene[],
    searchBatchId?: string,
    persistImmediately = true,
    random: () => number = Math.random,
    reproducibility?: { researchSeed: string; datasetFingerprint: string }
  ): SynthesizedStrategyGene {
    const eligibleParents = selectEvolutionParents(
      parentPool || db.getSynthesizedStrategies(),
      30
    );
    const mutationRate = calculateAdaptiveMutationRate(eligibleParents);
    const parentA = eligibleParents.length
      ? eligibleParents[Math.floor(random() * eligibleParents.length)]
      : undefined;
    const remainingParents = eligibleParents.filter(gene => gene.id !== parentA?.id);
    const parentB = remainingParents.length
      ? remainingParents[Math.floor(random() * remainingParents.length)]
      : undefined;

    let expression: StrategyExpressionNode;
    if (parentA?.genome && parentB?.genome && random() < 0.58) {
      const binary = ['add', 'subtract', 'multiply', 'protected_divide', 'max', 'min', 'hypot', 'atan2'] as const;
      expression = {
        kind: 'binary',
        operator: binary[Math.floor(random() * binary.length)],
        left: JSON.parse(JSON.stringify(parentA.genome.expression)) as StrategyExpressionNode,
        right: JSON.parse(JSON.stringify(parentB.genome.expression)) as StrategyExpressionNode,
      };
      expression = this.mutateGenomeExpression(expression, 2, mutationRate, random);
    } else if (parentA?.genome) {
      expression = this.mutateGenomeExpression(
        JSON.parse(JSON.stringify(parentA.genome.expression)) as StrategyExpressionNode,
        3,
        mutationRate,
        random
      );
    } else {
      expression = this.randomGenomeExpression(3, random);
    }

    let complexity = this.countExpressionNodes(expression);
    while (complexity > 24) {
      expression = this.randomGenomeExpression(2, random);
      complexity = this.countExpressionNodes(expression);
    }
    // Strategy traits inherit from a randomly selected parent. Mutation pressure
    // can alter them, so the population evolves horizon/session selection as well
    // as the symbolic expression tree.
    const traitParent = parentA && parentB
      ? (random() < 0.5 ? parentA : parentB)
      : (parentA || parentB);
    const inheritedThreshold = traitParent?.genome?.activationThreshold ?? (0.64 + random() * 0.20);
    const activationThreshold = Number(Math.max(
      0.64,
      Math.min(0.84, inheritedThreshold + (random() - 0.5) * mutationRate * 0.30)
    ).toFixed(3));
    const signature = JSON.stringify({ expression, activationThreshold });
    const genome: StrategyGenome = {
      version: 1,
      expression,
      activationThreshold,
      signature,
      complexity,
    };
    const formula = `tanh((${this.expressionToFormula(expression)}) / 2); |score| ≥ ${activationThreshold.toFixed(3)}`;
    const featuresUsed = [...new Set(
      this.genomeFeatures.filter(feature => JSON.stringify(expression).includes(feature))
    )];
    const selectedHorizon: StrategyHorizon[] = [5, 10, 15, 20, 25, 30];
    const sessions: Array<MarketSessionId | 'ALL'> = ['ASIA', 'LONDON', 'OVERLAP', 'NEW_YORK', 'ALL'];
    const horizon = traitParent?.optimalHorizonMinutes &&
      random() >= mutationRate
      ? traitParent.optimalHorizonMinutes
      : selectedHorizon[Math.floor(random() * selectedHorizon.length)];
    const sessionAffinity = traitParent?.sessionAffinity &&
      random() >= mutationRate
      ? traitParent.sessionAffinity
      : sessions[Math.floor(random() * sessions.length)];
    const parents = [parentA, parentB]
      .filter((gene): gene is SynthesizedStrategyGene => !!gene)
      .map(gene => gene.id);
    const identityHash = searchBatchId
      ? stableHash(`${searchBatchId}|${symbol}|${genome.signature}|${horizon}|${sessionAffinity}`).slice(0, 10).toUpperCase()
      : `${Date.now().toString(36)}${random().toString(36).slice(2, 8)}`.toUpperCase();
    const code = `SYM_${generation}_${identityHash.slice(0, 6)}`;
    const gene: SynthesizedStrategyGene = {
      id: `synth_${symbol.replace('/', '')}_${identityHash.toLowerCase()}`,
      name: `Symbolic Gen ${generation} · ${featuresUsed.slice(0, 3).join(' / ') || 'Nonlinear Feature Mix'}`,
      code,
      generation,
      mathematicalFormula: formula,
      parents,
      mutationRate,
      genome,
      searchBatchId,
      researchSeed: reproducibility?.researchSeed,
      datasetFingerprint: reproducibility?.datasetFingerprint,
      featureSchemaVersion: reproducibility ? FEATURE_SCHEMA_VERSION : undefined,
      researchEngineVersion: reproducibility ? RESEARCH_ENGINE_VERSION : undefined,
      symbol,
      optimalHorizonMinutes: horizon,
      sessionAffinity,
      verifiedAccuracy: 0,
      sampleCount: 0,
      accuracyStatus: 'UNVALIDATED',
      status: 'EXPERIMENTING',
      scientificHypothesis: `Machine-generated symbolic hypothesis combining ${featuresUsed.join(', ') || 'causal market features'} through nonlinear expression search. No predictive edge is assumed before testing.`,
      whyHumansMissThis: 'Generated by symbolic expression search and genetic mutation/crossover. Novelty describes this generated expression, not proof that no human has used a similar idea.',
      createdAt: new Date().toISOString(),
    };
    if (persistImmediately) db.addSynthesizedStrategy(gene);
    return gene;
  }

  /**
   * Evaluates current market candles against a stored strategy candidate.
   * Computes the mathematical formula activation f(x) and yields high-conviction setup.
   */
  public evaluateSynthesizedGeneSignal(
    gene: SynthesizedStrategyGene,
    candle: Candle,
    prevCandle: Candle,
    closes: number[],
    ema9: number[],
    ema21: number[],
    rsi14: number[],
    index: number = closes.length - 1
  ): { shouldTrigger: boolean; direction: 'BUY' | 'SELL'; conviction: number; rationale: string } {
    if (gene.genome) {
      const features = this.buildGeneFeatureVector(candle, prevCandle, closes, ema9, ema21, rsi14, index);
      const rawScore = this.evaluateGenomeExpression(gene.genome.expression, features);
      const activationScore = Math.tanh(rawScore / 2);
      const threshold = Math.max(0.50, Math.min(0.95, gene.genome.activationThreshold));
      const shouldTrigger = Math.abs(activationScore) >= threshold;
      const direction: 'BUY' | 'SELL' = activationScore >= 0 ? 'BUY' : 'SELL';
      const conviction = Number(Math.min(0.94, 0.50 + Math.abs(activationScore) * 0.44).toFixed(2));
      return {
        shouldTrigger,
        direction,
        conviction,
        rationale: `Symbolic genome score ${activationScore.toFixed(3)}; activation threshold ${threshold.toFixed(3)}. Score is a rule activation, not a win probability.`,
      };
    }

    const isJpy = candle.symbol.includes('JPY');
    const pipFactor = isJpy ? 100 : 10000;
    const range = Math.max(0.00005, candle.high - candle.low);
    const body = Math.abs(candle.close - candle.open);
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWickRatio = upperWick / range;
    const lowerWickRatio = lowerWick / range;
    const idx = index;
    const lastEma9 = ema9[idx] || candle.close;
    const lastEma21 = ema21[idx] || candle.close;
    const prevEma9 = ema9[Math.max(0, idx - 1)] || lastEma9;
    const prevEma21 = ema21[Math.max(0, idx - 1)] || lastEma21;
    const lastRsi = rsi14[idx] || 50;
    const prevRsi = rsi14[Math.max(0, idx - 1)] || 50;
    const start = Math.max(0, idx - 19);
    const recentCloses = closes.slice(start, idx + 1);
    const sma20 = recentCloses.reduce((a, b) => a + b, 0) / Math.max(1, recentCloses.length);
    const delta20Pips = (candle.close - sma20) * pipFactor;
    const emaCurvature = ((lastEma9 - lastEma21) - (prevEma9 - prevEma21)) * pipFactor;
    const rsiCurvature = (lastRsi - prevRsi) / 10;
    const params = gene.operatorParameters || { alpha: 1.45, beta: 0.68, gamma: 0.28, exponent: 1.8, threshold: 0.38 };
    const { alpha, beta, gamma, exponent } = params;
    let activationScore = 0;
    switch (gene.nonLinearOperator ?? 'tanh_polynomial') {
      case 'tanh_polynomial': {
        const zEntropy = ((candle.close - prevCandle.close) * pipFactor) / 2.0;
        const wickDelta = Math.pow(lowerWickRatio, exponent) - Math.pow(upperWickRatio, exponent);
        activationScore = Math.tanh(alpha * zEntropy) + beta * wickDelta - gamma * (delta20Pips / 10);
        break;
      }
      case 'fractal_power': {
        const microFlow = candle.close > candle.open ? 1 : -1;
        const powerDrift = microFlow * Math.pow(Math.min(5, Math.abs(delta20Pips) / 4), exponent);
        activationScore = powerDrift + alpha * rsiCurvature - beta * (upperWickRatio - lowerWickRatio) - gamma * (delta20Pips / 20);
        break;
      }
      case 'exponential_decay': {
        const volElasticity = Math.min(3, range / (range * 0.8 + 0.0001));
        const sigmoid = 1 / (1 + Math.exp(-Math.max(-5, Math.min(5, alpha * emaCurvature * volElasticity))));
        activationScore = (sigmoid - 0.5) * 2.5 - beta * Math.log1p(Math.abs(delta20Pips)) / 5 - gamma * (upperWickRatio - lowerWickRatio);
        break;
      }
      case 'harmonic_dispersion': {
        const wickRatio = (upperWick + lowerWick) / range;
        const wave = Math.cos(Math.PI * wickRatio);
        const bodyFlow = (candle.close - candle.open) * pipFactor / Math.max(0.1, range * pipFactor);
        const emaSpread = (lastEma9 - lastEma21) * pipFactor / 10;
        activationScore = beta * wave + alpha * bodyFlow - gamma * emaSpread;
        break;
      }
    }
    const threshold = params.threshold;
    const shouldTrigger = Math.abs(activationScore) > threshold;
    const direction: 'BUY' | 'SELL' = activationScore > 0 ? 'BUY' : 'SELL';
    const conviction = Number(Math.min(0.94, 0.50 + Math.min(0.44, Math.abs(activationScore) * 0.1)).toFixed(2));
    return {
      shouldTrigger,
      direction,
      conviction,
      rationale: `Signal score: ${activationScore.toFixed(3)} (Threshold: ±${threshold}). Legacy operator score is not a win probability.`,
    };
  }

  /**
   * Record a loss as an observation only. OHLC bars cannot prove the cause of a
   * loss, and a single loss is never converted into a fabricated strategy.
   * recordStrategyOutcome() has already updated posterior and episodic memory.
   */
  public recordLossObservation(
    signal: ResearchSignal,
    candle: Candle
  ): LossAutopsy {
    const entryPrice = signal.actualEntryPrice ?? signal.triggerPrice;
    const exitPrice = signal.actualExitPrice ?? candle.close;
    const strategyGeneId = signal.synthesizedGeneId;
    const outcome = signal.outcomeResult;
    const autopsy: LossAutopsy = {
      id: `autopsy_${signal.id}`,
      signalId: signal.id,
      symbol: signal.symbol,
      direction: signal.direction,
      strategyName: signal.strategyName || 'Unclassified strategy',
      mathematicalFormula: signal.mathematicalFormula,
      entryPrice,
      exitPrice,
      grossReturnPips: signal.grossReturnPips ?? undefined,
      netReturnPips: signal.netReturnPips ?? undefined,
      spreadPips: signal.estimatedSpreadPips ?? undefined,
      netReturnUnits: signal.netReturnUnits ?? undefined,
      marketSession: signal.marketSessionName || 'Unknown session',
      strategyGeneId,
      rootCause: 'OBSERVED_ADVERSE_SETTLEMENT',
      evidenceStatus: 'OBSERVATION_ONLY',
      rootCauseExplanation:
        `The paper contract settled ${outcome} for ${signal.direction} on ${signal.symbol}. The recorded entry/exit prices and market features describe what was observed; they do not establish why price moved or whether spread, liquidity, news or another mechanism caused the loss.`,
      lessonsLearned: [
        strategyGeneId
          ? `The loss was attached to evolved genome ${strategyGeneId} and its forward-paper outcome ledger.`
          : 'The loss has no evolved-genome identity and cannot update genetic parent fitness.',
        'This outcome is available to the Bayesian posterior and causal episodic-memory checks; one loss does not create or validate a new strategy.',
        'Only mature, payout-positive forward samples with the required confidence can alter future genetic parent selection.',
      ],
      timestamp: new Date().toISOString(),
    };
    return autopsy;
  }
}

export const researchEngine = new ResearchEngine();
