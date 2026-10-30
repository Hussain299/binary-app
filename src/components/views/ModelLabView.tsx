import React, { useState } from 'react';
import {
  Brain,
  ShieldCheck,
  CheckCircle,
  XCircle,
  Play,
  Layers,
  Sparkles,
} from 'lucide-react';
import { FOREX_PAIRS, ForexSymbol, ResearchExperiment, RuleFamily } from '../../types/index.js';

interface ModelLabViewProps {
  experiments: ResearchExperiment[];
  onExperimentComplete: (exp: ResearchExperiment) => void;
}

export const ModelLabView: React.FC<ModelLabViewProps> = ({
  experiments,
  onExperimentComplete,
}) => {
  const [selectedPair, setSelectedPair] = useState<ForexSymbol>('EUR/USD');
  const [selectedRule, setSelectedRule] = useState<RuleFamily>('momentum_5');
  const [selectedHorizon, setSelectedHorizon] = useState<number>(10);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [activeExp, setActiveExp] = useState<ResearchExperiment | null>(
    experiments[0] || null
  );

  const handleRunExperiment = async () => {
    setIsRunning(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: selectedPair,
          ruleFamily: selectedRule,
          horizon: selectedHorizon,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setActiveExp(data.experiment);
        onExperimentComplete(data.experiment);
      }
    } catch (e) {
      console.error('Failed to run experiment:', e);
    } finally {
      setIsRunning(false);
    }
  };

  const exp = activeExp || experiments[0];

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-neutral-950 p-6 space-y-6">
      {/* Configuration Header */}
      <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          <div>
            <label className="text-neutral-500 block text-[10px] uppercase">Forex Asset</label>
            <select
              value={selectedPair}
              onChange={e => setSelectedPair(e.target.value as ForexSymbol)}
              className="bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-white text-xs mt-1"
            >
              {FOREX_PAIRS.map(p => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-neutral-500 block text-[10px] uppercase">Rule Family</label>
            <select
              value={selectedRule}
              onChange={e => setSelectedRule(e.target.value as RuleFamily)}
              className="bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-white text-xs mt-1"
            >
              <option value="momentum_5">Momentum 5</option>
              <option value="mean_reversion_20">Mean Reversion 20</option>
              <option value="wick_reversal">Wick Liquidity Reversal</option>
              <option value="range_breakout">Range Breakout & ATR</option>
            </select>
          </div>

          <div>
            <label className="text-neutral-500 block text-[10px] uppercase">Horizon</label>
            <select
              value={selectedHorizon}
              onChange={e => setSelectedHorizon(Number(e.target.value))}
              className="bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-white text-xs mt-1"
            >
              <option value={5}>5 Candles (5m)</option>
              <option value={10}>10 Candles (10m)</option>
              <option value={15}>15 Candles (15m)</option>
              <option value={20}>20 Candles (20m)</option>
              <option value={30}>30 Candles (30m)</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleRunExperiment}
          disabled={isRunning}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-emerald-950 bg-emerald-400 hover:bg-emerald-300 rounded transition-colors disabled:opacity-50"
        >
          <Play className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
          <span>{isRunning ? 'Validating Purged Split...' : 'Run Purged Walk-Forward'}</span>
        </button>
      </div>

      {exp ? (
        <div className="space-y-6">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-3 text-xs font-mono">
              <span className="text-neutral-500 text-[10px] block">Test Accuracy</span>
              <span className="text-lg font-bold text-white tabular-nums">
                {(exp.metrics.testAccuracy * 100).toFixed(1)}%
              </span>
              <span className="text-[10px] text-neutral-400 block mt-0.5">
                95% CI: [{(exp.metrics.confidenceInterval95[0] * 100).toFixed(0)}%,{' '}
                {(exp.metrics.confidenceInterval95[1] * 100).toFixed(0)}%]
              </span>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-3 text-xs font-mono">
              <span className="text-neutral-500 text-[10px] block">Balanced Acc</span>
              <span className="text-lg font-bold text-emerald-400 tabular-nums">
                {(exp.metrics.balancedAccuracy * 100).toFixed(1)}%
              </span>
              <span className="text-[10px] text-neutral-400 block mt-0.5">Class-balanced</span>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-3 text-xs font-mono">
              <span className="text-neutral-500 text-[10px] block">F1 Score</span>
              <span className="text-lg font-bold text-white tabular-nums">
                {exp.metrics.f1Score.toFixed(3)}
              </span>
              <span className="text-[10px] text-neutral-400 block mt-0.5">
                Prec: {exp.metrics.precision} · Rec: {exp.metrics.recall}
              </span>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-3 text-xs font-mono">
              <span className="text-neutral-500 text-[10px] block">Brier Calibration</span>
              <span className="text-lg font-bold text-white tabular-nums">
                {exp.metrics.brierScore.toFixed(4)}
              </span>
              <span className="text-[10px] text-neutral-400 block mt-0.5">
                {exp.metrics.brierScore < 0.22 ? 'Well-Calibrated' : 'Drift Risk'}
              </span>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-3 text-xs font-mono">
              <span className="text-neutral-500 text-[10px] block">Profit Factor</span>
              <span className="text-lg font-bold text-white tabular-nums">
                {exp.metrics.profitFactor}
              </span>
              <span className="text-[10px] text-neutral-400 block mt-0.5">
                After 1.2 pip spread
              </span>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-3 text-xs font-mono">
              <span className="text-neutral-500 text-[10px] block">Max Drawdown</span>
              <span className="text-lg font-bold text-rose-400 tabular-nums">
                {exp.metrics.maxDrawdownPct}%
              </span>
              <span className="text-[10px] text-neutral-400 block mt-0.5">Peak-to-trough</span>
            </div>
          </div>

          {/* Chronological Walk-Forward Split Visualization */}
          <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4 space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white">
                Chronological Purged Walk-Forward Partitioning
              </h4>
              <span className="text-[11px] text-emerald-400">
                Purged Embargo: {exp.purgedWindowCandles} Candles (Zero Leakage)
              </span>
            </div>

            {/* Visual Timeline Bar */}
            <div className="w-full h-8 bg-neutral-950 rounded flex overflow-hidden border border-neutral-800 text-[10px] font-semibold">
              <div className="w-[60%] bg-blue-950/70 border-r border-blue-800 flex items-center justify-center text-blue-300">
                TRAIN (60%) · {exp.metrics.trainAccuracy * 100}% Acc
              </div>
              <div className="w-[5%] bg-neutral-900 border-r border-neutral-700 flex items-center justify-center text-neutral-500">
                EMBARGO
              </div>
              <div className="w-[17%] bg-amber-950/70 border-r border-amber-800 flex items-center justify-center text-amber-300">
                VAL (20%) · {exp.metrics.valAccuracy * 100}%
              </div>
              <div className="w-[5%] bg-neutral-900 border-r border-neutral-700 flex items-center justify-center text-neutral-500">
                EMBARGO
              </div>
              <div className="w-[13%] bg-emerald-950/70 flex items-center justify-center text-emerald-300">
                TEST (20%) · {exp.metrics.testAccuracy * 100}%
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-neutral-400 pt-2 text-[11px]">
              <div>
                <strong className="text-neutral-300">Scaling Isolation:</strong> Means and standard
                deviations are computed strictly across the 60% train split and applied out-of-sample.
              </div>
              <div>
                <strong className="text-neutral-300">Overfitting Delta:</strong> Train ({exp.metrics.trainAccuracy}) vs
                Validation ({exp.metrics.valAccuracy}) Delta ={' '}
                {((exp.metrics.trainAccuracy - exp.metrics.valAccuracy) * 100).toFixed(1)}%.
              </div>
            </div>
          </div>

          {/* Confusion Matrix & Skeptical Auditor Box */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Confusion Matrix */}
            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4 font-mono text-xs space-y-3">
              <h4 className="text-sm font-semibold text-white">Out-of-Sample Confusion Matrix</h4>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-neutral-950 p-3 rounded border border-neutral-800">
                  <span className="text-[10px] text-neutral-500 block">True Positives (TP)</span>
                  <span className="text-base font-bold text-emerald-400 tabular-nums">
                    {exp.metrics.confusionMatrix.tp}
                  </span>
                </div>
                <div className="bg-neutral-950 p-3 rounded border border-neutral-800">
                  <span className="text-[10px] text-neutral-500 block">False Positives (FP)</span>
                  <span className="text-base font-bold text-rose-400 tabular-nums">
                    {exp.metrics.confusionMatrix.fp}
                  </span>
                </div>
                <div className="bg-neutral-950 p-3 rounded border border-neutral-800">
                  <span className="text-[10px] text-neutral-500 block">False Negatives (FN)</span>
                  <span className="text-base font-bold text-amber-400 tabular-nums">
                    {exp.metrics.confusionMatrix.fn}
                  </span>
                </div>
                <div className="bg-neutral-950 p-3 rounded border border-neutral-800">
                  <span className="text-[10px] text-neutral-500 block">True Negatives (TN)</span>
                  <span className="text-base font-bold text-neutral-300 tabular-nums">
                    {exp.metrics.confusionMatrix.tn}
                  </span>
                </div>
              </div>
            </div>

            {/* Auditor Review Verdict */}
            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4 font-mono text-xs space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-400" />
                  <span>Skeptical Auditor Gate</span>
                </h4>
                <span
                  className={`font-semibold ${
                    exp.auditorVerdict === 'ACCEPTED'
                      ? 'text-emerald-400'
                      : exp.auditorVerdict === 'PROVISIONAL'
                      ? 'text-amber-400'
                      : 'text-rose-400'
                  }`}
                >
                  {exp.auditorVerdict}
                </span>
              </div>

              <div className="bg-neutral-950 p-3 rounded border border-neutral-800 space-y-1.5 text-neutral-300">
                {exp.auditorConcerns.length > 0 ? (
                  exp.auditorConcerns.map((c, i) => (
                    <div key={i} className="flex gap-2 text-rose-300">
                      <span>•</span>
                      <span>{c}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-emerald-400">
                    ✓ Passed all leakage, calibration, and transaction-cost checks. Eligible for
                    candidate consideration.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="h-64 flex flex-col items-center justify-center text-center text-neutral-500 font-mono text-xs">
          <Brain className="w-8 h-8 text-neutral-600 mb-2" />
          <p className="text-neutral-400 font-medium text-sm">No Models Evaluated Yet</p>
          <p className="mt-1">Select an asset and rule family above, then click &quot;Run Purged Walk-Forward&quot;.</p>
        </div>
      )}
    </div>
  );
};
