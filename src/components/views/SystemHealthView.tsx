import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  Activity,
  Database,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RotateCw,
} from 'lucide-react';
import { SystemHealthState } from '../../types/index.js';

export const SystemHealthView: React.FC = () => {
  const [health, setHealth] = useState<SystemHealthState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchHealth = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/system/health');
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      }
    } catch (e) {
      console.error('Failed to fetch system health:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const scheduler = health?.scheduler;
  const schedulerLabel = !scheduler
    ? 'TELEMETRY PENDING'
    : !scheduler.schedulerStarted
      ? 'STOPPED'
      : !scheduler.lastHeartbeatAt
        ? 'STARTING'
        : scheduler.pulseHealthy
          ? 'HEALTHY'
          : 'STALE';
  const schedulerColor = schedulerLabel === 'HEALTHY'
    ? 'text-emerald-400'
    : schedulerLabel === 'STARTING'
      ? 'text-amber-400'
      : 'text-rose-400';
  const strategyDiagnostics = health?.strategyReadiness?.eligibilityDiagnostics;
  const leadingHistoricalBlockers = Object.entries(strategyDiagnostics?.historicalFailureCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const leadingForwardBlockers = Object.entries(strategyDiagnostics?.forwardFailureCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <div className="sf-page">
      <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
        <div>
          <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-emerald-400" />
            <span>Data health</span>
          </h3>
          <p className="text-xs text-neutral-400 font-mono mt-1">
            Provider observations, storage and scheduled research status.
          </p>
        </div>

        <button
          onClick={fetchHealth}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white rounded transition-colors"
        >
          <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {health ? (
        <div className="space-y-6 font-mono text-xs">
          {/* Runtime state is sourced from the real scheduler, not the unrelated cron ledger. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
              <span className="text-neutral-500 text-[10px] uppercase block">Process Uptime</span>
              <span className="text-xl font-bold text-white tabular-nums">
                {Math.floor(health.uptimeSeconds / 60)}m {health.uptimeSeconds % 60}s
              </span>
              <span className="text-[10px] text-neutral-400 block mt-1">Node process only; not proof of 24/5 host uptime</span>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
              <span className="text-neutral-500 text-[10px] uppercase block">Database Storage</span>
              <span className="text-xl font-bold text-white truncate block">
                {health.dbType}
              </span>
              <span className="text-[10px] text-neutral-400 block mt-1 tabular-nums">
                {health.totalCandlesStored.toLocaleString()} rolling candles cached
              </span>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
              <span className="text-neutral-500 text-[10px] uppercase block">Market Scheduler</span>
              <span className={`text-xl font-bold ${schedulerColor}`}>
                {schedulerLabel}
              </span>
              <span className="text-[10px] text-neutral-400 block mt-1">
                {scheduler?.pulseIntervalSeconds ?? '—'}s cooldown · heartbeat {scheduler?.lastPulseAgeSeconds === null || scheduler?.lastPulseAgeSeconds === undefined ? 'not received' : `${scheduler.lastPulseAgeSeconds}s ago`}
              </span>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
              <span className="text-neutral-500 text-[10px] uppercase block">Active Paper Signals</span>
              <span className="text-xl font-bold text-white tabular-nums">
                {health.activeSignalsCount}
              </span>
              <span className="text-[10px] text-neutral-400 block mt-1">
                {health.totalForwardObservations || 0} settled observations · {health.totalExperimentsRun} research runs
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
              <span className="text-neutral-500 text-[10px] uppercase block">Fresh market feeds</span>
              <span className="text-2xl font-bold text-white tabular-nums">
                {scheduler ? `${scheduler.freshPairs}/${scheduler.pairsScanned}` : '—'}
              </span>
              <span className="text-[10px] text-neutral-400 block mt-1">Pairs with a recent trusted M1 candle</span>
            </div>
            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
              <span className="text-neutral-500 text-[10px] uppercase block">Qualified strategies</span>
              <span className="text-2xl font-bold text-white tabular-nums">
                {health.strategyReadiness?.historicallyQualified ?? scheduler?.paperStrategiesEligible ?? '—'}
              </span>
              <span className="text-[10px] text-neutral-400 block mt-1">
                {health.strategyReadiness?.storedCandidates ?? scheduler?.storedStrategyCandidates ?? 0} stored candidates
              </span>
            </div>
            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
              <span className="text-neutral-500 text-[10px] uppercase block">Evolution research</span>
              <span className="text-base font-bold text-white">
                {health.evolutionResearch?.status ?? 'UNKNOWN'}
              </span>
              <span className="text-[10px] text-neutral-400 block mt-1">
                {health.evolutionResearch?.message ?? 'Research state unavailable'}
              </span>
            </div>
          </div>

          {strategyDiagnostics && (
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-white">Why the strategy pool is or isn't producing signals</h4>
                <span className={strategyDiagnostics.eligibleForPaperSignals > 0 ? 'text-emerald-300' : 'text-amber-300'}>
                  {strategyDiagnostics.eligibleForPaperSignals} eligible for paper signals
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[10px]">
                {[
                  ['Stored', strategyDiagnostics.storedCandidates],
                  ['Paper candidates', strategyDiagnostics.paperTradingCandidates],
                  ['Promoted', strategyDiagnostics.promotedCandidates],
                  ['Experimenting', strategyDiagnostics.experimentingCandidates],
                  ['Rejected', strategyDiagnostics.rejectedCandidates],
                  ['Mutating', strategyDiagnostics.mutatingCandidates],
                ].map(([label, value]) => (
                  <div key={label} className="rounded bg-neutral-950 border border-neutral-800 p-2">
                    <span className="block text-neutral-500">{label}</span>
                    <strong className="mt-1 block text-base text-neutral-100 tabular-nums">{value}</strong>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded bg-neutral-950 border border-neutral-800 p-3">
                  <strong className="text-[10px] text-neutral-300 uppercase">Historical approval blockers</strong>
                  {leadingHistoricalBlockers.length ? (
                    <div className="mt-2 space-y-1.5">
                      {leadingHistoricalBlockers.map(([reason, count]) => (
                        <div key={reason} className="flex justify-between gap-3 text-[10px]">
                          <span className="text-neutral-400">{reason.replace(/_/g, ' ')}</span>
                          <strong className="text-amber-300 tabular-nums">{count}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] text-neutral-500">No historical blockers recorded for paper/promoted candidates.</p>
                  )}
                </div>
                <div className="rounded bg-neutral-950 border border-neutral-800 p-3">
                  <strong className="text-[10px] text-neutral-300 uppercase">Forward promotion blockers</strong>
                  {leadingForwardBlockers.length ? (
                    <div className="mt-2 space-y-1.5">
                      {leadingForwardBlockers.map(([reason, count]) => (
                        <div key={reason} className="flex justify-between gap-3 text-[10px]">
                          <span className="text-neutral-400">{reason.replace(/_/g, ' ')}</span>
                          <strong className="text-amber-300 tabular-nums">{count}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] text-neutral-500">No forward-promotion blockers recorded.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {health.hosting?.warning && (
            <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-4 text-xs text-amber-100">
              <strong className="block text-amber-300 mb-1">Hosting requirement</strong>
              {health.hosting.warning}
            </div>
          )}
          {health.storage?.warning && (
            <div className="rounded-lg border border-rose-900/50 bg-rose-950/20 p-4 text-xs text-rose-100">
              <strong className="block text-rose-300 mb-1">Persistence warning</strong>
              {health.storage.warning}
            </div>
          )}

          {scheduler && (
            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-white">Signal production diagnostics</h4>
                <span className={`font-semibold ${schedulerColor}`}>{schedulerLabel}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
                <div className="rounded bg-neutral-950 border border-neutral-800 p-3">
                  <span className="text-neutral-500 block">Last completed pulse</span>
                  <strong className="text-neutral-200">{scheduler.lastHeartbeatAt ? new Date(scheduler.lastHeartbeatAt).toLocaleString() : 'No completed pulse yet'}</strong>
                </div>
                <div className="rounded bg-neutral-950 border border-neutral-800 p-3">
                  <span className="text-neutral-500 block">Last skip reason</span>
                  <strong className="text-neutral-200">{scheduler.lastPulseSkippedReason || 'None'}</strong>
                </div>
                <div className="rounded bg-neutral-950 border border-neutral-800 p-3">
                  <span className="text-neutral-500 block">Last pulse error</span>
                  <strong className={scheduler.lastPulseError ? 'text-rose-300' : 'text-neutral-200'}>{scheduler.lastPulseError || 'None'}</strong>
                </div>
              </div>

              {health.strategyReadiness?.status === 'NO_HISTORICALLY_QUALIFIED_STRATEGY' && (
                <div className="rounded bg-amber-950/20 border border-amber-900/50 p-3 text-[11px] text-amber-100">
                  No strategy has passed the historical approval gate. The bot is scanning, but it will not invent an unvalidated trade signal. Research status: {health.strategyReadiness.researchStatus}. {health.strategyReadiness.researchMessage}
                </div>
              )}

              <div className="overflow-x-auto border border-neutral-800 rounded">
                <table className="w-full text-left min-w-[1240px]">
                  <thead className="bg-neutral-950 text-neutral-400 uppercase text-[10px]">
                    <tr>
                      <th className="px-3 py-2">Pair</th>
                      <th className="px-3 py-2">Feed</th>
                      <th className="px-3 py-2">Age</th>
                      <th className="px-3 py-2">Candles</th>
                      <th className="px-3 py-2">Eligible TF</th>
                      <th className="px-3 py-2">Pair-fit</th>
                      <th className="px-3 py-2">Evaluated</th>
                      <th className="px-3 py-2">Regime veto</th>
                      <th className="px-3 py-2">Trigger</th>
                      <th className="px-3 py-2">Memory veto</th>
                      <th className="px-3 py-2">Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {scheduler.pairDiagnostics.map((pair) => (
                      <tr key={pair.symbol}>
                        <td className="px-3 py-2 text-neutral-200">{pair.symbol}</td>
                        <td className="px-3 py-2 text-neutral-400">{pair.source}</td>
                        <td className="px-3 py-2 text-neutral-400">{pair.ageSeconds === null ? '—' : `${pair.ageSeconds}s`}</td>
                        <td className="px-3 py-2 text-neutral-400">{pair.candleCount}</td>
                        <td className="px-3 py-2 text-neutral-400">{pair.eligibleTimeframes.length ? pair.eligibleTimeframes.join(', ') + 'm' : '—'}</td>
                        <td className="px-3 py-2 text-neutral-400" title="Session-compatible / timeframe-compatible">
                          {pair.sessionCompatibleStrategyCount ?? 0}/{pair.timeframeCompatibleStrategyCount ?? 0}
                        </td>
                        <td className="px-3 py-2 text-neutral-400">{pair.strategiesEvaluated ?? 0}</td>
                        <td className="px-3 py-2 text-amber-300">{pair.regimeRejected ?? 0}</td>
                        <td className="px-3 py-2 text-emerald-300">{pair.activationPassed ?? 0}</td>
                        <td className="px-3 py-2 text-rose-300">{pair.memoryVetoes ?? 0}</td>
                        <td className="px-3 py-2 text-amber-300">
                          <span>{pair.result}</span>
                          {pair.signalCreationError && <span className="block max-w-[260px] whitespace-normal text-rose-300">{pair.signalCreationError}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Data Providers Health Matrix */}
          <div className="bg-neutral-900/60 border border-neutral-800 rounded p-5 space-y-3">
            <h4 className="text-sm font-semibold text-white">Public Feed Auditing & Fallback Matrix</h4>
            <div className="border border-neutral-800 rounded overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-neutral-950 border-b border-neutral-800 text-neutral-400 uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-4">Provider Feed</th>
                    <th className="py-2.5 px-4">Symbol</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Latency</th>
                    <th className="py-2.5 px-4">Last Success</th>
                    <th className="py-2.5 px-4">Failure Attribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-850 bg-neutral-950/60">
                  {health.providers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-neutral-500">
                        Providers initializing with market warmups...
                      </td>
                    </tr>
                  ) : (
                    health.providers.map((p, i) => (
                      <tr key={i} className="hover:bg-neutral-900/50">
                        <td className="py-2.5 px-4 text-white font-semibold uppercase">{p.provider}</td>
                        <td className="py-2.5 px-4 text-neutral-300">{p.symbol}</td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`font-semibold ${
                              p.status === 'ONLINE'
                                ? 'text-emerald-400'
                                : p.status === 'DEGRADED'
                                ? 'text-amber-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right text-neutral-300 tabular-nums">
                          {p.latencyMs}ms
                        </td>
                        <td className="py-2.5 px-4 text-neutral-400">
                          {p.lastSuccess.includes('T') ? p.lastSuccess.substring(11, 19) + ' UTC' : p.lastSuccess}
                        </td>
                        <td className="py-2.5 px-4 text-neutral-400 text-[11px]">
                          {p.errorMessage ? (
                            <span className="text-rose-400">{p.errorMessage}</span>
                          ) : (
                            p.attribution
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="h-64 flex items-center justify-center text-neutral-500 font-mono text-xs">
          Loading system telemetry...
        </div>
      )}
    </div>
  );
};
