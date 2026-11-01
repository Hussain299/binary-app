import React from 'react';
import { ArrowDownRight, ArrowUpRight, Clock3, ShieldCheck } from 'lucide-react';
import type { ResearchSignal } from '../types/index.js';

interface SignalCardProps {
  signal: ResearchSignal;
  nowMs: number;
  formatIST: (isoString?: string | null) => string;
  onSelect: () => void;
}

function getAgeLabel(timestamp: string, nowMs: number): string {
  const createdAt = Date.parse(timestamp);
  if (!Number.isFinite(createdAt)) return 'Age unavailable';
  const seconds = Math.max(0, Math.floor((nowMs - createdAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ago`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

function getState(signal: ResearchSignal, nowMs: number) {
  const expiryMs = Date.parse(signal.plannedExitTimeUtc || signal.candleCloseTimeUtc || '');
  const overdue = Number.isFinite(expiryMs) && nowMs >= expiryMs;
  if (signal.lifecycleState === 'CLOSED') {
    if (signal.outcomeResult === 'WIN') return { label: 'Verified · Won', tone: 'is-win' };
    if (signal.outcomeResult === 'LOSS') return { label: 'Verified · Lost', tone: 'is-loss' };
    return { label: 'Verified · Push', tone: 'is-neutral' };
  }
  if (signal.lifecycleState === 'EXIT_PENDING' || (signal.lifecycleState === 'ACTIVE' && overdue)) {
    return { label: 'Verifying outcome', tone: 'is-pending' };
  }
  if (signal.lifecycleState === 'ACTIVE' || signal.lifecycleState === 'ENTRY_TRIGGERED') {
    return { label: 'Open', tone: 'is-open' };
  }
  if (signal.lifecycleState === 'WAITING_FOR_ENTRY') return { label: 'Scheduled', tone: 'is-scheduled' };
  if (signal.lifecycleState === 'INVALIDATED') return { label: 'Invalidated', tone: 'is-neutral' };
  if (signal.lifecycleState === 'AMBIGUOUS') return { label: 'Ambiguous · unscored', tone: 'is-neutral' };
  return { label: 'Expired · unscored', tone: 'is-neutral' };
}

function getCountdown(target: string | null | undefined, nowMs: number): string {
  const timeMs = target ? Date.parse(target) : NaN;
  if (!Number.isFinite(timeMs)) return 'Time unavailable';
  const seconds = Math.floor((timeMs - nowMs) / 1000);
  if (seconds <= 0) return 'Awaiting verification';
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
    : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function SignalCard({ signal, nowMs, formatIST, onSelect }: SignalCardProps) {
  const isBuy = signal.direction === 'BUY';
  const state = getState(signal, nowMs);
  const entryTime = signal.actualEntryTimeUtc || signal.candleOpenTimeUtc || signal.entryWindowStartUtc;
  const expiryTime = signal.plannedExitTimeUtc || signal.candleCloseTimeUtc || signal.entryWindowEndUtc;
  const isResolved = signal.lifecycleState === 'CLOSED';
  const returnValue = typeof signal.netReturnUnits === 'number'
    ? `${signal.netReturnUnits > 0 ? '+' : ''}${signal.netReturnUnits.toFixed(2)} units`
    : 'Not scored';

  return (
    <button type="button" onClick={onSelect} className="sf-signal-card w-full text-left">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6">
        <div className="min-w-0 lg:w-[265px] lg:shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[17px] font-semibold tracking-[-.035em] text-white">{signal.symbol}</span>
            <span className={`sf-signal-direction ${isBuy ? 'is-buy' : 'is-sell'}`}>
              {isBuy ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {isBuy ? 'CALL' : 'PUT'}
            </span>
            <span className={`sf-signal-status ${state.tone}`}>{state.label}</span>
          </div>
          <div className="mt-1.5 truncate text-xs text-slate-300">
            {signal.strategyName || 'Research signal'}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
            <span>{signal.marketSessionName || 'FX market'}</span>
            <span className="text-slate-700">·</span>
            <span>{signal.entryTimeframeMinutes ?? signal.expiryMinutes ?? 5}m horizon</span>
            <span className="text-slate-700">·</span>
            <span>{getAgeLabel(signal.predictionTimeUtc, nowMs)}</span>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <div className="sf-signal-meta">Entry · IST</div>
            <div className="mt-1 text-xs font-medium tabular-nums text-slate-100">
              {signal.candleOpenTimeIst || formatIST(entryTime)}
            </div>
          </div>
          <div>
            <div className="sf-signal-meta">Expiry · IST</div>
            <div className="mt-1 text-xs font-medium tabular-nums text-slate-100">
              {signal.candleCloseTimeIst || formatIST(expiryTime)}
            </div>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <div className="sf-signal-meta">{state.tone === 'is-pending' ? 'Data status' : 'Paper outcome'}</div>
            <div className={`mt-1 text-xs font-medium ${isResolved ? (signal.outcomeResult === 'WIN' ? 'text-emerald-300' : signal.outcomeResult === 'LOSS' ? 'text-rose-300' : 'text-slate-200') : 'text-slate-300'}`}>
              {state.tone === 'is-pending'
                ? 'Exact expiry candle pending'
                : isResolved ? returnValue
                  : signal.lifecycleState === 'WAITING_FOR_ENTRY'
                    ? getCountdown(signal.candleOpenTimeUtc || signal.entryWindowStartUtc, nowMs)
                    : signal.lifecycleState === 'ACTIVE' || signal.lifecycleState === 'ENTRY_TRIGGERED'
                      ? getCountdown(expiryTime, nowMs)
                      : 'No result inferred'}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-white/[.06] pt-3 lg:w-[148px] lg:flex-col lg:items-end lg:justify-center lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <div className="text-left lg:text-right">
            <div className="sf-signal-meta">Model score · not probability</div>
            <div className="mt-1 font-mono text-sm font-semibold text-slate-100">{(signal.confidence * 100).toFixed(0)}%</div>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-slate-500">
            <ShieldCheck className="h-3 w-3" /> Paper only
          </div>
        </div>

        <div className="hidden items-center text-slate-600 lg:flex">
          <Clock3 className="h-4 w-4" />
        </div>
      </div>
    </button>
  );
}
