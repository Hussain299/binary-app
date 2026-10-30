import React, { useState } from 'react';
import { History, ShieldCheck, CheckCircle2, XCircle, AlertTriangle, Search } from 'lucide-react';
import { ResearchExperiment } from '../../types/index.js';

interface ExperimentHistoryViewProps {
  experiments: ResearchExperiment[];
}

export const ExperimentHistoryView: React.FC<ExperimentHistoryViewProps> = ({ experiments }) => {
  const [search, setSearch] = useState('');
  const [filterVerdict, setFilterVerdict] = useState<'ALL' | 'ACCEPTED' | 'REJECTED'>('ALL');
  const [selectedExp, setSelectedExp] = useState<ResearchExperiment | null>(null);

  const filtered = experiments.filter(e => {
    const matchSearch =
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.symbol.toLowerCase().includes(search.toLowerCase()) ||
      e.ruleFamily.toLowerCase().includes(search.toLowerCase());
    const matchVerdict = filterVerdict === 'ALL' || e.auditorVerdict === filterVerdict;
    return matchSearch && matchVerdict;
  });

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-950">
      {/* Subheader Toolbar */}
      <div className="h-12 border-b border-neutral-800 px-6 flex items-center justify-between shrink-0 bg-neutral-900/30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-neutral-400 font-mono">
            <span className="text-white font-semibold">EXPERIMENT HISTORY</span>
            <span>·</span>
            <span>{experiments.length} PERMANENT EXPERIMENT RUNS</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1 text-xs font-mono">
            <Search className="w-3.5 h-3.5 text-neutral-500 mr-2" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search experiments..."
              className="bg-transparent text-white outline-none w-36 sm:w-48 placeholder:text-neutral-600"
            />
          </div>

          <div className="flex items-center bg-neutral-900 p-0.5 rounded border border-neutral-800 text-xs font-mono">
            <button
              onClick={() => setFilterVerdict('ALL')}
              className={`px-2.5 py-1 rounded transition-colors ${
                filterVerdict === 'ALL' ? 'bg-neutral-800 text-white' : 'text-neutral-400'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterVerdict('ACCEPTED')}
              className={`px-2.5 py-1 rounded transition-colors ${
                filterVerdict === 'ACCEPTED' ? 'bg-neutral-800 text-emerald-400' : 'text-neutral-400'
              }`}
            >
              Accepted
            </button>
            <button
              onClick={() => setFilterVerdict('REJECTED')}
              className={`px-2.5 py-1 rounded transition-colors ${
                filterVerdict === 'REJECTED' ? 'bg-neutral-800 text-rose-400' : 'text-neutral-400'
              }`}
            >
              Rejected
            </button>
          </div>
        </div>
      </div>

      {/* Main Table Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center text-neutral-500 font-mono text-xs">
            <History className="w-8 h-8 text-neutral-600 mb-2" />
            <p className="text-neutral-400 font-medium text-sm">No Experiments Matched</p>
            <p className="mt-1">Run an experiment from the Model Lab or trigger a research cycle.</p>
          </div>
        ) : (
          <div className="border border-neutral-800 rounded overflow-hidden">
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-neutral-900/80 border-b border-neutral-800 text-neutral-400 uppercase text-[10px]">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Gen / Experiment</th>
                  <th className="py-2.5 px-4 font-semibold">Pair</th>
                  <th className="py-2.5 px-4 font-semibold">Rule & Horizon</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Train Acc</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Val Acc</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Test Acc</th>
                  <th className="py-2.5 px-4 font-semibold text-right">F1 Score</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Profit Factor</th>
                  <th className="py-2.5 px-4 font-semibold text-center">Auditor Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-850 bg-neutral-950">
                {filtered.map(exp => {
                  return (
                    <tr
                      key={exp.id}
                      onClick={() => setSelectedExp(exp)}
                      className="hover:bg-neutral-900/60 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-4">
                        <span className="text-neutral-500">{exp.experimentType === 'LIVE_TRADE' ? 'LIVE' : `G${exp.generation}`}</span> ·{' '}
                        <strong className="text-white">{exp.name}</strong>
                      </td>
                      <td className="py-2.5 px-4 text-neutral-300 font-semibold">{exp.symbol}</td>
                      <td className="py-2.5 px-4 text-neutral-400">
                        {exp.ruleFamily} ({exp.horizonMinutes}m)
                      </td>
                      <td className="py-2.5 px-4 text-right text-neutral-300 tabular-nums">
                        {exp.experimentType === 'LIVE_TRADE' ? '—' : `${(exp.metrics.trainAccuracy * 100).toFixed(1)}%`}
                      </td>
                      <td className="py-2.5 px-4 text-right text-neutral-300 tabular-nums">
                        {exp.experimentType === 'LIVE_TRADE' ? '—' : `${(exp.metrics.valAccuracy * 100).toFixed(1)}%`}
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold text-white tabular-nums">
                        {exp.experimentType === 'LIVE_TRADE' ? `${exp.liveOutcome || 'OUTCOME'} (n=1)` : `${(exp.metrics.testAccuracy * 100).toFixed(1)}%`}
                      </td>
                      <td className="py-2.5 px-4 text-right text-emerald-400 tabular-nums">
                        {exp.experimentType === 'LIVE_TRADE' ? '—' : exp.metrics.f1Score.toFixed(3)}
                      </td>
                      <td className="py-2.5 px-4 text-right text-neutral-300 tabular-nums">
                        {exp.experimentType === 'LIVE_TRADE' ? '—' : exp.metrics.profitFactor}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span
                          className={`inline-block font-semibold ${
                            exp.auditorVerdict === 'ACCEPTED'
                              ? 'text-emerald-400'
                              : exp.auditorVerdict === 'PROVISIONAL'
                              ? 'text-amber-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {exp.auditorVerdict}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedExp && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg max-w-2xl w-full p-6 text-xs font-mono text-neutral-300 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-neutral-800">
              <div>
                <span className="text-[10px] text-neutral-500 uppercase">
                  {selectedExp.experimentType === 'LIVE_TRADE' ? 'Single Live Trade Record' : `Experiment Dossier G${selectedExp.generation}`}
                </span>
                <h4 className="text-base font-bold text-white">{selectedExp.name}</h4>
              </div>
              <button
                onClick={() => setSelectedExp(null)}
                className="text-neutral-400 hover:text-white px-2 py-1 rounded bg-neutral-800"
              >
                Close
              </button>
            </div>

            {selectedExp.experimentType === 'LIVE_TRADE' && (
              <div className="bg-neutral-950 p-3 rounded border border-neutral-800 space-y-1">
                <div className="text-white font-semibold">Observed live outcome: {selectedExp.liveOutcome || 'RECORDED'}</div>
                <div>One completed trade only. This record is not a historical backtest or a strategy win-rate estimate.</div>
                <div>Net result: {selectedExp.metrics.expectedValuePips > 0 ? '+' : ''}{selectedExp.metrics.expectedValuePips.toFixed(1)} pips</div>
              </div>
            )}
            <div>
              <h5 className="text-[10px] uppercase text-neutral-500 font-semibold mb-1">
                Scientist Falsifiable Hypothesis
              </h5>
              <p className="bg-neutral-950 p-3 rounded border border-neutral-800 text-neutral-300">
                {selectedExp.scientistHypothesis}
              </p>
            </div>

            <div>
              <h5 className="text-[10px] uppercase text-neutral-500 font-semibold mb-1">
                Disproof Condition
              </h5>
              <p className="bg-neutral-950 p-3 rounded border border-neutral-800 text-rose-300">
                {selectedExp.scientistDisproofCondition}
              </p>
            </div>

            <div>
              <h5 className="text-[10px] uppercase text-neutral-500 font-semibold mb-1">
                Engineer Isolation Notes
              </h5>
              <p className="bg-neutral-950 p-3 rounded border border-neutral-800 text-neutral-400">
                {selectedExp.engineerConfigNotes}
              </p>
            </div>

            <div>
              <h5 className="text-[10px] uppercase text-neutral-500 font-semibold mb-1">
                Skeptical Auditor Audit Trail & Objections
              </h5>
              <div className="bg-neutral-950 p-3 rounded border border-neutral-800 space-y-1">
                <div className="font-semibold text-white">
                  Verdict: <span className={selectedExp.auditorVerdict === 'ACCEPTED' ? 'text-emerald-400' : 'text-rose-400'}>{selectedExp.auditorVerdict}</span>
                </div>
                {selectedExp.auditorConcerns.map((c, i) => (
                  <div key={i} className="text-rose-300">
                    • {c}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
