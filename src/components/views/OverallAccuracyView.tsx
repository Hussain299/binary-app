import React, { useState, useEffect } from 'react';
import {
  Target,
  Percent,
  CheckCircle2,
  XCircle,
  HelpCircle,
  RefreshCw,
  TrendingUp,
  Award,
  Globe,
  Layers,
  BarChart2,
  Filter,
} from 'lucide-react';
import { ResearchSignal, ResearchExperiment, MarketSessionInfo } from '../../types/index.js';

interface OverallAccuracyViewProps {
  signals: ResearchSignal[];
  experiments: ResearchExperiment[];
}

export const OverallAccuracyView: React.FC<OverallAccuracyViewProps> = ({
  signals,
  experiments,
}) => {
  const [sessionData, setSessionData] = useState<MarketSessionInfo[]>([]);
  const [selectedPair, setSelectedPair] = useState<string>('ALL');
  const [selectedSession, setSelectedSession] = useState<string>('ALL');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const fetchSessionAccuracy = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/sessions/accuracy');
      if (res.ok) {
        const data = await res.json();
        if (data?.sessions) setSessionData(data.sessions);
      }
    } catch (e) {
      console.warn('Failed to fetch session accuracy:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSessionAccuracy();
    const interval = setInterval(fetchSessionAccuracy, 5000);
    return () => clearInterval(interval);
  }, []);

  // Filter completed paper signals
  const allCompleted = signals.filter(
    s => s.lifecycleState === 'CLOSED' && ['WIN', 'LOSS', 'SCRATCH'].includes(s.outcomeResult)
  );

  // Apply filters
  const filteredCompleted = allCompleted.filter(s => {
    if (selectedPair !== 'ALL' && s.symbol !== selectedPair) return false;
    if (selectedSession !== 'ALL' && s.marketSession !== selectedSession) return false;
    return true;
  });

  const scoredSignals = filteredCompleted.filter(s => s.outcomeResult === 'WIN' || s.outcomeResult === 'LOSS');
  const totalWins = scoredSignals.filter(s => s.outcomeResult === 'WIN').length;
  const totalLosses = scoredSignals.filter(s => s.outcomeResult === 'LOSS').length;
  const totalScratches = filteredCompleted.filter(s => s.outcomeResult === 'SCRATCH').length;

  // OVERALL ACCURACY CALCULATION
  const overallAccuracy = scoredSignals.length > 0 ? (totalWins / scoredSignals.length) * 100 : null;

  // Net return units
  const totalNetReturn = Number(
    filteredCompleted.reduce((sum, s) => sum + (s.netReturnUnits ?? 0), 0).toFixed(3)
  );

  // Average payout
  const avgPayout = scoredSignals.length > 0
    ? scoredSignals.reduce((sum, s) => sum + (s.payoutPct ?? 80), 0) / scoredSignals.length
    : 80;

  // Institutional Binary Break-Even = 1 / (1 + Payout%)
  const breakEvenRate = (1 / (1 + avgPayout / 100)) * 100;

  // Edge over break-even
  const edgePct = overallAccuracy !== null ? overallAccuracy - breakEvenRate : null;

  // Wilson 95% Lower Bound: p_hat + z^2/(2n) - z*sqrt(...) / (1 + z^2/n)
  const calculateWilsonLower = (wins: number, n: number, z = 1.96) => {
    if (n === 0) return 0;
    const p = wins / n;
    const denominator = 1 + (z * z) / n;
    const center = p + (z * z) / (2 * n);
    const standardError = Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    return Math.max(0, ((center - z * standardError) / denominator) * 100);
  };

  const wilsonLower = scoredSignals.length > 0 ? calculateWilsonLower(totalWins, scoredSignals.length) : null;

  // Breakdown by pair
  const pairsList = Array.from(new Set(signals.map(s => s.symbol))).sort();
  const pairAccuracyStats = pairsList.map(pair => {
    const pairSignals = allCompleted.filter(s => s.symbol === pair);
    const pairScored = pairSignals.filter(s => s.outcomeResult === 'WIN' || s.outcomeResult === 'LOSS');
    const wins = pairScored.filter(s => s.outcomeResult === 'WIN').length;
    const losses = pairScored.filter(s => s.outcomeResult === 'LOSS').length;
    const wr = pairScored.length > 0 ? (wins / pairScored.length) * 100 : null;
    const netReturn = Number(pairSignals.reduce((sum, s) => sum + (s.netReturnUnits ?? 0), 0).toFixed(3));
    return { pair, total: pairSignals.length, scored: pairScored.length, wins, losses, winRate: wr, netReturn };
  });

  return (
    <div className="sf-page space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800 pb-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2.5 font-mono">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Percent className="w-5 h-5" />
            </div>
            <span>Overall Accuracy & Win-Loss Performance</span>
          </h2>
          <p className="text-xs text-neutral-400 font-mono mt-1">
            Empirical, statistical calculation of real accuracy across all forward paper trades, sessions, and tested models.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Pair filter */}
          <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-1.5 text-xs font-mono">
            <Filter className="w-3.5 h-3.5 text-neutral-400" />
            <select
              value={selectedPair}
              onChange={e => setSelectedPair(e.target.value)}
              className="bg-transparent text-neutral-200 outline-none cursor-pointer"
            >
              <option value="ALL" className="bg-neutral-900 text-neutral-200">All Pairs</option>
              {pairsList.map(p => (
                <option key={p} value={p} className="bg-neutral-900 text-neutral-200">{p}</option>
              ))}
            </select>
          </div>

          <button
            onClick={fetchSessionAccuracy}
            className="p-2 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white transition"
            title="Refresh accuracy"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono text-xs">
        {/* Overall Accuracy Card */}
        <div className="bg-gradient-to-br from-[#071d15] to-[#040e0b] border border-emerald-500/40 rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-emerald-300 font-bold tracking-wider">
              Overall Measured Accuracy
            </span>
            <Target className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl sm:text-4xl font-black text-emerald-400 tabular-nums mt-2">
            {overallAccuracy !== null ? `${overallAccuracy.toFixed(1)}%` : 'No Trades Yet'}
          </div>
          <div className="mt-2 text-[10px] text-neutral-300 space-y-0.5">
            <div>{totalWins} Wins / {totalLosses} Losses ({scoredSignals.length} Scored)</div>
            {edgePct !== null && (
              <div className={edgePct >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                {edgePct >= 0 ? `+${edgePct.toFixed(1)}%` : `${edgePct.toFixed(1)}%`} vs {breakEvenRate.toFixed(1)}% Break-even
              </div>
            )}
          </div>
        </div>

        {/* Statistical Wilson Lower Bound */}
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-amber-400 font-bold tracking-wider">
              Wilson 95% Confidence Bound
            </span>
            <Award className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-3xl sm:text-4xl font-black text-amber-300 tabular-nums mt-2">
            {wilsonLower !== null ? `${wilsonLower.toFixed(1)}%` : 'n/a'}
          </div>
          <div className="mt-2 text-[10px] text-neutral-400">
            Conservative lower-bound accuracy penalizing statistical variance (z=1.96).
          </div>
        </div>

        {/* Net Payout Units */}
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-cyan-300 font-bold tracking-wider">
              Cumulative Paper Return
            </span>
            <TrendingUp className="w-4 h-4 text-cyan-400" />
          </div>
          <div className={`text-3xl sm:text-4xl font-black tabular-nums mt-2 ${
            totalNetReturn >= 0 ? 'text-cyan-300' : 'text-rose-400'
          }`}>
            {totalNetReturn > 0 ? `+${totalNetReturn.toFixed(3)}` : totalNetReturn.toFixed(3)}
          </div>
          <div className="mt-2 text-[10px] text-neutral-400">
            Net stake units after 80%+ payout adjustments and zero-lookahead settlement.
          </div>
        </div>

        {/* Total Settled Volume */}
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-neutral-400 font-bold tracking-wider">
              Settled Paper Contracts
            </span>
            <Layers className="w-4 h-4 text-neutral-400" />
          </div>
          <div className="text-3xl sm:text-4xl font-black text-white tabular-nums mt-2">
            {filteredCompleted.length}
          </div>
          <div className="mt-2 text-[10px] text-neutral-400">
            {totalWins} Wins · {totalLosses} Losses · {totalScratches} Scratches
          </div>
        </div>
      </div>

      {/* Session Accuracy Matrix */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Globe className="w-4 h-4 text-emerald-400" />
            Accuracy Breakdown by Global Market Session
          </h4>
          <span className="text-[10px] font-mono text-neutral-500">Live 24/5 Attribution</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {['ASIA', 'LONDON', 'OVERLAP', 'NEW_YORK'].map(sessionId => {
            const sess = sessionData.find(s => s.id === sessionId);
            const sessSignals = allCompleted.filter(s => s.marketSession === sessionId);
            const scored = sessSignals.filter(s => s.outcomeResult === 'WIN' || s.outcomeResult === 'LOSS');
            const wins = scored.filter(s => s.outcomeResult === 'WIN').length;
            const losses = scored.filter(s => s.outcomeResult === 'LOSS').length;
            const wr = scored.length > 0 ? (wins / scored.length) * 100 : null;

            return (
              <div key={sessionId} className="rounded-xl border border-neutral-800 bg-neutral-950 p-3.5 space-y-2 font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white">{sessionId}</span>
                  {sess?.isActive && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[9px] font-bold">
                      ACTIVE NOW
                    </span>
                  )}
                </div>
                <div className="text-2xl font-black text-emerald-400 tabular-nums">
                  {wr !== null ? `${wr.toFixed(1)}%` : 'No Data'}
                </div>
                <div className="text-[10px] text-neutral-400">
                  {wins}W / {losses}L · {sessSignals.length} total
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Currency Pair Accuracy Matrix */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5 space-y-3">
        <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-cyan-400" />
          Pair-by-Pair Accuracy & Expectancy
        </h4>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-neutral-950 text-neutral-500 uppercase text-[10px] border-b border-neutral-800">
              <tr>
                <th className="p-3">Currency Pair</th>
                <th className="p-3 text-center">Settled Trades</th>
                <th className="p-3 text-center">Wins</th>
                <th className="p-3 text-center">Losses</th>
                <th className="p-3 text-center">Accuracy / Win Rate</th>
                <th className="p-3 text-right">Net Return</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/60">
              {pairAccuracyStats.map(stat => (
                <tr key={stat.pair} className="hover:bg-neutral-950/60 transition">
                  <td className="p-3 font-bold text-cyan-300">{stat.pair}</td>
                  <td className="p-3 text-center text-neutral-300">{stat.total}</td>
                  <td className="p-3 text-center text-emerald-400 font-bold">{stat.wins}</td>
                  <td className="p-3 text-center text-rose-400 font-bold">{stat.losses}</td>
                  <td className="p-3 text-center">
                    {stat.winRate !== null ? (
                      <span className={`px-2 py-0.5 rounded font-bold ${
                        stat.winRate >= breakEvenRate ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                      }`}>
                        {stat.winRate.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-neutral-600">Pending trades</span>
                    )}
                  </td>
                  <td className={`p-3 text-right font-bold ${
                    stat.netReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {stat.netReturn > 0 ? `+${stat.netReturn.toFixed(3)}` : stat.netReturn.toFixed(3)} units
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
