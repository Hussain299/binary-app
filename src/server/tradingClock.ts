/**
 * Execution clock contract:
 * - Signals are issued from a fully closed M1 decision candle exactly 3 minutes
 *   before the next 5-minute entry candle opens.
 * - Expiry is a separate model choice from 5 through 30 minutes, in 5-minute steps.
 * - Research features may inspect lower-timeframe observations, but the live
 *   contract always enters on the 5-minute candle.
 */
export const ENTRY_CANDLE_TIMEFRAME_MINUTES = 5 as const;
export const TRADING_TIMEFRAMES_MINUTES = [ENTRY_CANDLE_TIMEFRAME_MINUTES] as const;
export type TradingTimeframeMinutes = typeof ENTRY_CANDLE_TIMEFRAME_MINUTES;

export const EXPIRY_HORIZONS_MINUTES = [5, 10, 15, 20, 25, 30] as const;
export type ExpiryHorizonMinutes = typeof EXPIRY_HORIZONS_MINUTES[number];

export function isSupportedExpiryMinutes(value: number): value is ExpiryHorizonMinutes {
  return Number.isInteger(value) &&
    (EXPIRY_HORIZONS_MINUTES as readonly number[]).includes(value);
}

export const M1_CANDLE_MS = 60_000;
export const ADVANCE_NOTICE_MINUTES = 3;
export const ADVANCE_NOTICE_MS = ADVANCE_NOTICE_MINUTES * M1_CANDLE_MS;
export const MAX_DECISION_PROCESSING_DELAY_MS = 25_000;
export const CLOCK_ALIGNMENT_TOLERANCE_MS = 5_000;

export interface EligibleEntryTimeframe {
  /** Always 5. This is the entry candle size, not the selected expiry. */
  timeframeMinutes: TradingTimeframeMinutes;
  entryTimeMs: number;
  decisionTimeMs: number;
}

/** Return the first 5-minute entry boundary strictly after referenceMs. */
export function getNextCandleOpenMs(
  referenceMs: number,
  timeframeMinutes: TradingTimeframeMinutes = ENTRY_CANDLE_TIMEFRAME_MINUTES
): number {
  if (!Number.isFinite(referenceMs) || timeframeMinutes !== ENTRY_CANDLE_TIMEFRAME_MINUTES) {
    throw new Error('A finite reference time and the fixed 5-minute entry timeframe are required.');
  }
  const intervalMs = ENTRY_CANDLE_TIMEFRAME_MINUTES * M1_CANDLE_MS;
  return (Math.floor(referenceMs / intervalMs) + 1) * intervalMs;
}

/**
 * Return the single 5-minute entry schedule only when the latest closed M1 bar
 * is exactly the T-3 decision bar. Expiry horizons are selected independently
 * by each historically qualified strategy after this entry schedule is found.
 */
export function findEligibleStartTimeframes(
  nowMs: number,
  latestClosedM1CloseTimeMs: number
): EligibleEntryTimeframe[] {
  if (!Number.isFinite(nowMs) || !Number.isFinite(latestClosedM1CloseTimeMs)) return [];

  const entryTimeMs = getNextCandleOpenMs(nowMs, ENTRY_CANDLE_TIMEFRAME_MINUTES);
  const decisionTimeMs = entryTimeMs - ADVANCE_NOTICE_MS;
  const decisionIsCurrent =
    nowMs >= decisionTimeMs &&
    nowMs < decisionTimeMs + MAX_DECISION_PROCESSING_DELAY_MS;
  const closedBarMatches =
    Math.abs(latestClosedM1CloseTimeMs - decisionTimeMs) <= CLOCK_ALIGNMENT_TOLERANCE_MS;

  if (!decisionIsCurrent || !closedBarMatches) return [];
  return [{
    timeframeMinutes: ENTRY_CANDLE_TIMEFRAME_MINUTES,
    entryTimeMs,
    decisionTimeMs,
  }];
}

/** Validate that a proposed entry is aligned to a 5-minute candle open. */
export function isAlignedCandleOpen(
  timestampMs: number,
  timeframeMinutes: TradingTimeframeMinutes = ENTRY_CANDLE_TIMEFRAME_MINUTES
): boolean {
  if (!Number.isFinite(timestampMs) || timeframeMinutes !== ENTRY_CANDLE_TIMEFRAME_MINUTES) return false;
  const intervalMs = ENTRY_CANDLE_TIMEFRAME_MINUTES * M1_CANDLE_MS;
  const nearestBoundary = Math.round(timestampMs / intervalMs) * intervalMs;
  return Math.abs(timestampMs - nearestBoundary) <= CLOCK_ALIGNMENT_TOLERANCE_MS;
}
