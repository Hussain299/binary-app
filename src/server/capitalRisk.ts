/**
 * Paper-only capital-survival governor.
 *
 * This module answers a narrow question: given conservative evidence, would a
 * small research bankroll be allowed to allocate a tiny hypothetical stake?
 *
 * It never places orders or changes signal creation. Live execution remains
 * separately disabled. Unknown evidence means zero suggested allocation.
 */

export type RiskDirection = "BUY" | "SELL";

export interface RiskPosition {
  symbol: string;
  direction: RiskDirection;
  stakeFraction: number;
}

export interface CapitalRiskCandidate {
  symbol: string;
  direction: RiskDirection;
  payoutPct: number;
  /** One-sided conservative probability bound from prior, settled observations. */
  winProbabilityLowerBound: number | null;
  calibrationSampleSize: number;
}

export interface CapitalRiskState {
  currentEquity: number;
  peakEquity: number;
  dayStartingEquity: number;
  openPositions: readonly RiskPosition[];
  candidate: CapitalRiskCandidate;
}

export interface CapitalRiskPolicy {
  minimumPayoutPct: number;
  minimumCalibrationSample: number;
  fractionalKelly: number;
  maximumStakeFractionPerTrade: number;
  maximumTotalOpenStakeFraction: number;
  maximumDrawdownFraction: number;
  maximumDailyLossFraction: number;
  maximumCurrencyExposureFraction: number;
}

export const CONSERVATIVE_PAPER_RISK_POLICY: Readonly<CapitalRiskPolicy> = Object.freeze({
  minimumPayoutPct: 80,
  minimumCalibrationSample: 100,
  fractionalKelly: 0.25,
  maximumStakeFractionPerTrade: 0.0025,
  maximumTotalOpenStakeFraction: 0.0075,
  maximumDrawdownFraction: 0.05,
  maximumDailyLossFraction: 0.015,
  maximumCurrencyExposureFraction: 0.005,
});

export type CapitalRiskReason =
  | "INVALID_ACCOUNT_STATE"
  | "PAYOUT_BELOW_FLOOR"
  | "INSUFFICIENT_CALIBRATION_EVIDENCE"
  | "NO_CONSERVATIVE_EDGE"
  | "DRAWDOWN_LIMIT_REACHED"
  | "DAILY_LOSS_LIMIT_REACHED"
  | "OPEN_RISK_LIMIT_REACHED"
  | "CURRENCY_CONCENTRATION_LIMIT_REACHED"
  | "ALLOCATED";

export interface CapitalRiskAssessment {
  permitted: boolean;
  reason: CapitalRiskReason;
  suggestedStakeFraction: number;
  breakEvenWinProbability: number | null;
  conservativeWinProbability: number | null;
  conservativeExpectedReturnPerUnit: number | null;
  currentDrawdownFraction: number | null;
  currentDailyLossFraction: number | null;
  projectedTotalOpenStakeFraction: number;
  currencyExposureAfterCandidate: Record<string, number>;
  explanation: string;
}

function invalidAssessment(
  reason: CapitalRiskReason,
  explanation: string,
  projectedTotalOpenStakeFraction = 0,
  currencyExposureAfterCandidate: Record<string, number> = {}
): CapitalRiskAssessment {
  return {
    permitted: false,
    reason,
    suggestedStakeFraction: 0,
    breakEvenWinProbability: null,
    conservativeWinProbability: null,
    conservativeExpectedReturnPerUnit: null,
    currentDrawdownFraction: null,
    currentDailyLossFraction: null,
    projectedTotalOpenStakeFraction,
    currencyExposureAfterCandidate,
    explanation,
  };
}

/** Return currency exposure weighted by the full amount at risk, not trade count. */
function currencyExposure(positions: readonly RiskPosition[]): Record<string, number> {
  const exposure: Record<string, number> = {};
  for (const position of positions) {
    const [base, quote] = position.symbol.split("/");
    if (!base || !quote || !Number.isFinite(position.stakeFraction) || position.stakeFraction < 0) continue;
    const sign = position.direction === "BUY" ? 1 : -1;
    exposure[base] = (exposure[base] || 0) + sign * position.stakeFraction;
    exposure[quote] = (exposure[quote] || 0) - sign * position.stakeFraction;
  }
  return exposure;
}

function totalOpenStake(positions: readonly RiskPosition[]): number {
  return positions.reduce((sum, position) => sum + position.stakeFraction, 0);
}

/** Binary-option break-even probability at the supplied payout. */
export function payoutBreakEvenProbability(payoutPct: number): number {
  if (!Number.isFinite(payoutPct) || payoutPct <= 0) return 1;
  return 1 / (1 + payoutPct / 100);
}

/**
 * Conservative fractional-Kelly sizing for a binary contract.
 * Uses the supplied one-sided lower probability bound, not the point estimate.
 */
export function assessPaperCapitalRisk(
  state: CapitalRiskState,
  policy: CapitalRiskPolicy = CONSERVATIVE_PAPER_RISK_POLICY
): CapitalRiskAssessment {
  const candidate = state.candidate;
  const openStake = totalOpenStake(state.openPositions);
  const currentExposure = currencyExposure(state.openPositions);

  if (
    !Number.isFinite(state.currentEquity) || state.currentEquity <= 0 ||
    !Number.isFinite(state.peakEquity) || state.peakEquity <= 0 ||
    !Number.isFinite(state.dayStartingEquity) || state.dayStartingEquity <= 0 ||
    !Number.isFinite(candidate.payoutPct) ||
    !Number.isInteger(candidate.calibrationSampleSize) ||
    candidate.calibrationSampleSize < 0 ||
    !Number.isFinite(policy.fractionalKelly) || policy.fractionalKelly <= 0 || policy.fractionalKelly > 1 ||
    !Number.isFinite(policy.maximumStakeFractionPerTrade) || policy.maximumStakeFractionPerTrade <= 0 ||
    !Number.isFinite(policy.maximumTotalOpenStakeFraction) || policy.maximumTotalOpenStakeFraction <= 0 ||
    !Number.isFinite(policy.maximumDrawdownFraction) || policy.maximumDrawdownFraction <= 0 ||
    !Number.isFinite(policy.maximumDailyLossFraction) || policy.maximumDailyLossFraction <= 0 ||
    !Number.isFinite(policy.maximumCurrencyExposureFraction) || policy.maximumCurrencyExposureFraction <= 0 ||
    !state.openPositions.every(position =>
      (position.direction === "BUY" || position.direction === "SELL") &&
      /^([A-Z]{3})\/([A-Z]{3})$/.test(position.symbol) &&
      Number.isFinite(position.stakeFraction) && position.stakeFraction >= 0
    ) ||
    !/^([A-Z]{3})\/([A-Z]{3})$/.test(candidate.symbol) ||
    (candidate.direction !== "BUY" && candidate.direction !== "SELL")
  ) {
    return invalidAssessment(
      "INVALID_ACCOUNT_STATE",
      "Account, policy or portfolio inputs are invalid. No hypothetical capital allocation is permitted.",
      openStake,
      currentExposure
    );
  }

  const drawdown = Math.max(0, 1 - state.currentEquity / state.peakEquity);
  const dailyLoss = Math.max(0, 1 - state.currentEquity / state.dayStartingEquity);
  if (drawdown >= policy.maximumDrawdownFraction) {
    return { ...invalidAssessment(
      "DRAWDOWN_LIMIT_REACHED",
      "The simulated equity drawdown reached its stop. Research may continue, but new hypothetical allocations are paused.",
      openStake,
      currentExposure
    ), currentDrawdownFraction: drawdown, currentDailyLossFraction: dailyLoss };
  }
  if (dailyLoss >= policy.maximumDailyLossFraction) {
    return { ...invalidAssessment(
      "DAILY_LOSS_LIMIT_REACHED",
      "The simulated daily loss limit was reached. No additional hypothetical stake is allowed today.",
      openStake,
      currentExposure
    ), currentDrawdownFraction: drawdown, currentDailyLossFraction: dailyLoss };
  }
  if (candidate.payoutPct < policy.minimumPayoutPct) {
    return { ...invalidAssessment(
      "PAYOUT_BELOW_FLOOR",
      "The contract payout is below the permanent policy floor. Do not attempt to compensate with a higher win-rate assumption.",
      openStake,
      currentExposure
    ), currentDrawdownFraction: drawdown, currentDailyLossFraction: dailyLoss };
  }
  if (
    candidate.calibrationSampleSize < policy.minimumCalibrationSample ||
    candidate.winProbabilityLowerBound === null ||
    !Number.isFinite(candidate.winProbabilityLowerBound) ||
    candidate.winProbabilityLowerBound < 0 ||
    candidate.winProbabilityLowerBound > 1
  ) {
    return { ...invalidAssessment(
      "INSUFFICIENT_CALIBRATION_EVIDENCE",
      "The lower confidence bound is unavailable or fewer than the required settled calibration outcomes exist. Suggested stake is zero.",
      openStake,
      currentExposure
    ), currentDrawdownFraction: drawdown, currentDailyLossFraction: dailyLoss };
  }

  const breakEven = payoutBreakEvenProbability(candidate.payoutPct);
  const p = candidate.winProbabilityLowerBound;
  const payoutMultiple = candidate.payoutPct / 100;
  const expectedReturn = (p * payoutMultiple) - (1 - p);
  if (p <= breakEven || expectedReturn <= 0) {
    return {
      ...invalidAssessment(
        "NO_CONSERVATIVE_EDGE",
        "The conservative probability bound does not clear the payout-adjusted break-even rate. The rational allocation is zero.",
        openStake,
        currentExposure
      ),
      breakEvenWinProbability: breakEven,
      conservativeWinProbability: p,
      conservativeExpectedReturnPerUnit: expectedReturn,
      currentDrawdownFraction: drawdown,
      currentDailyLossFraction: dailyLoss,
    };
  }

  // Full Kelly for +payout on win and -1 on loss: f = p - (1-p)/payout.
  const fullKelly = p - ((1 - p) / payoutMultiple);
  const suggestedStakeFraction = Math.min(
    policy.maximumStakeFractionPerTrade,
    Math.max(0, fullKelly * policy.fractionalKelly)
  );

  if (suggestedStakeFraction <= 0) {
    return { ...invalidAssessment(
      "NO_CONSERVATIVE_EDGE",
      "Fractional-Kelly sizing produced no positive allocation after conservative edge checks.",
      openStake,
      currentExposure
    ), breakEvenWinProbability: breakEven, conservativeWinProbability: p,
      conservativeExpectedReturnPerUnit: expectedReturn,
      currentDrawdownFraction: drawdown, currentDailyLossFraction: dailyLoss };
  }

  const projectedOpenStake = openStake + suggestedStakeFraction;
  if (projectedOpenStake > policy.maximumTotalOpenStakeFraction) {
    return { ...invalidAssessment(
      "OPEN_RISK_LIMIT_REACHED",
      "Adding this position would exceed the portfolio's total open stake-risk ceiling.",
      projectedOpenStake,
      currentExposure
    ), breakEvenWinProbability: breakEven, conservativeWinProbability: p,
      conservativeExpectedReturnPerUnit: expectedReturn,
      currentDrawdownFraction: drawdown, currentDailyLossFraction: dailyLoss };
  }

  const nextExposure = currencyExposure([
    ...state.openPositions,
    { symbol: candidate.symbol, direction: candidate.direction, stakeFraction: suggestedStakeFraction },
  ]);
  const concentrated = Object.entries(nextExposure).find(
    ([, amount]) => Math.abs(amount) > policy.maximumCurrencyExposureFraction
  );
  if (concentrated) {
    return {
      ...invalidAssessment(
        "CURRENCY_CONCENTRATION_LIMIT_REACHED",
        `The proposed position would concentrate ${concentrated[0]} exposure beyond the portfolio limit. Correlated pairs are not independent bets.`,
        projectedOpenStake,
        nextExposure
      ),
      breakEvenWinProbability: breakEven,
      conservativeWinProbability: p,
      conservativeExpectedReturnPerUnit: expectedReturn,
      currentDrawdownFraction: drawdown,
      currentDailyLossFraction: dailyLoss,
    };
  }

  return {
    permitted: true,
    reason: "ALLOCATED",
    suggestedStakeFraction: Number(suggestedStakeFraction.toFixed(6)),
    breakEvenWinProbability: Number(breakEven.toFixed(4)),
    conservativeWinProbability: Number(p.toFixed(4)),
    conservativeExpectedReturnPerUnit: Number(expectedReturn.toFixed(4)),
    currentDrawdownFraction: Number(drawdown.toFixed(4)),
    currentDailyLossFraction: Number(dailyLoss.toFixed(4)),
    projectedTotalOpenStakeFraction: Number(projectedOpenStake.toFixed(6)),
    currencyExposureAfterCandidate: Object.fromEntries(
      Object.entries(nextExposure).map(([currency, exposure]) => [currency, Number(exposure.toFixed(6))])
    ),
    explanation: "A small fractional-Kelly paper allocation passed the conservative probability, payout, drawdown, open-risk and currency-concentration checks. This is a research estimate, not a live order instruction.",
  };
}
