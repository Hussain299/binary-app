/**
 * Out-of-sample score calibration for forward-paper strategy predictions.
 *
 * The genome activation/conviction score is not a probability. This module
 * estimates an empirical win probability from earlier settled observations only.
 * It never changes the raw score or the trading trigger.
 */

export interface CalibrationObservation {
  rawScore: number;
  outcome: "WIN" | "LOSS";
}

export interface CalibratedScore {
  probability: number | null;
  status: "CALIBRATED" | "UNCALIBRATED" | "OVERCONFIDENT";
  sampleSize: number;
  brierScore: number | null;
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

function mergeBlocks(left: CalibrationBlock, right: CalibrationBlock): CalibrationBlock {
  return {
    minScore: left.minScore,
    maxScore: right.maxScore,
    scoreTotal: left.scoreTotal + right.scoreTotal,
    wins: left.wins + right.wins,
    count: left.count + right.count,
  };
}

/** Fit monotonic isotonic calibration using only outcomes already observed. */
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

  const observations = input.filter(item =>
    Number.isFinite(item.rawScore) &&
    item.rawScore >= 0 &&
    item.rawScore <= 1 &&
    (item.outcome === "WIN" || item.outcome === "LOSS")
  ).slice().sort((a, b) => a.rawScore - b.rawScore);

  if (observations.length < minimumSampleSize) {
    return {
      probability: null,
      status: "UNCALIBRATED",
      sampleSize: observations.length,
      brierScore: null,
      expectedCalibrationError: null,
    };
  }

  // Equal-count bins, with at least twenty observations per initial bin.
  const binCount = Math.min(10, Math.max(2, Math.floor(observations.length / 20)));
  const blocks: CalibrationBlock[] = [];
  for (let bin = 0; bin < binCount; bin++) {
    const start = Math.floor((bin * observations.length) / binCount);
    const end = Math.floor(((bin + 1) * observations.length) / binCount);
    const slice = observations.slice(start, end);
    if (slice.length === 0) continue;
    blocks.push({
      minScore: slice[0].rawScore,
      maxScore: slice[slice.length - 1].rawScore,
      scoreTotal: slice.reduce((sum, item) => sum + item.rawScore, 0),
      wins: slice.filter(item => item.outcome === "WIN").length,
      count: slice.length,
    });
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

  const fittedBlockForScore = (score: number): CalibrationBlock => {
    const exact = blocks.find(block => score <= block.maxScore);
    return exact || blocks[blocks.length - 1];
  };
  const calibrated = blockProbability(fittedBlockForScore(rawScore));

  let squaredError = 0;
  let calibrationError = 0;
  for (const block of blocks) {
    const probability = blockProbability(block);
    const observedRate = block.wins / block.count;
    calibrationError += (block.count / observations.length) * Math.abs(observedRate - probability);
  }
  for (const observation of observations) {
    const probability = blockProbability(fittedBlockForScore(observation.rawScore));
    const outcome = observation.outcome === "WIN" ? 1 : 0;
    squaredError += Math.pow(probability - outcome, 2);
  }

  return {
    probability: Number(calibrated.toFixed(4)),
    status: rawScore - calibrated >= 0.10 ? "OVERCONFIDENT" : "CALIBRATED",
    sampleSize: observations.length,
    brierScore: Number((squaredError / observations.length).toFixed(4)),
    expectedCalibrationError: Number(calibrationError.toFixed(4)),
  };
}
