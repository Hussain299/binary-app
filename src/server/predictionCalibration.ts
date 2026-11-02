/**
 * Empirical prediction score calibration.
 * Translates raw strategy heuristic scores into empirical probabilities using
 * isotonic regression / monotonic binning of earlier settled forward observations.
 */

export interface CalibratedScoreResult {
  status: 'CALIBRATED' | 'UNCALIBRATED' | 'OVERCONFIDENT';
  probability: number | null;
  lowerConfidenceProbability?: number;
  sampleSize: number;
  brierScore: number | null;
  expectedCalibrationError: number | null;
}

export interface CalibrationObservation {
  rawScore: number;
  outcome: 'WIN' | 'LOSS';
}

export function calibratePredictionScore(
  rawScore: number,
  observations: CalibrationObservation[]
): CalibratedScoreResult {
  if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > 1) {
    throw new Error(`Raw score must be a finite number between 0.0 and 1.0; received: ${rawScore}`);
  }

  const valid = observations.filter(
    obs => Number.isFinite(obs.rawScore) && obs.rawScore >= 0 && obs.rawScore <= 1 && (obs.outcome === 'WIN' || obs.outcome === 'LOSS')
  );
  const sampleSize = valid.length;

  if (sampleSize < 100) {
    return {
      status: 'UNCALIBRATED',
      probability: null,
      sampleSize,
      brierScore: null,
      expectedCalibrationError: null,
    };
  }

  // Sort observations by rawScore ascending for isotonic calibration
  const sorted = [...valid].sort((a, b) => a.rawScore - b.rawScore);

  // Pool Adjacent Violators Algorithm (PAVA) for isotonic regression
  interface Block {
    weight: number;
    value: number; // empirical win rate
    minScore: number;
    maxScore: number;
  }

  const blocks: Block[] = sorted.map(item => ({
    weight: 1,
    value: item.outcome === 'WIN' ? 1 : 0,
    minScore: item.rawScore,
    maxScore: item.rawScore,
  }));

  // Compress into monotonic blocks
  let i = 0;
  while (i < blocks.length - 1) {
    if (blocks[i].value > blocks[i + 1].value) {
      // Merge blocks i and i + 1
      const mergedWeight = blocks[i].weight + blocks[i + 1].weight;
      const mergedValue = (blocks[i].value * blocks[i].weight + blocks[i + 1].value * blocks[i + 1].weight) / mergedWeight;
      blocks[i] = {
        weight: mergedWeight,
        value: mergedValue,
        minScore: blocks[i].minScore,
        maxScore: blocks[i + 1].maxScore,
      };
      blocks.splice(i + 1, 1);
      // Backtrack if violation with previous block
      if (i > 0) i--;
    } else {
      i++;
    }
  }

  // Lookup calibrated probability for rawScore from monotonic blocks
  let calibratedProbability: number;
  if (rawScore <= blocks[0].minScore) {
    calibratedProbability = blocks[0].value;
  } else if (rawScore >= blocks[blocks.length - 1].maxScore) {
    calibratedProbability = blocks[blocks.length - 1].value;
  } else {
    // Linear interpolation between block midpoints or step function
    const matchedIndex = blocks.findIndex(b => rawScore >= b.minScore && rawScore <= b.maxScore);
    if (matchedIndex >= 0) {
      calibratedProbability = blocks[matchedIndex].value;
    } else {
      // Find bounding blocks
      let left = blocks[0];
      let right = blocks[blocks.length - 1];
      for (let j = 0; j < blocks.length - 1; j++) {
        if (rawScore >= blocks[j].maxScore && rawScore <= blocks[j + 1].minScore) {
          left = blocks[j];
          right = blocks[j + 1];
          break;
        }
      }
      const range = right.minScore - left.maxScore;
      const t = range > 0 ? (rawScore - left.maxScore) / range : 0.5;
      calibratedProbability = left.value + t * (right.value - left.value);
    }
  }

  // Ensure probability stays in [0, 1]
  calibratedProbability = Math.max(0, Math.min(1, Number(calibratedProbability.toFixed(4))));

  // Compute overall Brier score and Expected Calibration Error (ECE)
  // Assign calibrated probability to each sample in the dataset using the fitted blocks
  const calibratedSamples = sorted.map(item => {
    let prob = blocks[0].value;
    for (const b of blocks) {
      if (item.rawScore <= b.maxScore) {
        prob = b.value;
        break;
      }
    }
    return {
      prob,
      target: item.outcome === 'WIN' ? 1 : 0,
      raw: item.rawScore,
    };
  });

  const brierScore = Number(
    (calibratedSamples.reduce((sum, s) => sum + Math.pow(s.prob - s.target, 2), 0) / sampleSize).toFixed(4)
  );

  // 10-bin ECE
  let totalEce = 0;
  for (let bin = 0; bin < 10; bin++) {
    const binLower = bin / 10;
    const binUpper = (bin + 1) / 10;
    const binItems = calibratedSamples.filter(s =>
      bin === 9 ? s.prob >= binLower && s.prob <= binUpper : s.prob >= binLower && s.prob < binUpper
    );
    if (binItems.length > 0) {
      const binAvgPred = binItems.reduce((acc, s) => acc + s.prob, 0) / binItems.length;
      const binTrueRate = binItems.reduce((acc, s) => acc + s.target, 0) / binItems.length;
      totalEce += (binItems.length / sampleSize) * Math.abs(binAvgPred - binTrueRate);
    }
  }
  const expectedCalibrationError = Number(totalEce.toFixed(4));

  // If raw score is materially higher than empirical probability by > 0.08, flag as OVERCONFIDENT
  const isOverconfident = (rawScore - calibratedProbability) > 0.08;
  const status = isOverconfident ? 'OVERCONFIDENT' : 'CALIBRATED';

  // Conservative lower bound for Wilson score on calibrated sample
  const lowerConfidenceProbability = Math.max(0, Number((calibratedProbability - 1.96 * Math.sqrt((calibratedProbability * (1 - calibratedProbability)) / sampleSize)).toFixed(4)));

  return {
    status,
    probability: calibratedProbability,
    lowerConfidenceProbability,
    sampleSize,
    brierScore,
    expectedCalibrationError,
  };
}
