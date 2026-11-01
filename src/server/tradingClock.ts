/**
 * One shared clock contract for research labels and live paper signals.
 * A decision is made from a fully closed M1 candle exactly three minutes
 * before the next aligned 5–30 minute entry candle opens.
 */
export const TRADING_TIMEFRAMES_MINUTES = [5, 10, 15, 20, 25, 30] as const;
export type TradingTimeframeMinutes = typeof TRADING_TIMEFRAMES_MINUTES[number];

export const M1_CANDLE_MS = 60_000;
export const ADVANCE_NOTICE_MINUTES = 3;
export const ADVANCE_NOTICE_MS = ADVANCE_NOTICE_MINUTES * M1_CANDLE_MS;
export const CLOCK_ALIGNMENT_TOLERANCE_MS = 5_000;

export interface EligibleEntryTimeframe {
  timeframeMinutes: TradingTimeframeMinutes;
  entryTimeMs: number;
  decisionTimeMs: number;
}

/** Return the first timeframe boundary strictly after referenceMs. */
export function getNextCandleOpenMs(
  referenceMs: number,
  timeframeMinutes: TradingTimeframeMinutes
): number {
  if (!Number.isFinite(referenceMs) ||
      !TRADING_TIMEFRAMES_MINUTES.includes(timeframeMinutes)) {
    throw new Error("A finite reference time and supported 5–30 minute timeframe are required.");
  }
  const intervalMs = timeframeMinutes * M1_CANDLE_MS;
  return (Math.floor(referenceMs / intervalMs) + 1) * intervalMs;
}

/**
 * Return only schedules whose M1 decision candle has just closed at the exact
 * three-minute advance point. A signal cannot be created late in a broad window.
 */
export function findEligibleStartTimeframes(
  nowMs: number,
  latestClosedM1CloseTimeMs: number
): EligibleEntryTimeframe[] {
  if (!Number.isFinite(nowMs) || !Number.isFinite(latestClosedM1CloseTimeMs)) return [];
  const eligible: EligibleEntryTimeframe[] = [];
  for (const timeframeMinutes of TRADING_TIMEFRAMES_MINUTES) {
    const entryTimeMs = getNextCandleOpenMs(nowMs, timeframeMinutes);
    const decisionTimeMs = entryTimeMs - ADVANCE_NOTICE_MS;
    const decisionIsCurrent =
      nowMs >= decisionTimeMs &&
      nowMs < decisionTimeMs + M1_CANDLE_MS;
    const closedBarMatches =
      Math.abs(latestClosedM1CloseTimeMs - decisionTimeMs) <= CLOCK_ALIGNMENT_TOLERANCE_MS;
    if (decisionIsCurrent && closedBarMatches) {
      eligible.push({ timeframeMinutes, entryTimeMs, decisionTimeMs });
    }
  }
  return eligible;
}

/** Check whether a timestamp is an aligned open for one supported timeframe. */
export function isAlignedCandleOpen(
  timestampMs: number,
  timeframeMinutes: TradingTimeframeMinutes
): boolean {
  if (!Number.isFinite(timestampMs) ||
      !TRADING_TIMEFRAMES_MINUTES.includes(timeframeMinutes)) return false;
  const intervalMs = timeframeMinutes * M1_CANDLE_MS;
  const nearestBoundary = Math.round(timestampMs / intervalMs) * intervalMs;
  return Math.abs(timestampMs - nearestBoundary) <= CLOCK_ALIGNMENT_TOLERANCE_MS;
}
