import type { ResearchSignal } from '../types/index.ts';

export type AnalyticsSession =
  | 'ASIA'
  | 'LONDON'
  | 'OVERLAP'
  | 'NEW_YORK'
  | 'LATE_NEW_YORK'
  | 'UNCLASSIFIED';

export interface AccuracyBucket {
  wins: number;
  losses: number;
  scratches: number;
  trades: number;
  decidedTrades: number;
  winRate: number;
  netReturnUnits: number;
}

export interface SignalAnalytics {
  totalTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  decidedTrades: number;
  winRate: number;
  netReturnUnits: number;
  pendingCount: number;
  unresolvedCount: number;
  byPair: Record<string, AccuracyBucket>;
  byStrategy: Record<string, AccuracyBucket>;
  bySession: Record<AnalyticsSession, AccuracyBucket>;
}

/** Returns a stable YYYY-MM-DD key in the reporting timezone (Asia/Kolkata). */
export function getIstDateString(value: string | number | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Prefer the actual economic expiry instant; never group by prediction creation time when settled. */
export function getEconomicConclusionIstDate(signal: Partial<ResearchSignal>): string | null {
  return getIstDateString(
    signal.actualExitTimeUtc ||
    signal.plannedExitTimeUtc ||
    signal.candleCloseTimeUtc ||
    signal.entryWindowEndUtc ||
    signal.predictionTimeUtc
  );
}

function sessionAt(value: string | null | undefined): AnalyticsSession {
  if (!value) return 'UNCLASSIFIED';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'UNCLASSIFIED';

  const partsAt = (timeZone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const part = (type: string) => parts.find(item => item.type === type)?.value || '';
    return { day: part('weekday'), hour: Number(part('hour')), minute: Number(part('minute')) };
  };

  const newYork = partsAt('America/New_York');
  const london = partsAt('Europe/London');
  const newYorkHour = newYork.hour + newYork.minute / 60;
  const londonHour = london.hour + london.minute / 60;

  if (
    newYork.day === 'Sat' ||
    (newYork.day === 'Fri' && newYorkHour >= 17) ||
    (newYork.day === 'Sun' && newYorkHour < 17)
  ) return 'UNCLASSIFIED';

  const londonOpen = !['Sat', 'Sun'].includes(london.day) && londonHour >= 8 && londonHour < 16.5;
  const newYorkOpen = !['Sat', 'Sun'].includes(newYork.day) && newYorkHour >= 8 && newYorkHour < 17;

  if (londonOpen && newYorkOpen) return 'OVERLAP';
  if (londonOpen) return 'LONDON';
  if (newYorkOpen) return londonHour >= 14 ? 'LATE_NEW_YORK' : 'NEW_YORK';
  return 'ASIA';
}

const createEmptyBucket = (): AccuracyBucket => ({
  wins: 0,
  losses: 0,
  scratches: 0,
  trades: 0,
  decidedTrades: 0,
  winRate: 0,
  netReturnUnits: 0,
});

function addOutcome(bucket: AccuracyBucket, signal: ResearchSignal): void {
  if (signal.outcomeResult === 'WIN') bucket.wins += 1;
  else if (signal.outcomeResult === 'LOSS') bucket.losses += 1;
  else if (signal.outcomeResult === 'SCRATCH') bucket.scratches += 1;
  bucket.netReturnUnits += Number(signal.netReturnUnits) || 0;
}

function finalizeBucket(bucket: AccuracyBucket): void {
  bucket.trades = bucket.wins + bucket.losses + bucket.scratches;
  bucket.decidedTrades = bucket.wins + bucket.losses;
  bucket.winRate = bucket.decidedTrades
    ? Number((100 * bucket.wins / bucket.decidedTrades).toFixed(1))
    : 0;
  bucket.netReturnUnits = Number(bucket.netReturnUnits.toFixed(3));
}

/**
 * One canonical calculation for the terminal, history API and performance views.
 * SCRATCH is included in trade count/return but excluded from decisive win-rate denominator.
 * Internal test fixtures are deliberately excluded from production performance.
 */
export function aggregateSignalPerformance(
  signals: ResearchSignal[],
  date: string | null = null
): SignalAnalytics {
  const rows = (Array.isArray(signals) ? signals : [])
    .filter(signal => signal && !signal.ruleFamily?.startsWith('test_'));

  const pendingCount = rows.filter(signal => signal.lifecycleState === 'EXIT_PENDING').length;
  const unresolvedCount = rows.filter(signal =>
    ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE', 'EXIT_PENDING'].includes(signal.lifecycleState)
  ).length;
  const completed = rows.filter(signal =>
    signal.lifecycleState === 'CLOSED' &&
    ['WIN', 'LOSS', 'SCRATCH'].includes(signal.outcomeResult) &&
    (date === null || getEconomicConclusionIstDate(signal) === date)
  );

  const overall = createEmptyBucket();
  const byPair: Record<string, AccuracyBucket> = {};
  const byStrategy: Record<string, AccuracyBucket> = {};
  const bySession: Record<AnalyticsSession, AccuracyBucket> = {
    ASIA: createEmptyBucket(),
    LONDON: createEmptyBucket(),
    OVERLAP: createEmptyBucket(),
    NEW_YORK: createEmptyBucket(),
    LATE_NEW_YORK: createEmptyBucket(),
    UNCLASSIFIED: createEmptyBucket(),
  };

  for (const signal of completed) {
    addOutcome(overall, signal);

    const pair = signal.symbol || 'UNKNOWN';
    byPair[pair] ??= createEmptyBucket();
    addOutcome(byPair[pair], signal);

    const strategy = signal.strategyName ||
      signal.confluenceStrategies?.[0] ||
      signal.ruleFamily ||
      'Unclassified';
    byStrategy[strategy] ??= createEmptyBucket();
    addOutcome(byStrategy[strategy], signal);

    const recordedSession = signal.marketSession as AnalyticsSession | undefined;
    const session = recordedSession && Object.hasOwn(bySession, recordedSession)
      ? recordedSession
      : sessionAt(signal.actualEntryTimeUtc || signal.candleOpenTimeUtc);
    addOutcome(bySession[session], signal);
  }

  finalizeBucket(overall);
  Object.values(byPair).forEach(finalizeBucket);
  Object.values(byStrategy).forEach(finalizeBucket);
  Object.values(bySession).forEach(finalizeBucket);

  return {
    totalTrades: overall.trades,
    wins: overall.wins,
    losses: overall.losses,
    scratches: overall.scratches,
    decidedTrades: overall.decidedTrades,
    winRate: overall.winRate,
    netReturnUnits: overall.netReturnUnits,
    pendingCount,
    unresolvedCount,
    byPair,
    byStrategy,
    bySession,
  };
}
