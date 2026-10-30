import React from 'react';
import { BarChart3, TrendingUp, Activity, AlertTriangle } from 'lucide-react';
import { ResearchExperiment, ResearchSignal } from '../../types/index.js';

interface PerformanceAnalyticsViewProps {
  experiments: ResearchExperiment[];
  signals: ResearchSignal[];
}

export const PerformanceAnalyticsView: React.FC<PerformanceAnalyticsViewProps> = ({
  experiments,
  signals,
}) => {
  const completedSignals = signals.filter(
    signal => signal.lifecycleState === 'CLOSED' &&
      ['WIN', 'LOSS', 'SCRATCH'].includes(signal.outcomeResult)
  );
  const scoredSignals = completedSignals.filter(
    signal => signal.outcomeResult === 'WIN' || signal.outcomeResult === 'LOSS'
  );
  const wins = scoredSignals.filter(signal => signal.outcomeResult === 'WIN').length;
  const losses = scoredSignals.filter(signal => signal.outcomeResult === 'LOSS').length;
  const scratches = completedSignals.filter(signal => signal.outcomeResult === 'SCRATCH').length;
  const winRate = scoredSignals.length > 0 ? (wins / scoredSignals.length) * 100 : null;
  const totalNetPips = completedSignals.reduce((sum, signal) => sum + (signal.netReturnPips || 0), 0);
  const avgNetPips = completedSignals.length > 0 ? totalNetPips / completedSignals.length : null;

  const backtests = experiments
    .filter(experiment => experiment.experimentType !== 'LIVE_TRADE')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const latestBacktest = backtests[0] || null;

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-neutral-950 p-6 space-y-6">
      <div className="pb-4 border-b border-neutral-800">
        <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-emerald-400" />
          <span>Performance Analytics & Evidence</span>
        </h3>
        <p className="text-xs text-neutral-400 font-mono mt-1">
          Completed forward trades and historical out-of-sample experiments are reported separately.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-xs">
        <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
          <span className="text-neutral-500 text-[10px] block uppercase">Live Win Rate</span>
          <span className="text-2xl font-bold text-emerald-400 tabular-nums">
            {winRate === null ? 'No data' : `${winRate.toFixed(1)}%`}
          </span>
          <span className="text-[10px] text-neutral-400 block mt-1">
            {wins}W / {losses}L · n={scoredSignals.length} · {scratches} scratches
          </span>
        </div>

        <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
          <span className="text-neutral-500 text-[10px] block uppercase">Cumulative Live Net Pips</span>
          <span className={`text-2xl font-bold tabular-nums ${totalNetPips >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {completedSignals.length === 0 ? 'No data' : `${totalNetPips >= 0 ? '+' : ''}${totalNetPips.toFixed(1)}`}
          </span>
          <span className="text-[10px] text-neutral-400 block mt-1">
            {avgNetPips === null ? 'No completed outcomes' : `${avgNetPips > 0 ? '+' : ''}${avgNetPips.toFixed(2)} pips per completed trade`}
          </span>
        </div>

        <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
          <span className="text-neutral-500 text-[10px] block uppercase">Historical Experiments</span>
          <span className="text-2xl font-bold text-white tabular-nums">{backtests.length}</span>
          <span className="text-[10px] text-neutral-400 block mt-1">Backtests only · live records excluded</span>
        </div>

        <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
          <span className="text-neutral-500 text-[10px] block uppercase">Latest Untouched Test</span>
          <span className="text-2xl font-bold text-white tabular-nums">
            {latestBacktest ? `${(latestBacktest.metrics.testAccuracy * 100).toFixed(1)}%` : 'No data'}
          </span>
          <span className="text-[10px] text-neutral-400 block mt-1">
            {latestBacktest ? `n=${latestBacktest.metrics.sampleSize} · ${latestBacktest.symbol} · ${latestBacktest.horizonMinutes}m` : 'Import historical candles and run a test'}
          </span>
        </div>
      </div>

      <div className="bg-neutral-900/60 border border-neutral-800 rounded p-5 space-y-3">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          Latest Historical Backtest
        </h4>
        {latestBacktest ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
            <div className="bg-neutral-950 rounded border border-neutral-800 p-3">
              <span className="text-neutral-500 block text-[10px]">Test directional accuracy</span>
              <strong className="text-white text-lg">{(latestBacktest.metrics.testAccuracy * 100).toFixed(1)}%</strong>
              <span className="text-neutral-500 block">n={latestBacktest.metrics.sampleSize}</span>
            </div>
            <div className="bg-neutral-950 rounded border border-neutral-800 p-3">
              <span className="text-neutral-500 block text-[10px]">Net-positive trade rate</span>
              <strong className="text-emerald-300 text-lg">{(latestBacktest.metrics.winRate * 100).toFixed(1)}%</strong>
              <span className="text-neutral-500 block">After modeled spread</span>
            </div>
            <div className="bg-neutral-950 rounded border border-neutral-800 p-3">
              <span className="text-neutral-500 block text-[10px]">Expected value</span>
              <strong className="text-white text-lg">{latestBacktest.metrics.expectedValuePips.toFixed(2)}</strong>
              <span className="text-neutral-500 block">Pips per sample</span>
            </div>
            <div className="bg-neutral-950 rounded border border-neutral-800 p-3">
              <span className="text-neutral-500 block text-[10px]">Profit factor</span>
              <strong className="text-white text-lg">{latestBacktest.metrics.profitFactor.toFixed(2)}</strong>
              <span className="text-neutral-500 block">Spread-adjusted simulation</span>
            </div>
            <div className="col-span-2 md:col-span-4 text-neutral-400">
              {latestBacktest.name} · Test period: {latestBacktest.testPeriod.start} – {latestBacktest.testPeriod.end}
              <br />
              95% confidence interval: {(latestBacktest.metrics.confidenceInterval95[0] * 100).toFixed(1)}%–{(latestBacktest.metrics.confidenceInterval95[1] * 100).toFixed(1)}%.
            </div>
          </div>
        ) : (
          <p className="text-xs text-neutral-400">No historical experiment has completed yet. Synthetic fallback data is not eligible for research results.</p>
        )}
      </div>

      <div className="bg-amber-950/20 border border-amber-900/50 rounded-lg p-4 flex gap-3 text-xs text-neutral-300">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <strong className="text-amber-300">Cost-model limitation:</strong> Historical results use configured spread assumptions, not tick-by-tick broker bid/ask quotes, variable slippage or commission. They are research estimates, not guaranteed execution results. Always compare them with the forward outcome ledger.
        </div>
      </div>

      <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4 text-xs text-neutral-400">
        <div className="flex items-center gap-2 text-neutral-300 font-semibold mb-1">
          <Activity className="w-4 h-4 text-cyan-400" />
          Evidence policy
        </div>
        Live win rate excludes scratches from the win/loss denominator but includes their net pips in cumulative PnL. Every rate is displayed with its sample count. A single winning trade is never treated as proof that a strategy is validated.
      </div>
    </div>
  );
};
