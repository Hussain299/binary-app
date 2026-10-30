import React, { useState } from 'react';
import { Lightbulb, Check, ArrowRight, Zap, Target, TrendingUp, Shield } from 'lucide-react';
import { RuleFamily } from '../../types/index.js';

interface StrategyDiscoveryViewProps {
  onGoToSignals?: () => void;
}

export const StrategyDiscoveryView: React.FC<StrategyDiscoveryViewProps> = ({ onGoToSignals }) => {
  const [selectedFamily, setSelectedFamily] = useState<string>('momentum_5');

  const strategies = [
    {
      id: 'momentum_5',
      name: '5-Minute Momentum Breakout',
      rank: 'CANDIDATE · NOT VALIDATED',
      winRate: '—',
      accuracyLabel: 'No verified historical result',
      pairs: 'EUR/USD, GBP/USD, EUR/JPY',
      timeframe: '5-Minute Dynamic Expiry',
      entryRule: 'Alerted 3 minutes in advance. Enters strictly at 5M candle open (:00, :05, :10, :15, etc.).',
      exitRule: 'Closes 5 minutes later at candle close.',
      spreadCost: '1.2-pip research cost assumption; profitability not established',
      description:
        'Candidate hypothesis: a candle closing near its high or low with a relatively strong body may precede continuation. The configured 3-minute alert and exact 5M-open entry schedule remains unchanged; performance still requires testing.',
    },
    {
      id: 'wick_reversal',
      name: '10-Minute Liquidity Wick Reversal',
      rank: 'CANDIDATE · NOT VALIDATED',
      winRate: '—',
      accuracyLabel: 'No verified historical result',
      pairs: 'USD/JPY, AUD/USD, AUD/CAD',
      timeframe: '10-Minute Dynamic Expiry',
      entryRule: 'Alerted 3 minutes in advance. Enters on 5M candle open after liquidity rejection.',
      exitRule: 'Closes 10 minutes later (across 2 full 5-minute candles).',
      spreadCost: '1.2-pip research cost assumption; profitability not established',
      description:
        'Candidate hypothesis: a long rejection wick near a recent high or low may precede a short-term reversal. This needs pair-by-pair historical and forward validation.',
    },
    {
      id: 'mean_reversion_20',
      name: '15-Minute Statistical Mean Reversion',
      rank: 'CANDIDATE · NOT VALIDATED',
      winRate: '—',
      accuracyLabel: 'No verified historical result',
      pairs: 'EUR/GBP, USD/CAD',
      timeframe: '15-Minute Dynamic Expiry',
      entryRule: 'Alerted 3 minutes in advance when price stretches >8 pips from 20-period mean.',
      exitRule: 'Closes 15 minutes later (across 3 full 5-minute candles).',
      spreadCost: '1.2-pip research cost assumption; profitability not established',
      description:
        'Candidate hypothesis: an unusually extended move during a range may revert toward its recent average. The claimed edge and selected expiry must be measured, not assumed.',
    },
    {
      id: 'range_breakout',
      name: '20-to-30 Minute Volatility Breakout',
      rank: 'CANDIDATE · NOT VALIDATED',
      winRate: '—',
      accuracyLabel: 'No verified historical result',
      pairs: 'GBP/USD, EUR/JPY, AUD/CAD',
      timeframe: '20m to 30m Dynamic Expiry',
      entryRule: 'Alerted 3 minutes before candle open when multi-candle consolidation breaks.',
      exitRule: 'Closes 20 or 30 minutes later at the corresponding 5M candle close.',
      spreadCost: '1.2-pip research cost assumption; profitability not established',
      description:
        'Candidate hypothesis: a break beyond a recent multi-candle range may continue. The 20–30 minute expiry remains a configured option; it is not evidence of profitability.',
    },
  ];

  const current = strategies.find(s => s.id === selectedFamily) || strategies[0];

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-neutral-950 p-4 sm:p-6 space-y-6">
      {/* Top Banner with Direct Link to Live Signals */}
      <div className="bg-emerald-950/60 border-2 border-emerald-500/80 rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg sm:text-xl font-black text-white">
              Dynamic Expiry (5m–30m) & 3-Min Advance Signals
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-neutral-300 mt-1 max-w-xl">
            Trades open <strong>ONLY on exact 5-minute candle marks</strong> (:00, :05, :10, :15, :20, etc.) with advance warning alerts 3 minutes prior.
          </p>
        </div>

        {onGoToSignals && (
          <button
            onClick={onGoToSignals}
            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-black rounded-xl text-sm flex items-center gap-2 shadow-lg shadow-emerald-500/25 transition-all"
          >
            <span>View 5M Signals Board</span>
            <ArrowRight className="w-4 h-4 stroke-[3]" />
          </button>
        )}
      </div>

      {/* Title */}
      <div className="pb-3 border-b border-neutral-800">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-amber-400" />
          <span>Strategy Rule Families · Validation Pending</span>
        </h3>
        <p className="text-xs text-neutral-400 mt-1">
          These are candidate rule families, not measured performance results. Import historical candles and validate before promotion.
        </p>
      </div>

      {/* Strategies Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {strategies.map(s => {
          const isSelected = s.id === selectedFamily;
          return (
            <div
              key={s.id}
              onClick={() => setSelectedFamily(s.id)}
              className={`p-4 sm:p-5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                isSelected
                  ? 'bg-neutral-900 border-emerald-500 shadow-xl shadow-emerald-950/40'
                  : 'bg-neutral-900/60 border-neutral-800 hover:border-neutral-700'
              }`}
            >
              <div className="space-y-2.5">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    {s.rank}
                  </span>
                  <span className="text-xl font-black font-mono text-emerald-400">
                    {s.winRate}
                  </span>
                </div>

                <h4 className="font-bold text-white text-base leading-snug">{s.name}</h4>
                <p className="text-neutral-400 text-xs leading-relaxed">{s.description}</p>
              </div>

              <div className="pt-3 mt-3 border-t border-neutral-800 text-xs font-mono space-y-1">
                <div className="flex justify-between text-neutral-400">
                  <span>Pairs:</span>
                  <span className="text-white font-bold">{s.pairs}</span>
                </div>
                <div className="flex justify-between text-neutral-400">
                  <span>Candle Duration:</span>
                  <span className="text-emerald-400 font-bold">5 Minutes</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail Showcase of Selected Strategy */}
      <div className="bg-neutral-900/80 border border-neutral-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-neutral-800">
          <div>
            <h4 className="text-lg font-bold text-white">{current.name}</h4>
            <span className="text-xs text-neutral-400 font-mono">
              Applies to: {current.pairs}
            </span>
          </div>
          <span className="px-3 py-1 rounded-xl bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono font-bold text-sm">
            {current.accuracyLabel}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 space-y-1.5">
            <span className="text-emerald-400 font-bold uppercase text-[11px] block">
              1. EXACT ENTRY RULE:
            </span>
            <p className="text-neutral-200 leading-relaxed font-sans text-xs">
              {current.entryRule}
            </p>
          </div>

          <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 space-y-1.5">
            <span className="text-rose-400 font-bold uppercase text-[11px] block">
              2. EXACT EXPIRY RULE:
            </span>
            <p className="text-neutral-200 leading-relaxed font-sans text-xs">
              {current.exitRule}
            </p>
          </div>
        </div>

        <div className="p-3.5 bg-neutral-950 rounded-xl border border-neutral-800 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 text-neutral-300">
            <Shield className="w-4 h-4 text-emerald-400" />
            <span>Modeled transaction cost:</span>
          </div>
          <span className="text-emerald-400 font-bold">{current.spreadCost}</span>
        </div>

        {onGoToSignals && (
          <button
            onClick={onGoToSignals}
            className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold rounded-xl text-xs sm:text-sm transition-colors text-center"
          >
            Go To Live Signals For This Strategy →
          </button>
        )}
      </div>
    </div>
  );
};
