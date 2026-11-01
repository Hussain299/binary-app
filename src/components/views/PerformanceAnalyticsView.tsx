import React, { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, Activity, AlertTriangle, Clock3 } from 'lucide-react';
import { MarketSessionInfo, ResearchExperiment, ResearchSignal } from '../../types/index.js';

interface PerformanceAnalyticsViewProps {
  experiments: ResearchExperiment[];
  signals: ResearchSignal[];
}

export const PerformanceAnalyticsView: React.FC<PerformanceAnalyticsViewProps> = ({ experiments, signals }) => {
  const [sessionBreakdown, setSessionBreakdown] = useState<MarketSessionInfo[]>([]);
  const [sessionUpdatedAt, setSessionUpdatedAt] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const loadSessions = async () => {
      try {
        const response = await fetch('/api/sessions/accuracy');
        if (!response.ok) throw new Error('Session report unavailable (HTTP ' + response.status + ').');
        const payload = await response.json();
        if (!disposed && Array.isArray(payload.sessions)) {
          setSessionBreakdown(payload.sessions);
          setSessionUpdatedAt(new Date().toISOString());
          setSessionError(null);
        }
      } catch (error: any) {
        if (!disposed) setSessionError(error?.message || 'Session report unavailable.');
      }
    };
    void loadSessions();
    const timer = setInterval(loadSessions, 30_000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  const allCompleted = signals.filter(signal =>
    signal.lifecycleState === 'CLOSED' &&
    ['WIN', 'LOSS', 'SCRATCH'].includes(signal.outcomeResult)
  );
  const completed = allCompleted.filter(signal =>
    signal.isNovelAiSynthesized === true && !!signal.synthesizedGeneId
  );
  const archivedRuleBasedCount = allCompleted.length - completed.length;
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
    <div className="sf-page">
      <div className="pb-4 border-b border-neutral-800">
        <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-emerald-400" />
          <span>Paper performance</span>
        </h3>
        <p className="text-xs text-neutral-400 font-mono mt-1">
          Settled evolved-strategy paper outcomes only. Paper prices are not broker fills.
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

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <Clock3 className="w-4 h-4 text-cyan-300" />
              Session-wise forward accuracy
            </h4>
            <p className="mt-1 text-[10px] text-neutral-500">
              All settled, valid paper observations attributed by actual entry time · DST-aware · IST session hours
            </p>
          </div>
          <span className="text-[9px] text-neutral-500">
            {sessionUpdatedAt ? 'Updated ' + new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date(sessionUpdatedAt)) + ' IST' : 'Loading session ledger…'}
          </span>
        </div>
        {sessionError && (
          <div role="status" className="rounded-lg border border-amber-500/20 bg-amber-500/[.05] p-3 text-[10px] text-amber-200">
            {sessionError}
          </div>
        )}
        {sessionBreakdown.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {sessionBreakdown.map(session => {
              const scoredTrades = session.wins + session.losses;
              return (
                <article key={session.id} className={'min-w-0 rounded-xl border p-3 ' + (session.isActive ? 'border-emerald-400/25 bg-emerald-400/[.045]' : 'border-white/[.07] bg-[#090f16]/70')}>
                  <div className="flex min-h-8 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-semibold text-neutral-100">{session.shortName}</div>
                      <div className="mt-1 text-[8px] text-neutral-500">{session.istRange}</div>
                    </div>
                    {session.isActive && <span className="shrink-0 rounded-full border border-emerald-400/20 bg-emerald-400/[.07] px-2 py-0.5 text-[8px] font-bold text-emerald-200">LIVE</span>}
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-2">
                    <strong className="text-2xl font-semibold tracking-tight tabular-nums text-white">
                      {session.hasMeasuredData ? session.winRate.toFixed(1) + '%' : '—'}
                    </strong>
                    <span className={'text-[10px] font-mono font-semibold tabular-nums ' + (session.netReturnUnits > 0 ? 'text-emerald-300' : session.netReturnUnits < 0 ? 'text-rose-300' : 'text-neutral-400')}>
                      {session.totalTrades ? (session.netReturnUnits > 0 ? '+' : '') + session.netReturnUnits.toFixed(2) + 'u' : 'No return'}
                    </span>
                  </div>
                  <div className="mt-2 text-[9px] text-neutral-400">
                    <span className="text-emerald-300">{session.wins}W</span>
                    <span className="mx-1 text-neutral-600">/</span>
                    <span className="text-rose-300">{session.losses}L</span>
                    <span className="mx-1 text-neutral-600">/</span>
                    <span>{session.scratches}P</span>
                  </div>
                  <div className="mt-1 text-[8px] text-neutral-600">
                    {scoredTrades} decisive · {session.totalTrades} settled total
                  </div>
                  <div className="mt-3 border-t border-white/[.06] pt-2 text-[8px] leading-relaxed text-neutral-500">
                    {session.bestStrategy}
                  </div>
                </article>
              );
            })}
          </div>
        ) : !sessionError ? (
          <div className="rounded-lg border border-white/[.06] bg-black/10 p-5 text-center text-[10px] text-neutral-500">
            Waiting for session data from the paper ledger.
          </div>
        ) : null}
        <p className="text-[9px] leading-relaxed text-neutral-600">
          Win rate = WIN ÷ (WIN + LOSS). Pushes are excluded. No-data sessions display a dash, not 0%. Small samples are descriptive only, not proof of an edge.
        </p>
      </section>

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
          <p className="text-xs text-neutral-400">No completed evolved-genome forward-paper contracts have been recorded yet. No performance rate is inferred from unclosed predictions.</p>
        )}
      </div>

      <p className="text-[10px] text-neutral-500">
        Archived legacy rule-based paper outcomes excluded from the metrics above: {archivedRuleBasedCount}.
      </p>

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
