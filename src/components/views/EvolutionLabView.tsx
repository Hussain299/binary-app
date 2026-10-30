import React from 'react';
import { Dna, ArrowRight, ShieldCheck, CheckCircle2, XCircle, TrendingUp, Sparkles } from 'lucide-react';
import { EvolutionGeneration } from '../../types/index.js';

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
    '11. Evolve Next Generation Parameters',
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-neutral-950 p-6 space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-neutral-800">
        <div>
          <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
            <Dna className="w-4 h-4 text-emerald-400" />
            <span>Autonomous Evolution Laboratory</span>
          </h3>
          <p className="text-xs text-neutral-400 font-mono mt-1">
            Generational adaptation engine. System learns from failed experiments to evolve robust, cost-resilient models.
          </p>
        </div>

        <button
          onClick={onTriggerGeneration}
          disabled={isRunning}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-emerald-950 bg-emerald-400 hover:bg-emerald-300 rounded transition-colors disabled:opacity-50"
        >
          <Sparkles className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
          <span>{isRunning ? 'Evolving Generation...' : 'Evolve Next Generation'}</span>
        </button>
      </div>

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
        <h4 className="text-sm font-semibold text-white font-mono">Generational Lineage Records</h4>

        {generations.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-center text-neutral-500 font-mono text-xs bg-neutral-900/40 border border-neutral-800 rounded">
            <Dna className="w-8 h-8 text-neutral-600 mb-2" />
            <p className="text-neutral-400 font-medium text-sm">No Generations Evolved Yet</p>
            <p className="mt-1">Click &quot;Evolve Next Generation&quot; or allow the scheduled cron cycle to run.</p>
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
                  Autonomous Lessons Learned (Failures Avoided)
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
