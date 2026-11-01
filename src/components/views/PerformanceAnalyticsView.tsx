import React from 'react';
import { BarChart3, TrendingUp, Activity, AlertTriangle } from 'lucide-react';
import { ResearchExperiment, ResearchSignal } from '../../types/index.js';

interface PerformanceAnalyticsViewProps {
  experiments: ResearchExperiment[];
  signals: ResearchSignal[];
}

export const PerformanceAnalyticsView: React.FC<PerformanceAnalyticsViewProps> = ({ experiments, signals }) => {
  const completed = signals.filter(signal =>
    signal.lifecycleState === 'CLOSED' &&
    ['WIN', 'LOSS', 'SCRATCH'].includes(signal.outcomeResult)
  );
  const scored = completed.filter(signal =>
    signal.outcomeResult === 'WIN' || signal.outcomeResult === 'LOSS'
  );
  const wins = scored.filter(signal => signal.outcomeResult === 'WIN').length;
  const losses = scored.length - wins;
  const scratches = completed.length - scored.length;
  const winRate = scored.length ? wins / scored.length : null;
  const netReturnUnits = completed.reduce((sum, signal) => sum + (signal.netReturnUnits ?? 0), 0);
  const avgReturnUnits = completed.length ? netReturnUnits / completed.length : null;
  const archivedExperiments = experiments
    .filter(item => item.experimentType !== 'LIVE_TRADE' && item.experimentType !== 'FORWARD_OBSERVATION')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const latestArchived = archivedExperiments[0] || null;

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-neutral-950 p-6 space-y-6">
      <div className="pb-4 border-b border-neutral-800">
        <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-emerald-400" />
          <span>Performance Analytics & Evidence</span>
        </h3>
        <p className="text-xs text-neutral-400 font-mono mt-1">
          Forward-paper outcomes use payout-adjusted binary contract returns. Historical exploratory tests are archived separately and are not current approval evidence.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-xs">
        <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
          <span className="text-neutral-500 text-[10px] block uppercase">Forward Paper Win Rate</span>
          <span className="text-2xl font-bold text-emerald-400 tabular-nums">
            {winRate === null ? 'No data' : `${(winRate * 100).toFixed(1)}%`}
          </span>
          <span className="text-[10px] text-neutral-400 block mt-1">
            {wins}W / {losses}L · scored n={scored.length} · {scratches} scratches
          </span>
        </div>

        <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
          <span className="text-neutral-500 text-[10px] block uppercase">Forward Net Return</span>
          <span className={`text-2xl font-bold tabular-nums ${netReturnUnits >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {completed.length === 0 ? 'No data' : `${netReturnUnits > 0 ? '+' : ''}${netReturnUnits.toFixed(3)}`}
          </span>
          <span className="text-[10px] text-neutral-400 block mt-1">
            {avgReturnUnits === null ? 'No completed outcomes' : `${avgReturnUnits > 0 ? '+' : ''}${avgReturnUnits.toFixed(4)} stake units per completed contract`}
          </span>
        </div>

        <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
          <span className="text-neutral-500 text-[10px] block uppercase">Settled Paper Contracts</span>
          <span className="text-2xl font-bold text-white tabular-nums">{completed.length}</span>
          <span className="text-[10px] text-neutral-400 block mt-1">Includes wins, losses and scratches</span>
        </div>

        <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
          <span className="text-neutral-500 text-[10px] block uppercase">Archived Research Runs</span>
          <span className="text-2xl font-bold text-white tabular-nums">{archivedExperiments.length}</span>
          <span className="text-[10px] text-neutral-400 block mt-1">Legacy exploratory records; not approval evidence</span>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 space-y-3">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          Forward Paper Ledger
        </h4>
        {completed.length ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
            <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
              <span className="text-neutral-500 block text-[10px]">Wins</span>
              <strong className="text-emerald-300 text-lg">{wins}</strong>
            </div>
            <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
              <span className="text-neutral-500 block text-[10px]">Losses</span>
              <strong className="text-rose-300 text-lg">{losses}</strong>
            </div>
            <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
              <span className="text-neutral-500 block text-[10px]">Scratches</span>
              <strong className="text-neutral-200 text-lg">{scratches}</strong>
            </div>
            <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
              <span className="text-neutral-500 block text-[10px]">Net return</span>
              <strong className={`text-lg ${netReturnUnits >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{netReturnUnits > 0 ? '+' : ''}{netReturnUnits.toFixed(3)} units</strong>
            </div>
            <div className="col-span-2 md:col-span-4 text-neutral-400">
              Win rate uses decisive WIN/LOSS outcomes only. Scratches are excluded from that denominator; each contract's net payout is included in cumulative return. These are candle-based paper observations, not broker fills.
            </div>
          </div>
        ) : (
          <p className="text-xs text-neutral-400">No completed forward-paper contracts have been recorded yet. No performance rate is inferred from unclosed predictions.</p>
        )}
      </div>

      <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-4 flex gap-3 text-xs text-neutral-300">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <strong className="text-amber-300">Legacy historical results:</strong> previously saved single-rule experiments may have inspected overlapping test windows. Their old win rates and accuracy values are intentionally not presented as evidence for current strategy approval.
          {latestArchived && (
            <div className="mt-2 text-neutral-400">
              Most recent archived record: {latestArchived.name} · {latestArchived.symbol} · {latestArchived.horizonMinutes}m · {latestArchived.testPeriod.start} – {latestArchived.testPeriod.end}.
            </div>
          )}
        </div>
      </div>

      <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4 text-xs text-neutral-400">
        <div className="flex items-center gap-2 text-neutral-300 font-semibold mb-1">
          <Activity className="w-4 h-4 text-cyan-400" />
          Evidence policy
        </div>
        No sample is called validated because of a high percentage alone. Current candidates need a preselected, non-reused historical test and independent forward-paper evidence. A paper candle price is not an executable broker fill, and no return target is guaranteed.
      </div>
    </div>
  );
};
