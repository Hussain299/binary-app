import React, { useEffect, useMemo, useState } from 'react';
import { Lightbulb, ArrowRight, Dna, RefreshCw, ShieldCheck } from 'lucide-react';
import { StrategyPerformanceRecord, SynthesizedStrategyGene } from '../../types/index.js';

type StrategyWithForward = SynthesizedStrategyGene & {
  forwardPerformance?: StrategyPerformanceRecord | null;
};

interface StrategyDiscoveryViewProps {
  onGoToSignals?: () => void;
}

const statusLabel = (gene: StrategyWithForward): string => {
  if (gene.status === 'PROMOTED_ACTIVE') return 'FORWARD PAPER GATE PASSED';
  if (gene.status === 'PAPER_TRADING') return 'PAPER TRADING';
  if (gene.status === 'REJECTED') return 'REJECTED';
  if (gene.accuracyStatus === 'BACKTESTED') return 'HISTORICALLY TESTED';
  return 'UNVALIDATED';
};

export const StrategyDiscoveryView: React.FC<StrategyDiscoveryViewProps> = ({ onGoToSignals }) => {
  const [strategies, setStrategies] = useState<StrategyWithForward[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/strategies/synthesized');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Strategy candidates could not be loaded.');
      const candidates = Array.isArray(data.strategies) ? data.strategies as StrategyWithForward[] : [];
      setStrategies(candidates);
      setSelectedId(current => candidates.some(gene => gene.id === current) ? current : (candidates[0]?.id || ''));
    } catch (cause: any) {
      setError(cause?.message || 'Strategy candidates could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const ranked = useMemo(() => [...strategies].sort((a, b) =>
    Number(b.status === 'PROMOTED_ACTIVE') - Number(a.status === 'PROMOTED_ACTIVE') ||
    Number(b.status === 'PAPER_TRADING') - Number(a.status === 'PAPER_TRADING') ||
    Number(b.accuracyStatus === 'BACKTESTED') - Number(a.accuracyStatus === 'BACKTESTED') ||
    (b.discoveryMetrics?.validationExpectedValueUnits ?? -Infinity) -
      (a.discoveryMetrics?.validationExpectedValueUnits ?? -Infinity)
  ), [strategies]);
  const selected = ranked.find(gene => gene.id === selectedId) || ranked[0] || null;

  return (
    <div className="sf-page">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Dna className="w-5 h-5 text-cyan-300" />
            <h2 className="text-lg sm:text-xl font-black text-white">Evolved Strategy Population</h2>
          </div>
          <p className="text-xs sm:text-sm text-neutral-300 mt-1 max-w-2xl">
            This page shows candidates actually stored by the research engine. No preset win rates, invented strategy names or assumed profitability.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void refresh()} disabled={loading} className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white rounded-lg text-xs flex items-center gap-2">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {onGoToSignals && (
            <button onClick={onGoToSignals} className="px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-neutral-950 font-bold rounded-lg text-xs flex items-center gap-2">
              Open Signal Terminal <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-4 flex gap-3 text-xs text-neutral-300">
        <ShieldCheck className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
        <div>
          <strong className="text-amber-200">Execution contract:</strong> decision from a fully closed M1 candle exactly 3 minutes before entry; starting candle and expiry match at 5, 10, 15, 20, 25 or 30 minutes. All generated signals remain paper-only.
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-800 bg-rose-950/30 p-3 text-xs text-rose-200">{error}</div>}

      {loading && strategies.length === 0 ? (
        <p className="text-xs text-neutral-400">Loading stored candidate population…</p>
      ) : ranked.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-700 p-8 text-center space-y-2">
          <Dna className="w-7 h-7 mx-auto text-neutral-600" />
          <h3 className="text-sm font-semibold text-white">No evolved candidates stored</h3>
          <p className="text-xs text-neutral-400">Import genuine M1 history and run the 300-candidate evolutionary batch. Candidates receive no accuracy until they pass the registered historical process.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {ranked.slice(0, 18).map(gene => {
              const active = selected?.id === gene.id;
              return (
                <button key={gene.id} onClick={() => setSelectedId(gene.id)} className={`text-left p-4 rounded-xl border transition-colors ${active ? 'border-cyan-500 bg-neutral-900' : 'border-neutral-800 bg-neutral-900/50 hover:border-neutral-700'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[10px] text-neutral-400 font-mono">{gene.symbol || 'PAIR UNASSIGNED'} · GEN {gene.generation}</span>
                    <span className="text-[9px] rounded bg-neutral-800 px-2 py-1 text-neutral-300">{statusLabel(gene)}</span>
                  </div>
                  <h3 className="mt-2 text-sm font-bold text-white">{gene.name}</h3>
                  <p className="mt-1 text-[10px] text-neutral-500">{gene.optimalHorizonMinutes}m entry/expiry · {gene.sessionAffinity} session</p>
                  <p className="mt-2 font-mono text-[10px] text-cyan-200 break-all line-clamp-2">{gene.mathematicalFormula}</p>
                  {gene.discoveryMetrics ? (
                    <div className="mt-3 flex gap-3 text-[10px] font-mono text-neutral-400">
                      <span>VAL {(gene.discoveryMetrics.validationWinRate * 100).toFixed(1)}%</span>
                      <span>n={gene.discoveryMetrics.validationScoredTrades}</span>
                      <span>EV {gene.discoveryMetrics.validationExpectedValueUnits.toFixed(3)}</span>
                    </div>
                  ) : <p className="mt-3 text-[10px] text-neutral-500">No discovery metrics recorded.</p>}
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-800 pb-3">
                <div>
                  <h3 className="text-base font-bold text-white">{selected.name}</h3>
                  <p className="text-[11px] text-neutral-400">{selected.symbol} · {selected.optimalHorizonMinutes}m starting candle / expiry · {selected.sessionAffinity} · {selected.id}</p>
                </div>
                <span className="px-2 py-1 rounded bg-neutral-800 text-neutral-300 text-[10px]">{statusLabel(selected)}</span>
              </div>

              <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-3">
                <span className="text-[10px] uppercase text-neutral-500 block mb-1">Executable symbolic expression</span>
                <code className="text-xs text-cyan-200 break-all">{selected.mathematicalFormula}</code>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] font-mono">
                <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-3">
                  <span className="text-neutral-500 block">Train WR / n</span>
                  <strong className="text-white">{selected.discoveryMetrics ? (selected.discoveryMetrics.trainWinRate * 100).toFixed(1) + '% / ' + selected.discoveryMetrics.trainScoredTrades : 'No data'}</strong>
                </div>
                <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-3">
                  <span className="text-neutral-500 block">Validation WR / n</span>
                  <strong className="text-white">{selected.discoveryMetrics ? (selected.discoveryMetrics.validationWinRate * 100).toFixed(1) + '% / ' + selected.discoveryMetrics.validationScoredTrades : 'No data'}</strong>
                </div>
                <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-3">
                  <span className="text-neutral-500 block">Untouched test</span>
                  <strong className="text-white">{selected.backtestMetrics ? (selected.backtestMetrics.testWinRate * 100).toFixed(1) + '% / ' + selected.backtestMetrics.testScoredSampleSize : 'Not tested'}</strong>
                </div>
                <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-3">
                  <span className="text-neutral-500 block">Forward paper</span>
                  <strong className="text-white">{selected.paperMetrics ? selected.paperMetrics.wins + 'W / ' + selected.paperMetrics.losses + 'L / n=' + selected.paperMetrics.scoredTrades : 'No data'}</strong>
                </div>
              </div>

              {selected.backtestMetrics && (
                <p className="text-[11px] text-neutral-400">
                  Historical test block WR: {selected.backtestMetrics.testBlockWinRates.map(value => (value * 100).toFixed(1) + '%').join(' / ')} · Wilson lower bound: {(selected.backtestMetrics.confidenceInterval95[0] * 100).toFixed(1)}%. This test interval is consumed and cannot be reused for another batch on this pair.
                </p>
              )}
              {selected.paperMetrics && (
                <p className="text-[11px] text-neutral-400">
                  Forward paper return: {selected.paperMetrics.netReturnUnits > 0 ? '+' : ''}{selected.paperMetrics.netReturnUnits.toFixed(3)} payout-adjusted stake units · PF {selected.paperMetrics.profitFactor.toFixed(2)} · minimum observed payout {selected.paperMetrics.minimumPayoutPct.toFixed(1)}%.
                </p>
              )}
              {selected.validationFailureReason && <p className="text-[11px] text-amber-300">{selected.validationFailureReason}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
};
