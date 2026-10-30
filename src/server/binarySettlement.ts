/**
 * Binary contract settlement in units of the stake.
 * A winning CALL/PUT returns the quoted payout as profit; a loss loses one
 * stake; an exact strike tie is treated as a push and excluded from scored WR.
 * Historical and forward research share this exact settlement function.
 */
export const DEFAULT_BINARY_PAYOUT_PERCENT = 80;

export interface BinarySettlement {
  outcome: 'WIN' | 'LOSS' | 'SCRATCH';
  payoutPct: number;
  netReturnUnits: number;
  priceMove: number;
}

export function calculateBinarySettlement(
  direction: 'BUY' | 'SELL',
  entryPrice: number,
  expiryPrice: number,
  payoutPct: number = DEFAULT_BINARY_PAYOUT_PERCENT
): BinarySettlement {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(expiryPrice) || entryPrice <= 0 || expiryPrice <= 0) {
    throw new Error('Binary settlement requires finite positive entry and expiry prices.');
  }
  if (!Number.isFinite(payoutPct) || payoutPct < DEFAULT_BINARY_PAYOUT_PERCENT || payoutPct > 100) {
    throw new Error(`Binary payout must be between ${DEFAULT_BINARY_PAYOUT_PERCENT}% and 100%.`);
  }
  const priceMove = direction === 'BUY' ? expiryPrice - entryPrice : entryPrice - expiryPrice;
  const epsilon = Math.max(1e-12, Math.abs(entryPrice) * 1e-12);
  if (priceMove > epsilon) return { outcome: 'WIN', payoutPct, netReturnUnits: payoutPct / 100, priceMove };
  if (priceMove < -epsilon) return { outcome: 'LOSS', payoutPct, netReturnUnits: -1, priceMove };
  return { outcome: 'SCRATCH', payoutPct, netReturnUnits: 0, priceMove: 0 };
}
