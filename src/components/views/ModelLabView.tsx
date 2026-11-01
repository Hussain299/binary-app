import React from 'react';
import { ShieldCheck, History, AlertTriangle } from 'lucide-react';
import { ResearchExperiment } from '../../types/index.js';

interface ModelLabViewProps {
  experiments: ResearchExperiment[];
  onExperimentComplete: (exp: ResearchExperiment) => void;
}

/**
 * Individual rule/horizon test runs are intentionally retired. Repeatedly
 * querying the same final time window creates selection bias and false
 * confidence. Candidate tests now run only through the registered batch.
 */
export const ModelLabView: React.FC<ModelLabViewProps> = ({ experiments }) => {
  const archived = experiments
    .filter(item => item.experimentType !== 'LIVE_TRADE' && item.experimentType !== 'FORWARD_OBSERVATION')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 8);

  return (
    <div className="sf-page">
      <section className="rounded-xl border border-amber-800/60 bg-amber-950/20 p-5 space-y-2">
        <div className="flex items-center gap-2 text-amber-300">
          <ShieldCheck className="w-5 h-5" />
          <h2 className="text-base font-bold">Individual holdout testing is disabled</h2>
        </div>
        <p className="text-sm text-neutral-200 leading-relaxed">
          Re-running one rule against the same final test period lets repeated choices overfit the test itself. SignalForge therefore does not publish new single-rule test scores from this screen.
        </p>
        <p className="text-xs text-neutral-400 leading-relaxed">
          Use the 300-candidate evolutionary research process instead: it ranks candidates on chronological train/validation data, opens the untouched test only for preselected finalists, and permanently records the consumed test window for that currency pair. A later batch requires at least 30,000 newer genuine M1 candles.
        </p>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <AlertTriangle className="w-4 h-4 text-cyan-300" />
          Current trading contract
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-3">
            <span className="text-neutral-500 block">Decision timing</span>
            <strong className="text-white">Exactly 3 minutes before entry</strong>
            <p className="mt-1 text-neutral-500">Only a fully closed M1 decision candle is eligible.</p>
          </div>
          <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-3">
            <span className="text-neutral-500 block">Starting entry candle</span>
            <strong className="text-white">5, 10, 15, 20, 25 or 30 minutes</strong>
            <p className="mt-1 text-neutral-500">The expiry horizon must match that starting candle.</p>
          </div>
        </div>
        <p className="text-[11px] text-neutral-500">
          Historical candidates remain research-only until the required untouched-test evidence and independent forward-paper evidence both exist. Paper candle prices are not broker fills.
        </p>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <History className="w-4 h-4 text-neutral-400" />
          Archived historical experiment records ({archived.length})
        </h3>
        <p className="text-[11px] text-neutral-500">
          These are saved records from the earlier exploratory workflow. Their test results may have been inspected across repeated runs; they are displayed for history only and are not eligible to seed parent selection or strategy approval.
        </p>
        {archived.length === 0 ? (
          <p className="text-xs text-neutral-500">No archived experiments.</p>
        ) : (
          <div className="space-y-2">
            {archived.map(item => (
              <div key={item.id} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <div className="font-semibold text-neutral-200">{item.name}</div>
                  <div className="text-[10px] text-neutral-500">{item.symbol} · {item.ruleFamily} · {item.horizonMinutes}m · {new Date(item.createdAt).toLocaleString()}</div>
                </div>
                <span className="text-[10px] text-neutral-500 font-mono">LEGACY · NOT FOR APPROVAL</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
