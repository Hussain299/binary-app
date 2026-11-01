import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import type { ResearchSignal } from '../../types/index.js';

type AuditFilter = 'ALL' | 'PENDING' | 'SETTLED' | 'UNSCORED';
type AuditBucket = 'PENDING' | 'SETTLED' | 'UNSCORED';

interface DailyAuditViewProps {
  signals: ResearchSignal[];
  onEvaluateSignals: () => void;
  isEvaluating: boolean;
}

const PENDING_STATES = ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE', 'EXIT_PENDING'];
const SETTLED_OUTCOMES = ['WIN', 'LOSS', 'SCRATCH'];

function istDateKey(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values: Record<string, string> = {};
  for (const part of parts) values[part.type] = part.value;
  return [values.year, values.month, values.day].join('-');
}

function todayIST(): string {
  return istDateKey(new Date().toISOString());
}

function activityTime(signal: ResearchSignal): string {
  return signal.actualEntryTimeUtc ||
    signal.candleOpenTimeUtc ||
    signal.entryWindowStartUtc ||
    signal.predictionTimeUtc;
}

function expiryTime(signal: ResearchSignal): string | null {
  return signal.actualExitTimeUtc ||
    signal.plannedExitTimeUtc ||
    signal.candleCloseTimeUtc ||
    signal.entryWindowEndUtc ||
    null;
}

function isSettled(signal: ResearchSignal): boolean {
  return signal.lifecycleState === 'CLOSED' && SETTLED_OUTCOMES.includes(signal.outcomeResult);
}

function bucketFor(signal: ResearchSignal): AuditBucket {
  if (isSettled(signal)) return 'SETTLED';
  if (PENDING_STATES.includes(signal.lifecycleState)) return 'PENDING';
  return 'UNSCORED';
}

function statusFor(signal: ResearchSignal, nowMs: number): { label: string; tone: string } {
  if (isSettled(signal)) {
    if (signal.outcomeResult === 'WIN') return { label: 'WIN · VERIFIED', tone: 'win' };
    if (signal.outcomeResult === 'LOSS') return { label: 'LOSS · VERIFIED', tone: 'loss' };
    return { label: 'PUSH · VERIFIED', tone: 'push' };
  }

  if (signal.lifecycleState === 'EXIT_PENDING') {
    return { label: 'VERIFYING', tone: 'verifying' };
  }

  if (signal.lifecycleState === 'ACTIVE') {
    const plannedExpiry = expiryTime(signal);
    if (plannedExpiry && Date.parse(plannedExpiry) <= nowMs) {
      return { label: 'VERIFYING', tone: 'verifying' };
    }
    return { label: 'OPEN', tone: 'open' };
  }

  if (signal.lifecycleState === 'ENTRY_TRIGGERED') return { label: 'OPEN', tone: 'open' };
  if (signal.lifecycleState === 'WAITING_FOR_ENTRY') return { label: 'SCHEDULED', tone: 'scheduled' };
  if (signal.lifecycleState === 'INVALIDATED') return { label: 'INVALIDATED', tone: 'unscored' };
  if (signal.lifecycleState === 'AMBIGUOUS') return { label: 'AMBIGUOUS', tone: 'unscored' };
  if (signal.actualEntryPrice !== null && signal.actualEntryPrice !== undefined) {
    return { label: 'UNSCORED · DATA GAP', tone: 'unscored' };
  }
  return { label: 'NOT ENTERED', tone: 'unscored' };
}

function formatIST(value?: string | null, withDate = false): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    ...(withDate ? { day: '2-digit', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date).toUpperCase();
}

function formatPrice(value: number | null | undefined, symbol: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(symbol.includes('JPY') ? 3 : 5);
}

function formatUnits(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return (value > 0 ? '+' : '') + value.toFixed(2) + 'u';
}

function shiftDay(dateKey: string, amount: number): string {
  const parts = dateKey.split('-').map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return todayIST();
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dayLabel(dateKey: string): string {
  if (!dateKey) return 'Select a date';
  const date = new Date(dateKey + 'T12:00:00+05:30');
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export const DailyAuditView: React.FC<DailyAuditViewProps> = ({
  signals,
  onEvaluateSignals,
  isEvaluating,
}) => {
  const [selectedDate, setSelectedDate] = useState<string>(() => todayIST());
  const [filter, setFilter] = useState<AuditFilter>('ALL');
  const [expandedSignalId, setExpandedSignalId] = useState<string | null>(null);
  const nowMs = Date.now();
  const todayKey = todayIST();

  const daySignals = useMemo(() => signals
    .filter(signal => istDateKey(activityTime(signal)) === selectedDate)
    .sort((a, b) => Date.parse(activityTime(b)) - Date.parse(activityTime(a))),
  [signals, selectedDate]);

  const settledSignals = daySignals.filter(isSettled);
  const wins = settledSignals.filter(signal => signal.outcomeResult === 'WIN').length;
  const losses = settledSignals.filter(signal => signal.outcomeResult === 'LOSS').length;
  const pushes = settledSignals.filter(signal => signal.outcomeResult === 'SCRATCH').length;
  const decisiveCount = wins + losses;
  const pendingCount = daySignals.filter(signal => bucketFor(signal) === 'PENDING').length;
  const unscoredCount = daySignals.filter(signal => bucketFor(signal) === 'UNSCORED').length;
  const netReturn = settledSignals.reduce((sum, signal) => sum + (signal.netReturnUnits ?? 0), 0);
  const winRate = decisiveCount ? (wins / decisiveCount) * 100 : null;

  const visibleSignals = daySignals.filter(signal => {
    if (filter === 'ALL') return true;
    return bucketFor(signal) === filter;
  });

  const filters: Array<{ id: AuditFilter; label: string; count: number }> = [
    { id: 'ALL', label: 'All signals', count: daySignals.length },
    { id: 'PENDING', label: 'Pending', count: pendingCount },
    { id: 'SETTLED', label: 'Verified results', count: settledSignals.length },
    { id: 'UNSCORED', label: 'Unscored', count: unscoredCount },
  ];

  return (
    <div className="sf-audit-page">
      <header className="sf-audit-header">
        <div className="min-w-0">
          <div className="sf-audit-eyebrow">SIGNALFORGE / PERFORMANCE LEDGER</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="sf-audit-title">Daily audit</h1>
            <span className="sf-audit-paper-badge">PAPER ONLY</span>
          </div>
          <p className="sf-audit-subtitle">
            Every signal for one IST day, with its entry, expiry and verified outcome in one place.
          </p>
        </div>

        <div className="sf-audit-controls">
          <div className="sf-audit-date-control">
            <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              type="date"
              aria-label="Choose audit date in Indian Standard Time"
              value={selectedDate}
              onChange={event => {
                setSelectedDate(event.target.value);
                setExpandedSignalId(null);
                setFilter('ALL');
              }}
            />
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="sf-audit-icon-button"
              title="Previous day"
              aria-label="Previous day"
              onClick={() => {
                setSelectedDate(current => shiftDay(current, -1));
                setExpandedSignalId(null);
                setFilter('ALL');
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="sf-audit-icon-button"
              title="Next day"
              aria-label="Next day"
              disabled={selectedDate >= todayKey}
              onClick={() => {
                setSelectedDate(current => shiftDay(current, 1));
                setExpandedSignalId(null);
                setFilter('ALL');
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {selectedDate !== todayKey && (
              <button type="button" className="sf-audit-today" onClick={() => {
                setSelectedDate(todayKey);
                setExpandedSignalId(null);
                setFilter('ALL');
              }}>
                Today
              </button>
            )}
          </div>
          <button
            type="button"
            className="sf-audit-sync"
            onClick={onEvaluateSignals}
            disabled={isEvaluating}
            title="Reconcile due paper outcomes from trusted market candles"
          >
            <RefreshCw className={'h-3.5 w-3.5' + (isEvaluating ? ' animate-spin' : '')} />
            {isEvaluating ? 'Checking…' : 'Reconcile'}
          </button>
        </div>
      </header>

      <div className="sf-audit-date-line">
        <span>{dayLabel(selectedDate)}</span>
        <span className="sf-audit-refresh-note"><span className="sf-audit-live-dot" /> Auto-refresh enabled</span>
      </div>

      <section className="sf-audit-metrics" aria-label="Daily paper audit summary">
        <div className="sf-audit-metric">
          <span className="sf-audit-metric-label">Signals recorded</span>
          <strong>{daySignals.length}</strong>
          <small>Scheduled and entered observations</small>
        </div>
        <div className="sf-audit-metric">
          <span className="sf-audit-metric-label">Verified results</span>
          <strong>{wins}W <i>/</i> {losses}L</strong>
          <small>{pushes} pushes · {decisiveCount} decisive</small>
        </div>
        <div className="sf-audit-metric">
          <span className="sf-audit-metric-label">Still pending</span>
          <strong>{pendingCount}</strong>
          <small>Scheduled, open or awaiting candle data</small>
        </div>
        <div className="sf-audit-metric">
          <span className="sf-audit-metric-label">Net paper return</span>
          <strong className={netReturn > 0 ? 'is-positive' : netReturn < 0 ? 'is-negative' : ''}>
            {settledSignals.length ? formatUnits(netReturn) : '—'}
          </strong>
          <small>{settledSignals.length ? 'Stake units · recorded payout basis' : 'No verified return yet'}</small>
        </div>
      </section>

      <div className="sf-audit-performance-line">
        <span>
          Win rate <strong>{winRate === null ? '—' : winRate.toFixed(1) + '%'}</strong>
          <span className="sf-audit-muted"> · {decisiveCount} verified wins/losses · pushes excluded</span>
        </span>
        <span className="sf-audit-muted">Unscored / not entered: {unscoredCount}</span>
      </div>

      <section className="sf-audit-ledger">
        <div className="sf-audit-ledger-toolbar">
          <div>
            <h2>Signal ledger</h2>
            <p>Click a row to inspect the full evidence trail.</p>
          </div>
          <div className="sf-audit-filters" role="tablist" aria-label="Filter daily signals">
            {filters.map(item => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={'sf-audit-filter' + (filter === item.id ? ' is-selected' : '')}
                onClick={() => {
                  setFilter(item.id);
                  setExpandedSignalId(null);
                }}
              >
                {item.label}<span>{item.count}</span>
              </button>
            ))}
          </div>
        </div>

        {visibleSignals.length === 0 ? (
          <div className="sf-audit-empty">
            <div className="sf-audit-empty-icon"><Activity className="h-5 w-5" /></div>
            <h3>{daySignals.length === 0 ? 'No signals recorded for this day' : 'Nothing in this filter'}</h3>
            <p>
              {daySignals.length === 0
                ? 'Choose another IST date to audit earlier signals. Old observations are not carried forward as today’s activity.'
                : 'Try another ledger filter to see the remaining observations.'}
            </p>
            {daySignals.length === 0 && selectedDate !== todayKey && (
              <button type="button" onClick={() => setSelectedDate(todayKey)}>Return to today</button>
            )}
          </div>
        ) : (
          <div className="sf-audit-table-scroll">
            <table className="sf-audit-table">
              <thead>
                <tr>
                  <th>Market / direction</th>
                  <th>Signal time · IST</th>
                  <th>Paper entry</th>
                  <th>Expiry · IST</th>
                  <th>Outcome</th>
                  <th className="text-right">Return</th>
                </tr>
              </thead>
              <tbody>
                {visibleSignals.map(signal => {
                  const status = statusFor(signal, nowMs);
                  const bucket = bucketFor(signal);
                  const entryAt = signal.actualEntryTimeUtc || signal.candleOpenTimeUtc || signal.entryWindowStartUtc;
                  const exitAt = expiryTime(signal);
                  const settled = isSettled(signal);
                  const expanded = expandedSignalId === signal.id;
                  const lastEvent = signal.lifecycleHistory?.[signal.lifecycleHistory.length - 1];
                  const isBuy = signal.direction === 'BUY';

                  return (
                    <React.Fragment key={signal.id}>
                      <tr
                        className={'sf-audit-row' + (expanded ? ' is-expanded' : '')}
                        onClick={() => setExpandedSignalId(expanded ? null : signal.id)}
                        aria-expanded={expanded}
                      >
                        <td>
                          <div className="sf-audit-market-cell">
                            <span className="sf-audit-pair">{signal.symbol}</span>
                            <span className={'sf-audit-direction ' + (isBuy ? 'is-buy' : 'is-sell')}>
                              {isBuy ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                              {isBuy ? 'CALL' : 'PUT'}
                            </span>
                          </div>
                          <span className="sf-audit-subcell">
                            {signal.entryTimeframeMinutes || signal.expiryMinutes}m horizon
                          </span>
                        </td>
                        <td>
                          <span className="sf-audit-primary-cell">{formatIST(signal.predictionTimeUtc)}</span>
                          <span className="sf-audit-subcell">Prediction time</span>
                        </td>
                        <td>
                          <span className="sf-audit-primary-cell">
                            {formatPrice(signal.actualEntryPrice, signal.symbol)}
                          </span>
                          <span className="sf-audit-subcell">
                            {signal.actualEntryPrice !== null && signal.actualEntryPrice !== undefined
                              ? 'Observed paper price'
                              : 'Awaiting entry'}
                          </span>
                        </td>
                        <td>
                          <span className="sf-audit-primary-cell">{formatIST(exitAt)}</span>
                          <span className="sf-audit-subcell">
                            {signal.actualExitPrice !== null && signal.actualExitPrice !== undefined
                              ? 'Close ' + formatPrice(signal.actualExitPrice, signal.symbol)
                              : 'Scheduled expiry'}
                          </span>
                        </td>
                        <td>
                          <span className={'sf-audit-status is-' + status.tone}>{status.label}</span>
                          {bucket === 'UNSCORED' && (
                            <span className="sf-audit-subcell">
                              {signal.actualEntryPrice !== null && signal.actualEntryPrice !== undefined
                                ? 'No verified expiry result'
                                : 'No entry was recorded'}
                            </span>
                          )}
                        </td>
                        <td className="text-right">
                          <span className={'sf-audit-return' + (settled && (signal.netReturnUnits ?? 0) > 0 ? ' is-positive' : settled && (signal.netReturnUnits ?? 0) < 0 ? ' is-negative' : '')}>
                            {settled ? formatUnits(signal.netReturnUnits) : '—'}
                          </span>
                          <span className="sf-audit-expand">{expanded ? 'Hide details' : 'Audit details'} <ChevronDown className={'h-3 w-3' + (expanded ? ' rotate-180' : '')} /></span>
                        </td>
                      </tr>

                      {expanded && (
                        <tr className="sf-audit-detail-row">
                          <td colSpan={6}>
                            <div className="sf-audit-detail-grid">
                              <div><span>Signal ID</span><strong>{signal.id}</strong></div>
                              <div><span>Decision recorded</span><strong>{formatIST(signal.predictionTimeUtc, true)}</strong></div>
                              <div><span>Entry timestamp</span><strong>{formatIST(signal.actualEntryTimeUtc || signal.candleOpenTimeUtc, true)}</strong></div>
                              <div><span>Entry source</span><strong>{signal.entrySource || 'Not recorded'}</strong></div>
                              <div><span>Expiry price</span><strong>{formatPrice(signal.actualExitPrice, signal.symbol)}</strong></div>
                              <div><span>Recorded payout</span><strong>{signal.payoutPct === undefined ? 'Not recorded' : signal.payoutPct + '% · ' + (signal.payoutSource === 'BROKER_OBSERVED' ? 'observed' : 'assumed')}</strong></div>
                              <div><span>Outcome evidence</span><strong>{settled ? 'Exact candle-based settlement' : bucket === 'PENDING' ? 'Awaiting lifecycle reconciliation' : 'No decisive outcome recorded'}</strong></div>
                              <div><span>Model score</span><strong>{Number.isFinite(signal.confidence) ? (signal.confidence * 100).toFixed(0) + '% · activation score, not probability' : 'Not recorded'}</strong></div>
                            </div>
                            {lastEvent && (
                              <div className="sf-audit-last-event">
                                <span>Latest audit event · {formatIST(lastEvent.timestamp, true)}</span>
                                <p>{lastEvent.reason}</p>
                              </div>
                            )}
                            {signal.lifecycleHistory?.length > 1 && (
                              <details className="sf-audit-history">
                                <summary>View lifecycle history ({signal.lifecycleHistory.length} events)</summary>
                                <ol>
                                  {[...signal.lifecycleHistory].reverse().map((event, index) => (
                                    <li key={event.timestamp + '-' + index}>
                                      <strong>{event.fromState} → {event.toState}</strong>
                                      <time>{formatIST(event.timestamp, true)}</time>
                                      <p>{event.reason}</p>
                                    </li>
                                  ))}
                                </ol>
                              </details>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="sf-audit-footnote">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <p>
          Paper research only — this screen does not show broker executions or real account P&amp;L.
          A WIN or LOSS is counted only when the exact expiry candle is verified. Missing market data stays unscored.
        </p>
      </footer>
    </div>
  );
};
