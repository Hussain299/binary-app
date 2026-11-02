import type { ForexSymbol } from '../types/index.ts';

export interface PaperRiskPolicy {
  maximumStakeFractionPerTrade: number;
  maximumTotalOpenStakeFraction: number;
  minimumPayoutPct: number;
  maximumDrawdownPct: number;
  maximumDailyLossPct: number;
  minimumCalibrationSampleSize: number;
}

export const CONSERVATIVE_PAPER_RISK_POLICY: PaperRiskPolicy = {
  maximumStakeFractionPerTrade: 0.0025, // 0.25% per trade
  maximumTotalOpenStakeFraction: 0.0075, // 0.75% total across all open positions
  minimumPayoutPct: 80,
  maximumDrawdownPct: 0.05, // 5% peak-to-trough
  maximumDailyLossPct: 0.02, // 2% daily loss limit
  minimumCalibrationSampleSize: 100,
};

export function payoutBreakEvenProbability(payoutPct: number): number {
  if (payoutPct <= 0) return 1.0;
  return 1 / (1 + payoutPct / 100);
}

export interface PaperCapitalRiskParams {
  currentEquity: number;
  peakEquity: number;
  dayStartingEquity: number;
  openPositions: Array<{
    symbol: ForexSymbol | string;
    direction: 'BUY' | 'SELL';
    stakeFraction: number;
  }>;
  candidate: {
    symbol: ForexSymbol | string;
    direction: 'BUY' | 'SELL';
    payoutPct: number;
    winProbabilityLowerBound: number;
    calibrationSampleSize: number;
  };
}

export interface PaperCapitalRiskAssessment {
  permitted: boolean;
  reason:
    | 'ALLOCATED'
    | 'PAYOUT_BELOW_FLOOR'
    | 'DRAWDOWN_LIMIT_REACHED'
    | 'DAILY_LOSS_LIMIT_REACHED'
    | 'INSUFFICIENT_CALIBRATION_EVIDENCE'
    | 'NO_CONSERVATIVE_EDGE'
    | 'CURRENCY_CONCENTRATION_LIMIT_REACHED'
    | 'OPEN_RISK_LIMIT_REACHED';
  suggestedStakeFraction: number;
  projectedTotalOpenStakeFraction: number;
  conservativeWinProbability?: number;
  breakEvenWinProbability?: number;
}

export function assessPaperCapitalRisk(params: PaperCapitalRiskParams): PaperCapitalRiskAssessment {
  const policy = CONSERVATIVE_PAPER_RISK_POLICY;
  const breakEvenRate = Number(payoutBreakEvenProbability(params.candidate.payoutPct).toFixed(4));
  const conservativeWinProb = params.candidate.winProbabilityLowerBound;
  const currentTotalOpen = params.openPositions.reduce((acc, p) => acc + p.stakeFraction, 0);

  // 1. Payout floor check
  if (params.candidate.payoutPct < policy.minimumPayoutPct) {
    return {
      permitted: false,
      reason: 'PAYOUT_BELOW_FLOOR',
      suggestedStakeFraction: 0,
      projectedTotalOpenStakeFraction: currentTotalOpen,
      conservativeWinProbability: conservativeWinProb,
      breakEvenWinProbability: breakEvenRate,
    };
  }

  // 2. Drawdown check: (peakEquity - currentEquity) / peakEquity >= 0.05
  if (params.peakEquity > 0 && (params.peakEquity - params.currentEquity) / params.peakEquity >= policy.maximumDrawdownPct - 1e-6) {
    return {
      permitted: false,
      reason: 'DRAWDOWN_LIMIT_REACHED',
      suggestedStakeFraction: 0,
      projectedTotalOpenStakeFraction: currentTotalOpen,
      conservativeWinProbability: conservativeWinProb,
      breakEvenWinProbability: breakEvenRate,
    };
  }

  // 3. Daily loss check: (dayStartingEquity - currentEquity) / dayStartingEquity >= 0.02
  if (params.dayStartingEquity > 0 && (params.dayStartingEquity - params.currentEquity) / params.dayStartingEquity >= policy.maximumDailyLossPct - 1e-6) {
    return {
      permitted: false,
      reason: 'DAILY_LOSS_LIMIT_REACHED',
      suggestedStakeFraction: 0,
      projectedTotalOpenStakeFraction: currentTotalOpen,
      conservativeWinProbability: conservativeWinProb,
      breakEvenWinProbability: breakEvenRate,
    };
  }

  // 4. Calibration sample size check
  if (params.candidate.calibrationSampleSize < policy.minimumCalibrationSampleSize) {
    return {
      permitted: false,
      reason: 'INSUFFICIENT_CALIBRATION_EVIDENCE',
      suggestedStakeFraction: 0,
      projectedTotalOpenStakeFraction: currentTotalOpen,
      conservativeWinProbability: conservativeWinProb,
      breakEvenWinProbability: breakEvenRate,
    };
  }

  // 5. Conservative edge check: lower bound must strictly exceed break-even
  if (conservativeWinProb <= breakEvenRate) {
    return {
      permitted: false,
      reason: 'NO_CONSERVATIVE_EDGE',
      suggestedStakeFraction: 0,
      projectedTotalOpenStakeFraction: currentTotalOpen,
      conservativeWinProbability: conservativeWinProb,
      breakEvenWinProbability: breakEvenRate,
    };
  }

  // 6. Currency concentration check: if 2 open positions already contain USD and candidate contains USD
  const extractCurrencies = (sym: string) => sym.split('/');
  const candidateCurrencies = extractCurrencies(params.candidate.symbol);
  for (const c of candidateCurrencies) {
    const matchingCount = params.openPositions.filter(p => extractCurrencies(p.symbol).includes(c)).length;
    if (matchingCount >= 2) {
      return {
        permitted: false,
        reason: 'CURRENCY_CONCENTRATION_LIMIT_REACHED',
        suggestedStakeFraction: 0,
        projectedTotalOpenStakeFraction: currentTotalOpen,
        conservativeWinProbability: conservativeWinProb,
        breakEvenWinProbability: breakEvenRate,
      };
    }
  }

  // 7. Portfolio open-risk ceiling
  const suggestedStake = policy.maximumStakeFractionPerTrade;
  const projectedTotal = currentTotalOpen + suggestedStake;
  if (projectedTotal > policy.maximumTotalOpenStakeFraction + 1e-6) {
    return {
      permitted: false,
      reason: 'OPEN_RISK_LIMIT_REACHED',
      suggestedStakeFraction: 0,
      projectedTotalOpenStakeFraction: currentTotalOpen,
      conservativeWinProbability: conservativeWinProb,
      breakEvenWinProbability: breakEvenRate,
    };
  }

  return {
    permitted: true,
    reason: 'ALLOCATED',
    suggestedStakeFraction: suggestedStake,
    projectedTotalOpenStakeFraction: projectedTotal,
    conservativeWinProbability: conservativeWinProb,
    breakEvenWinProbability: breakEvenRate,
  };
}
