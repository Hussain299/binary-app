import React, { useState } from 'react';
import { Target, Clock, ArrowRight, ShieldAlert, CheckCircle2, AlertTriangle, Layers } from 'lucide-react';
import { ResearchSignal } from '../../types/index.js';

interface EntryExitMonitorViewProps {
  signals: ResearchSignal[];
}

export const EntryExitMonitorView: React.FC<EntryExitMonitorViewProps> = ({ signals }) => {
  const [selectedSignal, setSelectedSignal] = useState<ResearchSignal | null>(
    signals[0] || null
  );

  const sig = selectedSignal || signals[0];

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-neutral-950 p-6 space-y-6">
      <div className="pb-4 border-b border-neutral-800">
        <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
          <Target className="w-4 h-4 text-emerald-400" />
          <span>Causal Entry & Exit Execution Monitor</span>
        </h3>
        <p className="text-xs text-neutral-400 font-mono mt-1">
          Inspection of temporal decoupling between prediction time, causal trigger breach, actual entry fill, and dynamically offset exit times.
        </p>
      </div>

      {sig ? (
        <div className="space-y-6 font-mono text-xs">
          {/* Signal Selector Ribbon */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {signals.map(s => (
              <button
                key={s.id}
                onClick={() => setSelectedSignal(s)}
                className={`px-3 py-1.5 rounded border text-xs font-mono transition-colors whitespace-nowrap ${
                  (selectedSignal?.id || sig.id) === s.id
                    ? 'bg-neutral-800 text-white border-neutral-700 font-semibold'
                    : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white'
                }`}
              >
                {s.symbol} {s.direction} ({s.lifecycleState})
              </button>
            ))}
          </div>

          {/* Temporal Lifecycle Stepper */}
          <div className="bg-neutral-900/60 border border-neutral-800 rounded p-5 space-y-4">
            <h4 className="text-sm font-semibold text-white">
              Deterministic Causal State Transition Architecture
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {/* Step 1 */}
              <div className="bg-neutral-950 p-3.5 rounded border border-neutral-800 space-y-1">
                <span className="text-[10px] text-neutral-500 uppercase font-semibold">
                  01. Setup Detected
                </span>
                <div className="text-white font-bold">{sig.symbol} {sig.direction}</div>
                <div className="text-neutral-400 text-[11px]">
                  Closed candle: {sig.signalCandleTime.substring(11, 19)} UTC
                </div>
                <div className="text-[10px] text-neutral-500 mt-2">
                  No execution permitted on signal candle close.
                </div>
              </div>

              {/* Step 2 */}
              <div className="bg-neutral-950 p-3.5 rounded border border-neutral-800 space-y-1">
                <span className="text-[10px] text-amber-400 uppercase font-semibold">
                  02. Waiting for Causal Trigger
                </span>
                <div className="text-white font-bold">{sig.triggerPrice}</div>
                <div className="text-neutral-400 text-[11px]">
                  Window: {sig.entryWindowStartUtc.substring(11, 19)}–
                  {sig.entryWindowEndUtc.substring(11, 19)} UTC
                </div>
                <div className="text-[10px] text-neutral-500 mt-2">
                  Requires next candle high/low to penetrate trigger.
                </div>
              </div>

              {/* Step 3 */}
              <div className="bg-neutral-950 p-3.5 rounded border border-neutral-800 space-y-1">
                <span className="text-[10px] text-emerald-400 uppercase font-semibold">
                  03. Actual Entry Fill
                </span>
                <div className="text-white font-bold">
                  {sig.actualEntryPrice ? sig.actualEntryPrice : 'Pending'}
                </div>
                <div className="text-neutral-400 text-[11px]">
                  Fill Time: {sig.actualEntryTimeUtc ? sig.actualEntryTimeUtc.substring(11, 19) + ' UTC' : 'Awaiting confirmation'}
                </div>
                <div className="text-[10px] text-neutral-500 mt-2">
                  Expiry clock strictly starts here, not at prediction.
                </div>
              </div>

              {/* Step 4 */}
              <div className="bg-neutral-950 p-3.5 rounded border border-neutral-800 space-y-1">
                <span className="text-[10px] text-blue-400 uppercase font-semibold">
                  04. Planned & Actual Exit
                </span>
                <div className="text-white font-bold">
                  {sig.actualExitPrice ? sig.actualExitPrice : 'Holding'}
                </div>
                <div className="text-neutral-400 text-[11px]">
                  Exit Target: {sig.plannedExitTimeUtc ? sig.plannedExitTimeUtc.substring(11, 19) + ' UTC' : 'Set after fill'}
                </div>
                <div className="text-[10px] text-neutral-500 mt-2">
                  Duration: {sig.expiryMinutes}m post actual fill.
                </div>
              </div>
            </div>
          </div>

          {/* Audit Rule Enforcement Panel */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4 space-y-3">
              <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-emerald-400" />
                <span>Anti-Lookahead Timing Guarantees</span>
              </h4>
              <div className="space-y-2 text-neutral-300 text-[11px]">
                <div className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Causal Trigger:</strong> Price crossing is strictly evaluated on
                    subsequent completed 1m candles. Historical candle closes are never treated as
                    instant market fills.
                  </span>
                </div>
                <div className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Dynamic Expiry Start:</strong> Expiry duration (+{sig.expiryMinutes}m) is
                    calculated strictly from observed fill timestamp (
                    {sig.actualEntryTimeUtc || 'Awaiting'}), avoiding premature exit evaluation.
                  </span>
                </div>
                <div className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Ambiguity Trap Prevention:</strong> If a volatile 1m candle penetrates
                    both trigger ({sig.triggerPrice}) and stop ({sig.invalidationPrice}), state
                    switches immediately to AMBIGUOUS without fictitious intrabar sequence guessing.
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4 space-y-3">
              <h4 className="text-sm font-semibold text-white">Full Event Trail for {sig.id}</h4>
              <div className="bg-neutral-950 p-3 rounded border border-neutral-800 space-y-1.5 max-h-48 overflow-y-auto">
                {sig.lifecycleHistory.map((evt, idx) => (
                  <div key={idx} className="text-[11px] text-neutral-300">
                    <span className="text-neutral-500">[{evt.timestamp.substring(11, 19)}]</span>{' '}
                    <span className="text-emerald-400">
                      {evt.fromState} → {evt.toState}
                    </span>
                    : <span className="text-neutral-400">{evt.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="h-64 flex flex-col items-center justify-center text-center text-neutral-500 font-mono text-xs">
          <Target className="w-8 h-8 text-neutral-600 mb-2" />
          <p className="text-neutral-400 font-medium text-sm">No Signals to Monitor</p>
          <p className="mt-1">Signals will appear here once generated by the research cycle.</p>
        </div>
      )}
    </div>
  );
};
