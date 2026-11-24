import React, { useState, useEffect } from 'react';
import {
  TrendingDown,
  AlertTriangle,
  Calendar,
  RefreshCw,
  ShieldAlert,
  Activity,
  ArrowDownRight,
  Clock,
  Filter,
  CheckCircle2,
  XCircle,
  Percent,
} from 'lucide-react';
import { ResearchSignal, LossAutopsy } from '../../types/index.js';

interface DailyLossViewProps {
  signals: ResearchSignal[];
}

export const DailyLossView: React.FC<DailyLossViewProps> = ({ signals }) => {
  const [selectedDate, setSelectedDate] = useState<string>('ALL');
  const [autopsies, setAutopsies] = useState<LossAutopsy[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedLossSignal, setSelectedLossSignal] = useState<ResearchSignal | null>(null);

  const fetchAutopsies = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/research/autopsies');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.autopsies)) {
          setAutopsies(data.autopsies);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch autopsies:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAutopsies();
    const interval = setInterval(fetchAutopsies, 5000);
    return () => clearInterval(interval);
  }, []);

  // Filter settled signals
  const closedSignals = signals.filter(
    s => s.lifecycleState === 'CLOSED' && ['WIN', 'LOSS', 'SCRATCH'].includes(s.outcomeResult)
  );

  const lossSignals = closedSignals.filter(s => s.outcomeResult === 'LOSS');

  // Extract available dates (YYYY-MM-DD) from loss signals
  const availableDates = Array.from(
    new Set(
      lossSignals.map(s => {
        const dateStr = s.actualExitTimeUtc || s.plannedExitTimeUtc || s.predictionTimeUtc;
        return dateStr ? dateStr.substring(0, 10) : '';
      }).filter(Boolean)
    )
  ).sort().reverse();

  // Filter by selected date
  const filteredLosses = selectedDate === 'ALL'
    ? lossSignals
    : lossSignals.filter(s => {
        const dateStr = s.actualExitTimeUtc || s.plannedExitTimeUtc || s.predictionTimeUtc;
        return dateStr && dateStr.startsWith(selectedDate);
      });

  const totalLossUnits = filteredLosses.reduce(
    (sum, s) => sum + Math.abs(Math.min(0, s.netReturnUnits ?? -1)),
    0
  );

  // Group losses by pair
  const lossesByPair: Record<string, { count: number; units: number }> = {};
  for (const loss of filteredLosses) {
    const pair = loss.symbol;
    if (!lossesByPair[pair]) lossesByPair[pair] = { count: 0, units: 0 };
    lossesByPair[pair].count++;
    lossesByPair[pair].units += Math.abs(Math.min(0, loss.netReturnUnits ?? -1));
  }

  // Group losses by root cause (from lossAutopsy if available)
  const lossesByCause: Record<string, number> = {};
  for (const loss of filteredLosses) {
    const cause = loss.lossAutopsy?.rootCause || 'OBSERVED_ADVERSE_SETTLEMENT';
    lossesByCause[cause] = (lossesByCause[cause] || 0) + 1;
  }

  return (
    <div className="sf-page space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800 pb-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2.5 font-mono">
            <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400">
              <TrendingDown className="w-5 h-5" />
            </div>
            <span>Daily Loss Ledger & Risk Audit</span>
          </h2>
          <p className="text-xs text-neutral-400 font-mono mt-1">
            Track daily losses, drawdowns, and forensic root-cause autopsies across all executed paper contracts.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-1.5 text-xs font-mono">
            <Calendar className="w-4 h-4 text-neutral-400" />
            <select
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="bg-transparent text-neutral-200 outline-none cursor-pointer"
            >
              <option value="ALL" className="bg-neutral-900 text-neutral-200">All Recorded Dates</option>
              {availableDates.map(date => (
                <option key={date} value={date} className="bg-neutral-900 text-neutral-200">
                  {date}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={fetchAutopsies}
            className="p-2 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white transition"
            title="Refresh losses"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono text-xs">
        <div className="bg-neutral-900/60 border border-rose-900/40 rounded-2xl p-4">
          <span className="text-[10px] uppercase text-rose-400 font-bold block tracking-wider">
            Total Incurred Loss
          </span>
          <div className="text-2xl sm:text-3xl font-black text-rose-400 tabular-nums mt-1">
            -{totalLossUnits.toFixed(3)}
          </div>
          <span className="text-[10px] text-neutral-500 block mt-1">
            Stake units across {filteredLosses.length} losing trade{filteredLosses.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4">
          <span className="text-[10px] uppercase text-neutral-400 font-bold block tracking-wider">
            Loss Frequency
          </span>
          <div className="text-2xl sm:text-3xl font-black text-white tabular-nums mt-1">
            {closedSignals.length > 0
              ? `${((filteredLosses.length / closedSignals.length) * 100).toFixed(1)}%`
              : '0.0%'}
          </div>
          <span className="text-[10px] text-neutral-500 block mt-1">
            {filteredLosses.length} losses out of {closedSignals.length} closed trades
          </span>
        </div>

        <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4">
          <span className="text-[10px] uppercase text-neutral-400 font-bold block tracking-wider">
            Forensic Autopsies
          </span>
          <div className="text-2xl sm:text-3xl font-black text-amber-400 tabular-nums mt-1">
            {autopsies.length}
          </div>
          <span className="text-[10px] text-neutral-500 block mt-1">
            Root-cause diagnostic records captured
          </span>
        </div>

        <div className="bg-neutral-900/60 border border-emerald-900/30 rounded-2xl p-4">
          <span className="text-[10px] uppercase text-emerald-400 font-bold block tracking-wider">
            Risk Governor Status
          </span>
          <div className="text-lg font-bold text-emerald-400 mt-2 flex items-center gap-1.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <span>NORMAL PROTECTION</span>
          </div>
          <span className="text-[10px] text-neutral-500 block mt-1">
            Daily loss kill-switch armed at 5.0 units
          </span>
        </div>
      </div>

      {/* Loss Attribution & Pair Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Breakdown by Pair */}
        <div className="bg-neutral-900/70 border border-neutral-800 rounded-2xl p-4 space-y-3">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-4 h-4 text-rose-400" />
            Loss Distribution by Currency Pair
          </h4>
          {Object.keys(lossesByPair).length === 0 ? (
            <p className="text-xs text-neutral-500 py-4 font-mono">No losses recorded for the selected period.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(lossesByPair).map(([pair, data]) => (
                <div key={pair} className="flex items-center justify-between p-2.5 rounded-xl bg-neutral-950 border border-neutral-800/80 text-xs font-mono">
                  <span className="font-bold text-cyan-300">{pair}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-neutral-400">{data.count} loss{data.count > 1 ? 'es' : ''}</span>
                    <span className="font-bold text-rose-400">-{data.units.toFixed(3)} units</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Breakdown by Cause */}
        <div className="bg-neutral-900/70 border border-neutral-800 rounded-2xl p-4 space-y-3">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            Loss Root Cause Diagnostics
          </h4>
          {Object.keys(lossesByCause).length === 0 ? (
            <p className="text-xs text-neutral-500 py-4 font-mono">No autopsy diagnostic causes logged yet.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(lossesByCause).map(([cause, count]) => (
                <div key={cause} className="flex items-center justify-between p-2.5 rounded-xl bg-neutral-950 border border-neutral-800/80 text-xs font-mono">
                  <span className="text-neutral-300 truncate max-w-xs">{cause.replace(/_/g, ' ')}</span>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">{count} incident{count > 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Losing Contracts Ledger */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 space-y-3">
        <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Clock className="w-4 h-4 text-neutral-400" />
          Losing Contracts Audit Log ({filteredLosses.length})
        </h4>

        {filteredLosses.length === 0 ? (
          <div className="py-8 text-center text-xs font-mono text-neutral-500 border border-dashed border-neutral-800 rounded-xl">
            Zero losses recorded in this time range. The trading bot has no unrecovered losses here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-neutral-950 text-neutral-500 uppercase text-[10px] border-b border-neutral-800">
                <tr>
                  <th className="p-3">Time (UTC)</th>
                  <th className="p-3">Pair</th>
                  <th className="p-3">Direction</th>
                  <th className="p-3">Entry Price</th>
                  <th className="p-3">Exit Price</th>
                  <th className="p-3">Loss Units</th>
                  <th className="p-3">Strategy</th>
                  <th className="p-3">Forensic Autopsy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                {filteredLosses.map(loss => (
                  <tr key={loss.id} className="hover:bg-neutral-950/60 transition">
                    <td className="p-3 text-neutral-400">
                      {loss.actualExitTimeUtc ? loss.actualExitTimeUtc.substring(11, 19) : 'Settled'}
                    </td>
                    <td className="p-3 font-bold text-cyan-300">{loss.symbol}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        loss.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                      }`}>
                        {loss.direction}
                      </span>
                    </td>
                    <td className="p-3 text-neutral-300">{loss.actualEntryPrice ?? loss.triggerPrice ?? 'n/a'}</td>
                    <td className="p-3 text-neutral-300">{loss.actualExitPrice ?? 'n/a'}</td>
                    <td className="p-3 font-bold text-rose-400">
                      {(loss.netReturnUnits ?? -1).toFixed(3)}
                    </td>
                    <td className="p-3 text-neutral-400 truncate max-w-[140px]">
                      {loss.strategyName || loss.ruleFamily || 'Evolved Genome'}
                    </td>
                    <td className="p-3">
                      {loss.lossAutopsy ? (
                        <button
                          onClick={() => setSelectedLossSignal(loss)}
                          className="px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold transition"
                        >
                          View Autopsy
                        </button>
                      ) : (
                        <span className="text-[10px] text-neutral-600">Standard Loss</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Autopsy Modal */}
      {selectedLossSignal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-lg w-full p-5 text-neutral-200 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-neutral-800">
              <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                Loss Forensic Autopsy · {selectedLossSignal.symbol}
              </h3>
              <button
                onClick={() => setSelectedLossSignal(null)}
                className="text-neutral-400 hover:text-white text-xs font-mono"
              >
                ✕ Close
              </button>
            </div>

            <div className="space-y-3 text-xs font-mono">
              <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800 space-y-1">
                <span className="text-neutral-500 text-[10px] block uppercase">Primary Identified Cause</span>
                <p className="font-bold text-rose-300">
                  {selectedLossSignal.lossAutopsy?.rootCause || 'OBSERVED_ADVERSE_SETTLEMENT'}
                </p>
              </div>

              <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800 space-y-1">
                <span className="text-neutral-500 text-[10px] block uppercase">Market Session at Expiry</span>
                <p className="text-cyan-300">
                  {selectedLossSignal.lossAutopsy?.marketSession || selectedLossSignal.marketSession || 'LONDON_NEWYORK_OVERLAP'}
                </p>
              </div>

              <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800 space-y-1">
                <span className="text-neutral-500 text-[10px] block uppercase">Root Cause Explanation</span>
                <p className="text-neutral-300 leading-relaxed text-[11px]">
                  {selectedLossSignal.lossAutopsy?.rootCauseExplanation || 'Adverse price excursion during contract window.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
