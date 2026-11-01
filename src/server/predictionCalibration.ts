/**
 * Out-of-sample score calibration for forward-paper strategy predictions.
 *
 * The genome activation/conviction score is not a probability. This module
 * estimates an empirical win probability from earlier settled observations only.
 * It never changes the raw score or the trading trigger. Diagnostic metrics use
 * a chronological tail that was not used to fit the diagnostic calibrator.
 */

export interface CalibrationObservation {
  rawScore: number;
  outcome: "WIN" | "LOSS";
}

export interface CalibratedScore {
  probability: number | null;
  /** One-sided 95% Wilson lower bound for the fitted isotonic block. */
  lowerConfidenceProbability: number | null;
  status: "CALIBRATED" | "UNCALIBRATED" | "OVERCONFIDENT";
  sampleSize: number;
  /** Forward-challenged Brier score; null until a chronological validation slice exists. */
  brierScore: number | null;
  /** Forward-challenged expected calibration error; null until a validation slice exists. */
  expectedCalibrationError: number | null;
}

interface CalibrationBlock {
  minScore: number;
  maxScore: number;
  scoreTotal: number;
  wins: number;
  count: number;
}

function blockProbability(block: CalibrationBlock): number {
  // Beta(2,2) shrinkage prevents small bins from reporting extreme probabilities.
  return (block.wins + 2) / (block.count + 4);
}

function wilsonLowerBound(wins: number, sampleSize: number, z = 1.96): number {
  if (sampleSize <= 0) return 0;
  const p = Math.max(0, Math.min(1, wins / sampleSize));
  const z2 = z * z;
  const denominator = 1 + z2 / sampleSize;
  const center = p + z2 / (2 * sampleSize);
  const margin = z * Math.sqrt(
    (p * (1 - p) / sampleSize) + (z2 / (4 * sampleSize * sampleSize))
  );
  return Math.max(0, Math.min(1, (center - margin) / denominator));
}

function mergeBlocks(left: CalibrationBlock, right: CalibrationBlock): CalibrationBlock {
  return {
    minScore: left.minScore,
    maxScore: right.maxScore,
    scoreTotal: left.scoreTotal + right.scoreTotal,
    wins: left.wins + right.wins,
    count: left.count + right.count,
  };
}

/** Group equal scores before binning so ties can never be split across calibration bins. */
function buildIsotonicBlocks(input: readonly CalibrationObservation[]): CalibrationBlock[] {
  const sorted = input.slice().sort((a, b) => a.rawScore - b.rawScore);
  const scoreGroups: CalibrationBlock[] = [];
  for (const observation of sorted) {
    const last = scoreGroups[scoreGroups.length - 1];
    if (last && last.maxScore === observation.rawScore) {
      last.scoreTotal += observation.rawScore;
      last.wins += observation.outcome === "WIN" ? 1 : 0;
      last.count += 1;
    } else {
      scoreGroups.push({
        minScore: observation.rawScore,
        maxScore: observation.rawScore,
        scoreTotal: observation.rawScore,
        wins: observation.outcome === "WIN" ? 1 : 0,
        count: 1,
      });
    }
  }

  // Build approximately equal-count bins without splitting identical raw scores.
  const targetBinSize = Math.max(20, Math.floor(sorted.length / 10));
  const blocks: CalibrationBlock[] = [];
  let current: CalibrationBlock | null = null;
  for (const group of scoreGroups) {
    current = current
      ? mergeBlocks(current, group)
      : { ...group };
    if (current.count >= targetBinSize && blocks.length < 9) {
      blocks.push(current);
      current = null;
    }
  }
  if (current) {
    if (blocks.length > 0 && current.count < targetBinSize) {
      blocks[blocks.length - 1] = mergeBlocks(blocks[blocks.length - 1], current);
    } else {
      blocks.push(current);
    }
  }

  // Pool Adjacent Violators: fitted win probability may not decrease as raw score rises.
  for (let index = 0; index < blocks.length - 1;) {
    if (blockProbability(blocks[index]) <= blockProbability(blocks[index + 1])) {
      index++;
      continue;
    }
    blocks.splice(index, 2, mergeBlocks(blocks[index], blocks[index + 1]));
    if (index > 0) index--;
  }
  return blocks;
}

function probabilityForScore(blocks: readonly CalibrationBlock[], score: number): number {
  const matched = blocks.find(block => score <= block.maxScore);
  return blockProbability(matched || blocks[blocks.length - 1]);
}

function forwardCalibrationDiagnostics(
  training: readonly CalibrationObservation[],
  validation: readonly CalibrationObservation[]
): { brierScore: number | null; expectedCalibrationError: number | null } {
  if (training.length < 100 || validation.length < 20) {
    return { brierScore: null, expectedCalibrationError: null };
  }
  const blocks = buildIsotonicBlocks(training);
  const predictions = validation.map(observation => ({
    probability: probabilityForScore(blocks, observation.rawScore),
    outcome: observation.outcome === "WIN" ? 1 : 0,
  }));

  const brier = predictions.reduce(
    (sum, item) => sum + Math.pow(item.probability - item.outcome, 2),
    0
  ) / predictions.length;

  const sortedPredictions = predictions.slice().sort((a, b) => a.probability - b.probability);
  const calibrationBinCount = Math.min(5, Math.max(1, Math.floor(sortedPredictions.length / 10)));
  let ece = 0;
  for (let bin = 0; bin < calibrationBinCount; bin++) {
    const start = Math.floor((bin * sortedPredictions.length) / calibrationBinCount);
    const end = Math.floor(((bin + 1) * sortedPredictions.length) / calibrationBinCount);
    const slice = sortedPredictions.slice(start, end);
    if (slice.length === 0) continue;
    const meanPrediction = slice.reduce((sum, item) => sum + item.probability, 0) / slice.length;
    const observedRate = slice.reduce((sum, item) => sum + item.outcome, 0) / slice.length;
    ece += (slice.length / sortedPredictions.length) * Math.abs(meanPrediction - observedRate);
  }

  return {
    brierScore: Number(brier.toFixed(4)),
    expectedCalibrationError: Number(ece.toFixed(4)),
  };
}

/** Fit monotonic calibration using earlier outcomes; validate diagnostics on a later time slice. */
export function calibratePredictionScore(
  rawScore: number,
  input: readonly CalibrationObservation[],
  minimumSampleSize = 100
): CalibratedScore {
  if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > 1) {
    throw new Error("Raw prediction score must be finite and within [0, 1].");
  }
  if (!Number.isInteger(minimumSampleSize) || minimumSampleSize < 20) {
    throw new Error("Calibration minimum sample size must be an integer of at least 20.");
  }

  // Preserve chronology for forward diagnostics; old records without raw scores are ignored.
  const chronological = input.filter(item =>
    Number.isFinite(item.rawScore) &&
    item.rawScore >= 0 &&
    item.rawScore <= 1 &&
    (item.outcome === "WIN" || item.outcome === "LOSS")
  );

  if (chronological.length < minimumSampleSize) {
    return {
      probability: null,
      lowerConfidenceProbability: null,
      status: "UNCALIBRATED",
      sampleSize: chronological.length,
      brierScore: null,
      expectedCalibrationError: null,
    };
  }

  const validationSize = Math.max(20, Math.floor(chronological.length * 0.25));
  const training = chronological.slice(0, chronological.length - validationSize);
  const validation = chronological.slice(chronological.length - validationSize);
  const diagnostics = forwardCalibrationDiagnostics(training, validation);

  // The live estimate uses all outcomes known before this prediction timestamp.
  const finalBlocks = buildIsotonicBlocks(chronological);
  const matchedBlock = finalBlocks.find(block => rawScore <= block.maxScore) || finalBlocks[finalBlocks.length - 1];
  const probability = blockProbability(matchedBlock);
  const lowerConfidenceProbability = wilsonLowerBound(matchedBlock.wins, matchedBlock.count);

  return {
    probability: Number(probability.toFixed(4)),
    lowerConfidenceProbability: Number(lowerConfidenceProbability.toFixed(4)),
    status: rawScore - probability >= 0.10 ? "OVERCONFIDENT" : "CALIBRATED",
    sampleSize: chronological.length,
    brierScore: diagnostics.brierScore,
    expectedCalibrationError: diagnostics.expectedCalibrationError,
  };
}
