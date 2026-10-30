import React from 'react';
import { Dna, ArrowRight, ShieldCheck, CheckCircle2, XCircle, TrendingUp, Sparkles } from 'lucide-react';
import { EvolutionGeneration, FOREX_PAIRS, ForexSymbol } from '../../types/index.js';

interface StrategySearchCandidate {
  id: string;
  name: string;
  formula: string;
  status: string;
  testWinRate: number;
  testScoredTrades: number;
  validationWinRate: number;
  validationExpectedValueUnits: number;
  testExpectedValueUnits: number;
  testedOnHoldout: boolean;
  expectedValueUnits: number;
  testBlockWinRates: number[];
  reason?: string;
}

interface StrategySearchBatch {
  jobId: string;
  symbol: ForexSymbol;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  total: number;
  completed: number;
  passedHistorical: number;
  insufficientSample: number;
  rejected: number;
  replicationFinalists: number;
  approvedCount: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  topCandidates?: StrategySearchCandidate[];
}

interface EvolutionLabViewProps {
  generations: EvolutionGeneration[];
  onTriggerGeneration: () => void;
  isRunning: boolean;
}

export const EvolutionLabView: React.FC<EvolutionLabViewProps> = ({
  generations,
  onTriggerGeneration,
  isRunning,
}) => {
  const [searchPair, setSearchPair] = React.useState<ForexSymbol>('EUR/USD');
  const [historyCounts, setHistoryCounts] = React.useState<Record<string, number>>({});
  const [searchBatch, setSearchBatch] = React.useState<StrategySearchBatch | null>(null);
  const [isSearchingBatch, setIsSearchingBatch] = React.useState(false);
  const [searchError, setSearchError] = React.useState('');

  React.useEffect(() => {
    fetch('/api/research/candles/status')
      .then(response => response.json())
      .then(payload => {
        const counts: Record<string, number> = {};
        (payload.pairs || []).forEach((pair: { symbol: string; count: number }) => {
          counts[pair.symbol] = pair.count;
        });
        setHistoryCounts(counts);
        const readyPair = FOREX_PAIRS.find(pair => (counts[pair] || 0) >= 30_000);
        if (readyPair) setSearchPair(readyPair);
      })
      .catch(() => setSearchError('Could not read historical-data status.'));
  }, []);

  const runThreeHundredSearch = async () => {
    setIsSearchingBatch(true);
    setSearchError('');
    setSearchBatch(null);
    try {
      const startResponse = await fetch('/api/strategies/search-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: searchPair }),
      });
      const startPayload = await startResponse.json();
      if (!startResponse.ok) throw new Error(startPayload.error || 'Could not start the strategy search.');
      let snapshot: StrategySearchBatch = {
        ...startPayload,
        completed: 0,
        passedHistorical: 0,
        insufficientSample: 0,
        rejected: 0,
        replicationFinalists: 0,
        approvedCount: 0,
        total: 300,
      };
      setSearchBatch(snapshot);

      while (snapshot.status === 'RUNNING') {
        await new Promise(resolve => setTimeout(resolve, 1500));
        const pollResponse = await fetch(`/api/strategies/search-batch/${snapshot.jobId}`);
        const pollPayload = await pollResponse.json();
        if (!pollResponse.ok) throw new Error(pollPayload.error || 'Could not read search progress.');
        snapshot = pollPayload as StrategySearchBatch;
        setSearchBatch(snapshot);
      }
      if (snapshot.status === 'FAILED') throw new Error(snapshot.error || 'The strategy search failed.');
    } catch (error: any) {
      setSearchError(error.message || 'The strategy search failed.');
    } finally {
      setIsSearchingBatch(false);
    }
  };

  const selectedHistoryCount = historyCounts[searchPair] || 0;
  const searchProgress = searchBatch ? Math.round((searchBatch.completed / 300) * 100) : 0;

  const steps = [
    '1. Collect Multi-Feed Forex Data',
    '2. Discover Market Anomalies',
    '3. Formulate Falsifiable Hypotheses',
    '4. Configure Isolated Splits',
    '5. Execute Purged Walk-Forward',
    '6. Evaluate Validation Performance',
    '7. Untouched Test Replication',
    '8. Skeptical Auditor Interrogation',
    '9. Candidate Fitness Ranking',
    '10. Archive Failure Lineage',
    '11. Sample New Candidate Parameters',
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-neutral-950 p-6 space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-neutral-800">
        <div>
          <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
            <Dna className="w-4 h-4 text-emerald-400" />
            <span>Research Candidate Laboratory</span>
          </h3>
          <p className="text-xs text-neutral-400 font-mono mt-1">
            Three hundred expressions are ranked on train/validation data; only the preselected finalists see the untouched holdout. Passing history only allows paper testing.
          </p>
        </div>

        <button
          onClick={onTriggerGeneration}
          disabled={isRunning}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-emerald-950 bg-emerald-400 hover:bg-emerald-300 rounded transition-colors disabled:opacity-50"
        >
          <Sparkles className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
          <span>{isRunning ? 'Running Research Cycle...' : 'Run Autonomous Research Cycle'}</span>
        </button>
      </div>

      {/* Large-scale symbolic discovery and evidence gate */}
      <section className="rounded-xl border border-cyan-900/70 bg-neutral-900/70 p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Dna className="w-4 h-4 text-cyan-300" />
              Symbolic Strategy Discovery · 300 Candidate Search
            </h4>
            <p className="mt-1 text-xs leading-relaxed text-neutral-400">
              Generates 300 executable mathematical expressions using genetic crossover and mutation, then replays each one on imported real-market M1 history. Candidates are not approved because they look promising.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={searchPair}
              onChange={event => setSearchPair(event.target.value as ForexSymbol)}
              disabled={isSearchingBatch}
              className="bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white"
            >
              {FOREX_PAIRS.map(pair => (
                <option key={pair} value={pair}>
                  {pair} · {(historyCounts[pair] || 0).toLocaleString()} M1
                </option>
              ))}
            </select>
            <button
              onClick={runThreeHundredSearch}
              disabled={isSearchingBatch || selectedHistoryCount < 30_000}
              className="flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-bold text-neutral-950 hover:bg-cyan-300 disabled:opacity-40"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isSearchingBatch ? 'animate-spin' : ''}`} />
              {isSearchingBatch ? 'Testing 300 strategies…' : 'Generate & Test 300 Strategies'}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-400">
          <span>Imported history: <strong className="text-white">{selectedHistoryCount.toLocaleString()} / 30,000 M1 candles</strong></span>
          <span>Historic gate: <strong className="text-white">300 scored test trades · 70% validation and test WR</strong></span>
          <span>Final gate: <strong className="text-white">300 forward paper outcomes · 70% rolling WR</strong></span>
        </div>

        {searchError && (
          <div className="rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-xs text-rose-300">{searchError}</div>
        )}

        {searchBatch && (
          <div className="space-y-3">
            <div className="flex flex-wrap justify-between gap-2 text-xs">
              <span className="text-white font-semibold">
                {searchBatch.status === 'RUNNING' ? 'Historical candidate tests running' : searchBatch.status === 'COMPLETED' ? 'Search completed' : 'Search failed'}
              </span>
              <span className="font-mono text-cyan-300">{searchBatch.completed} / 300 · {searchProgress}%</span>
            </div>
            <div className="h-2 rounded-full bg-neutral-800 overflow-hidden">
              <div className="h-full bg-cyan-400 transition-all" style={{ width: `${searchProgress}%` }} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-3">
                <div className="text-[10px] text-neutral-500">Historical passes</div>
                <div className="text-xl font-bold text-emerald-300">{searchBatch.passedHistorical}</div>
              </div>
              <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-3">
                <div className="text-[10px] text-neutral-500">Insufficient sample</div>
                <div className="text-xl font-bold text-amber-300">{searchBatch.insufficientSample}</div>
              </div>
              <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-3">
                <div className="text-[10px] text-neutral-500">Failed 70% / EV gates</div>
                <div className="text-xl font-bold text-rose-300">{searchBatch.rejected}</div>
              </div>
              <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-3">
                <div className="text-[10px] text-neutral-500">Blind holdout finalists</div>
                <div className="text-xl font-bold text-cyan-300">{searchBatch.replicationFinalists}</div>
                <div className="text-[9px] text-neutral-500">Selected using validation only</div>
              </div>
              <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-3">
                <div className="text-[10px] text-neutral-500">Actionable strategies approved</div>
                <div className="text-xl font-bold text-white">{searchBatch.approvedCount}</div>
                <div className="text-[9px] text-neutral-500">approved after historical + forward 300 gates</div>
              </div>
            </div>
            {searchBatch.topCandidates && searchBatch.topCandidates.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-neutral-800">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-neutral-950 text-neutral-500 uppercase">
                    <tr>
                      <th className="p-2">Candidate / expression</th>
                      <th className="p-2">Validation WR</th>
                      <th className="p-2">Validation EV (units/trade)</th>
                      <th className="p-2">Blind test WR</th>
                      <th className="p-2">Test n</th>
                      <th className="p-2">Test blocks</th>
                      <th className="p-2">Holdout EV (units/trade)</th>
                      <th className="p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchBatch.topCandidates.map(candidate => (
                      <tr key={candidate.id} className="border-t border-neutral-800 align-top">
                        <td className="p-2 min-w-[260px]">
                          <div className="font-semibold text-neutral-200">{candidate.name}</div>
                          <div className="mt-1 font-mono text-[10px] text-neutral-500 break-all">{candidate.formula}</div>
                          {candidate.reason && <div className="mt-1 text-[10px] text-amber-300">{candidate.reason}</div>}
                        </td>
                        <td className="p-2 font-mono text-neutral-300">{candidate.validationWinRate > 0 ? `${(candidate.validationWinRate * 100).toFixed(1)}%` : '—'}</td>
                        <td className="p-2 font-mono text-neutral-300">{candidate.validationExpectedValuePips.toFixed(2)}</td>
                        <td className="p-2 font-mono text-white">{candidate.testedOnHoldout ? `${(candidate.testWinRate * 100).toFixed(1)}%` : 'Not tested'}</td>
                        <td className="p-2 font-mono text-neutral-300">{candidate.testedOnHoldout ? candidate.testScoredTrades : '—'}</td>
                        <td className="p-2 font-mono text-neutral-300">{candidate.testBlockWinRates.length === 3 ? candidate.testBlockWinRates.map(rate => `${(rate * 100).toFixed(0)}%`).join(' / ') : '—'}</td>
                        <td className="p-2 font-mono text-neutral-300">{candidate.testedOnHoldout ? candidate.testExpectedValuePips.toFixed(2) : '—'}</td>
                        <td className="p-2">
                          <span className={candidate.status === 'PAPER_TRADING' ? 'text-emerald-300' : 'text-neutral-400'}>
                            {candidate.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10px] text-neutral-500">
              All 300 candidates are ranked without touching the final holdout. Only up to 10 preselected validation finalists are replayed on the untouched holdout. A historical pass still needs a separate 300-outcome forward paper run before approved alerts. Forward paper outcomes are candle-based observations, not broker fills.
            </p>
          </div>
        )}
      </section>

      {/* 11-Stage Evolution Lifecycle Pipeline */}
      <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4 font-mono text-xs space-y-3">
        <h4 className="text-sm font-semibold text-white">Closed-Loop Scientific Method Flow</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 text-[11px]">
          {steps.map((st, i) => (
            <div
              key={i}
              className="bg-neutral-950 border border-neutral-800/80 p-2.5 rounded text-neutral-300 flex flex-col justify-between"
            >
              <span className="text-neutral-500 text-[10px] block">Step {i + 1}</span>
              <span className="font-medium mt-1">{st.substring(3)}</span>
            </div>
          ))}
          <div className="bg-emerald-950/40 border border-emerald-800/80 p-2.5 rounded text-emerald-300 flex flex-col justify-between">
            <span className="text-emerald-500 text-[10px] block">Step 12</span>
            <span className="font-medium mt-1">Repeat Automatically</span>
          </div>
        </div>
      </div>

      {/* Generations Tree / History */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-white font-mono">Research Cycle Records</h4>

        {generations.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-center text-neutral-500 font-mono text-xs bg-neutral-900/40 border border-neutral-800 rounded">
            <Dna className="w-8 h-8 text-neutral-600 mb-2" />
            <p className="text-neutral-400 font-medium text-sm">No Research Cycles Recorded Yet</p>
            <p className="mt-1">Run a research cycle when imported historical data is available.</p>
          </div>
        ) : (
          generations.map(gen => (
            <div
              key={gen.generation}
              className="bg-neutral-900/60 border border-neutral-800 rounded p-5 font-mono text-xs space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-neutral-800">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-white">Generation #{gen.generation}</span>
                  <span className="text-neutral-500">·</span>
                  <span className="text-neutral-400">{gen.timestamp.substring(0, 19).replace('T', ' ')} UTC</span>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{gen.acceptedCount} Accepted</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-rose-400">
                    <XCircle className="w-3.5 h-3.5" />
                    <span>{gen.rejectedCount} Rejected</span>
                  </div>
                  <div className="flex items-center gap-1 text-white font-semibold">
                    <span>Best F1:</span>
                    <span className="tabular-nums text-emerald-300">{gen.bestF1Score.toFixed(3)}</span>
                  </div>
                </div>
              </div>

              <p className="text-neutral-300 leading-relaxed">{gen.summary}</p>

              {/* Lessons Learned */}
              <div className="bg-neutral-950 p-3 rounded border border-neutral-800 space-y-1 text-neutral-400 text-[11px]">
                <div className="text-neutral-500 uppercase text-[10px] font-semibold mb-1">
                  Recorded Research Notes
                </div>
                {gen.lessonsLearned.map((lesson, i) => (
                  <div key={i} className="flex gap-2 text-neutral-300">
                    <span className="text-emerald-400">✓</span>
                    <span>{lesson}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
