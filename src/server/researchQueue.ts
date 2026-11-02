import type {
  AutonomousResearchPairState,
  AutonomousResearchPairStatus,
  ForexSymbol,
} from '../types/index.ts';

export function createInitialAutonomousResearchQueueState() {
  return {
    schemaVersion: 1 as const,
    nextPairIndex: 0,
    currentSymbol: null,
    lastScanAt: null,
    lastScanFinishedAt: null,
    lastBatchStartedAt: null,
    lastBatchFinishedAt: null,
    nextRunAt: null,
    cooldownSeconds: 60,
    batchesStarted: 0,
    batchesCompleted: 0,
    batchesFailed: 0,
    lastRunStatus: 'IDLE' as const,
    lastRunMessage: 'Multi-pair research queue initialized.',
    pairs: {},
  };
}

export const MINIMUM_RESEARCH_M1_CANDLES = 60_000;
export const RESEARCH_HISTORY_WINDOW_LIMIT = 120_000;
export const RESEARCH_CANDIDATES_PER_BATCH = 300;
export const AUTONOMOUS_RESEARCH_COOLDOWN_SECONDS = 60;
export const MINIMUM_M1_CONTINUITY_RATIO = 0.75;

export interface ResearchHistoryStats {
  symbol: ForexSymbol;
  count: number;
  usableM1Count: number;
  zeroVolumeFlatRows: number;
  continuityRatio: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  monthsStored: number;
  sources: string[];
}

export interface ResearchReadiness {
  status: AutonomousResearchPairStatus;
  genuinelyNewM1Candles: number;
  readinessMessage: string;
}

/**
 * Apply the same minimum-history and continuity requirements as researchEngine.
 * A previously inspected pair must contribute 60k genuinely newer usable M1
 * observations before it can be searched again; the holdout ledger remains the
 * authority that prevents an inspected test window from being reused.
 */
export function assessResearchPairReadiness(
  stats: ResearchHistoryStats,
  previousHoldoutEndMs: number | null,
  lastInspectedThroughMs: number | null,
  genuinelyNewM1Candles: number,
): ResearchReadiness {
  if (stats.count === 0 || stats.usableM1Count === 0) {
    return {
      status: 'NO_HISTORY',
      genuinelyNewM1Candles: 0,
      readinessMessage: 'No imported M1 history is stored for this pair.',
    };
  }

  if (stats.usableM1Count < MINIMUM_RESEARCH_M1_CANDLES) {
    return {
      status: 'INSUFFICIENT_HISTORY',
      genuinelyNewM1Candles: 0,
      readinessMessage: `Needs ${MINIMUM_RESEARCH_M1_CANDLES.toLocaleString()} usable M1 candles; ${stats.usableM1Count.toLocaleString()} are available after excluding zero-volume flat closure rows.`,
    };
  }

  if (!Number.isFinite(stats.continuityRatio) ||
      stats.continuityRatio < MINIMUM_M1_CONTINUITY_RATIO) {
    return {
      status: 'LOW_CONTINUITY',
      genuinelyNewM1Candles: 0,
      readinessMessage: `M1 continuity is ${(stats.continuityRatio * 100).toFixed(1)}%; at least ${(MINIMUM_M1_CONTINUITY_RATIO * 100).toFixed(0)}% is required for chronological research.`,
    };
  }

  const consumedThroughMs = Math.max(
    previousHoldoutEndMs ?? 0,
    lastInspectedThroughMs ?? 0,
  );
  if (consumedThroughMs > 0 && genuinelyNewM1Candles < MINIMUM_RESEARCH_M1_CANDLES) {
    return {
      status: 'WAITING_FOR_NEW_HISTORY',
      genuinelyNewM1Candles,
      readinessMessage: `Waiting for ${(MINIMUM_RESEARCH_M1_CANDLES - genuinelyNewM1Candles).toLocaleString()} more genuinely new usable M1 candles after the last inspected window. Previously inspected history is not recycled.`,
    };
  }

  return {
    status: 'READY',
    genuinelyNewM1Candles: consumedThroughMs > 0 ? genuinelyNewM1Candles : stats.usableM1Count,
    readinessMessage: 'History, continuity and holdout freshness gates passed. Pair is queued for its own 300-candidate batch.',
  };
}

/** Rotate fairly through eligible pairs, persisting the next cursor between runs. */
export function selectNextResearchPair(
  pairs: readonly ForexSymbol[],
  nextPairIndex: number,
  eligibleSymbols: ReadonlySet<ForexSymbol>,
): { symbol: ForexSymbol; index: number; nextPairIndex: number } | null {
  if (pairs.length === 0) return null;
  const start = ((Math.floor(nextPairIndex) % pairs.length) + pairs.length) % pairs.length;
  for (let offset = 0; offset < pairs.length; offset++) {
    const index = (start + offset) % pairs.length;
    const symbol = pairs[index];
    if (eligibleSymbols.has(symbol)) {
      return {
        symbol,
        index,
        nextPairIndex: (index + 1) % pairs.length,
      };
    }
  }
  return null;
}

/** Assign deterministic queue positions without loading candle arrays for every pair. */
export function assignResearchQueuePositions(
  pairs: readonly ForexSymbol[],
  nextPairIndex: number,
  eligibleSymbols: ReadonlySet<ForexSymbol>,
): Map<ForexSymbol, number> {
  const positions = new Map<ForexSymbol, number>();
  if (pairs.length === 0) return positions;
  let position = 1;
  for (let offset = 0; offset < pairs.length; offset++) {
    const symbol = pairs[(nextPairIndex + offset) % pairs.length];
    if (eligibleSymbols.has(symbol)) positions.set(symbol, position++);
  }
  return positions;
}
