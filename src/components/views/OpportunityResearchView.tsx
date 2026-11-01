import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  FlaskConical,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import {
  FOREX_PAIRS,
  OpportunityDirection,
  TradeOpportunity,
} from '../../types/index.js';

type Filter = 'SHORTLISTED' | 'ALL' | 'INSUFFICIENT_EVIDENCE';

const HORIZONS = [5, 10, 15, 20, 25, 30];

function formatIST(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date).toUpperCase() + ' IST';
}

function formatPrice(value: number, symbol: string): string {
  return value.toFixed(symbol.includes('JPY') ? 3 : 5);
}

const percent = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : (value * 100).toFixed(1) + '%';

const directionLabel = (direction: OpportunityDirection) =>
  direction === 'BUY' ? 'BUY' : direction === 'SELL' ? 'SELL' : 'NO TRADE';

const directionClasses = (direction: OpportunityDirection) =>
  direction === 'BUY'
    ? 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20'
    : direction === 'SELL'
      ? 'text-rose-300 bg-rose-400/10 border-rose-400/20'
      : 'text-neutral-300 bg-neutral-700/30 border-neutral-600/30';

const auditLabel = (opportunity: TradeOpportunity) => {
  if (opportunity.humanDecision.status === 'APPROVED_FOR_PAPER_REVIEW') return 'HUMAN APPROVED · PAPER REVIEW';
  if (opportunity.humanDecision.status === 'REJECTED_BY_HUMAN') return 'REJECTED BY HUMAN';
  if (opportunity.audit.status === 'SHORTLISTED') return 'SHORTLISTED';
  if (opportunity.audit.status === 'INSUFFICIENT_EVIDENCE') return 'INSUFFICIENT EVIDENCE';
  if (opportunity.audit.status === 'NO_TRADE') return 'NO TRADE';
  return 'REJECTED BY AUDITOR';
};

function ForecastGraph({ opportunity }: { opportunity: TradeOpportunity }) {
  const points = opportunity.forecast.points;
  if (opportunity.forecast.status !== 'AVAILABLE' || points.length < 2) {
    return (
      <div className="flex min-h-[270px] flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#0a111b] px-6 text-center">
        <AlertTriangle className="mb-3 h-7 w-7 text-amber-400" />
        <div className="text-sm font-semibold text-white">Forecast unavailable</div>
        <p className="mt-1 max-w-md text-xs leading-5 text-neutral-400">
          The engine could not find enough independent, continuous real-market analogues. It will not invent a future path.
        </p>
      </div>
    );
  }

  const width = 900;
  const height = 330;
  const left = 64;
  const right = 24;
  const top = 22;
  const bottom = 46;
  const allValues = points.flatMap(point => [point.q10, point.q90]);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const spread = Math.max(maxValue - minValue, opportunity.snapshotPrice * 0.00001);
  const min = minValue - spread * 0.08;
  const max = maxValue + spread * 0.08;
  const x = (index: number) => left + (index / Math.max(1, points.length - 1)) * (width - left - right);
  const y = (value: number) => top + ((max - value) / (max - min)) * (height - top - bottom);
  const line = (field: 'q10' | 'q25' | 'median' | 'q75' | 'q90') =>
    points.map((point, index) => (index === 0 ? 'M' : 'L') + x(index).toFixed(1) + ',' + y(point[field]).toFixed(1)).join(' ');
  const band = (lower: 'q10' | 'q25', upper: 'q90' | 'q75') => {
    const upperPath = points.map((point, index) => (index === 0 ? 'M' : 'L') + x(index).toFixed(1) + ',' + y(point[upper]).toFixed(1)).join(' ');
    const lowerPath = points.slice().reverse().map((point, reverseIndex) => {
      const index = points.length - 1 - reverseIndex;
      return 'L' + x(index).toFixed(1) + ',' + y(point[lower]).toFixed(1);
    }).join(' ');
    return upperPath + ' ' + lowerPath + ' Z';
  };

  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#0a111b] p-2 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="text-xs font-semibold text-neutral-200">Historical analogue path distribution</div>
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-neutral-400">
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-sky-400/40" />10–90%</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-emerald-400/50" />25–75%</span>
          <span className="flex items-center gap-1"><i className="h-[2px] w-3 bg-white" />Median</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Historical analogue forecast distribution" className="h-auto w-full">
        {[0, 1, 2, 3].map(tick => {
          const value = min + (max - min) * tick / 3;
          const yy = y(value);
          return (
            <g key={tick}>
              <line x1={left} x2={width - right} y1={yy} y2={yy} stroke="rgba(255,255,255,0.08)" strokeDasharray="4 6" />
              <text x={left - 8} y={yy + 4} textAnchor="end" fontSize="12" fill="#9ca3af">{formatPrice(value, opportunity.symbol)}</text>
            </g>
          );
        })}
        <path d={band('q10', 'q90')} fill="rgba(56,189,248,0.14)" stroke="none" />
        <path d={band('q25', 'q75')} fill="rgba(52,211,153,0.18)" stroke="none" />
        <path d={line('median')} fill="none" stroke="#f8fafc" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <line x1={left} x2={width - right} y1={y(opportunity.proposedEntryPrice)} y2={y(opportunity.proposedEntryPrice)} stroke="#fbbf24" strokeDasharray="6 5" strokeWidth="1.5" />
        <text x={width - right - 2} y={y(opportunity.proposedEntryPrice) - 7} textAnchor="end" fontSize="11" fill="#fbbf24">Indicative entry</text>
        <text x={left} y={height - 12} fontSize="11" fill="#9ca3af">Entry</text>
        <text x={width - right} y={height - 12} textAnchor="end" fontSize="11" fill="#9ca3af">Expiry · {opportunity.horizonMinutes}m</text>
        <text x={width / 2} y={height - 12} textAnchor="middle" fontSize="11" fill="#6b7280">Minutes after proposed entry</text>
      </svg>
      <p className="px-2 pb-1 text-[10px] leading-4 text-neutral-500">
        Bands show the 10th–90th and 25th–75th percentiles of selected historical analogue paths. This is not a guaranteed target or a forward-calibrated probability.
      </p>
    </div>
  );
}

export const OpportunityResearchView: React.FC = () => {
  const [opportunities, setOpportunities] = useState<TradeOpportunity[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState<Filter>('SHORTLISTED');
  const [symbolFilter, setSymbolFilter] = useState('ALL');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingDecision, setIsSavingDecision] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [revisionDirection, setRevisionDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [revisionHorizon, setRevisionHorizon] = useState('5');

  const loadOpportunities = async () => {
    try {
      const response = await fetch('/api/opportunities?limit=3000');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load opportunity research.');
      const rows = Array.isArray(data.opportunities) ? data.opportunities as TradeOpportunity[] : [];
      setOpportunities(rows);
      if (!selectedId && rows.length) setSelectedId(rows[0].id);
    } catch (err: any) {
      setError(err.message || 'Could not load opportunity research.');
    }
  };

  useEffect(() => {
    void loadOpportunities();
  }, []);

  const visible = useMemo(() => {
    let rows = opportunities;
    if (filter === 'SHORTLISTED') {
      rows = rows.filter(item => item.audit.status === 'SHORTLISTED');
    } else if (filter === 'INSUFFICIENT_EVIDENCE') {
      rows = rows.filter(item => item.audit.status === 'INSUFFICIENT_EVIDENCE');
    }
    if (symbolFilter !== 'ALL') rows = rows.filter(item => item.symbol === symbolFilter);
    return rows.slice().sort((a, b) =>
      b.audit.rankScore - a.audit.rankScore ||
      Date.parse(b.generatedAt) - Date.parse(a.generatedAt)
    );
  }, [opportunities, filter, symbolFilter]);

  const selected = opportunities.find(item => item.id === selectedId) || visible[0] || null;

  useEffect(() => {
    if (!selected) return;
    setRevisionDirection(selected.direction === 'SELL' ? 'SELL' : 'BUY');
    setRevisionHorizon(String(selected.horizonMinutes));
  }, [selectedId, selected?.id]);

  const shortlistCount = opportunities.filter(item => item.audit.status === 'SHORTLISTED' &&
    item.humanDecision.status === 'PENDING').length;
  const insufficientCount = opportunities.filter(item => item.audit.status === 'INSUFFICIENT_EVIDENCE').length;
  const rejectedCount = opportunities.filter(item => item.audit.status === 'REJECTED' || item.audit.status === 'NO_TRADE').length;

  const generate = async () => {
    setIsGenerating(true);
    setError('');
    setMessage('Scanning fresh real-market feeds and building historical analogue forecasts…');
    try {
      const response = await fetch('/api/opportunities/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Opportunity generation failed.');
      const rows = Array.isArray(data.opportunities) ? data.opportunities as TradeOpportunity[] : [];
      setOpportunities(rows);
      const first = rows.find(item => item.audit.status === 'SHORTLISTED') || rows[0];
      setSelectedId(first?.id || '');
      setFilter('ALL');
      setMessage(
        `Generated ${data.generatedCount} hypotheses across ${data.processedPairs}/${data.requestedPairs} pairs. ${data.shortlistedCount} cleared the independent shortlist gates; ${data.insufficientEvidenceCount} lacked sufficient evidence. No trades were placed.`
      );
      if (data.skippedPairs?.length) {
        setError('Some pairs were skipped: ' + data.skippedPairs.slice(0, 4).map((item: any) => item.symbol + ' — ' + item.reason).join(' · '));
      }
    } catch (err: any) {
      setError(err.message || 'Opportunity generation failed.');
      setMessage('');
    } finally {
      setIsGenerating(false);
    }
  };

  const postDecision = async (decision: 'APPROVE_FOR_PAPER_REVIEW' | 'REJECT') => {
    if (!selected) return;
    setIsSavingDecision(true);
    setError('');
    try {
      const response = await fetch(`/api/opportunities/${encodeURIComponent(selected.id)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Decision could not be saved.');
      setOpportunities(previous => previous.map(item => item.id === selected.id ? data.opportunity : item));
      setMessage(data.message);
    } catch (err: any) {
      setError(err.message || 'Decision could not be saved.');
    } finally {
      setIsSavingDecision(false);
    }
  };

  const revise = async () => {
    if (!selected) return;
    setIsSavingDecision(true);
    setError('');
    try {
      const response = await fetch(`/api/opportunities/${encodeURIComponent(selected.id)}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: revisionDirection,
          horizonMinutes: Number(revisionHorizon),
          notes: 'Human-modified pre-trade hypothesis; re-audited from the stored same-snapshot analogue distribution.',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Revised hypothesis could not be evaluated.');
      setOpportunities(previous => [data.opportunity, ...previous]);
      setSelectedId(data.opportunity.id);
      setFilter('ALL');
      setMessage(data.message);
    } catch (err: any) {
      setError(err.message || 'Revised hypothesis could not be evaluated.');
    } finally {
      setIsSavingDecision(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent text-neutral-100">
      <div className="shrink-0 border-b border-white/[0.07] bg-[#0d1520] px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
              <BrainCircuit className="h-4 w-4" /> Pre-trade research intelligence
            </div>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Opportunity laboratory</h1>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-400">
              Generate competing BUY/SELL/NO-TRADE hypotheses, compare them with historical market analogues and inspect probabilistic paths before making a human decision.
            </p>
          </div>
          <button
            onClick={generate}
            disabled={isGenerating}
            className="flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400 px-4 py-2.5 text-xs font-bold text-[#07130e] transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />
            {isGenerating ? 'Generating hypotheses…' : 'Generate opportunities'}
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:max-w-xl">
          <div className="rounded-lg border border-emerald-400/15 bg-emerald-400/[0.06] px-3 py-2">
            <div className="text-xl font-bold tabular-nums text-emerald-300">{shortlistCount}</div>
            <div className="text-[10px] text-neutral-400">Shortlisted</div>
          </div>
          <div className="rounded-lg border border-amber-400/15 bg-amber-400/[0.05] px-3 py-2">
            <div className="text-xl font-bold tabular-nums text-amber-300">{insufficientCount}</div>
            <div className="text-[10px] text-neutral-400">Insufficient evidence</div>
          </div>
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2">
            <div className="text-xl font-bold tabular-nums text-neutral-200">{rejectedCount}</div>
            <div className="text-[10px] text-neutral-400">Rejected / no trade</div>
          </div>
        </div>
        {(message || error) && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-5 ${error ? 'border-amber-500/20 bg-amber-500/[0.06] text-amber-200' : 'border-white/[0.07] bg-white/[0.025] text-neutral-300'}`}>
            {error || message}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4 lg:flex-row">
        <section className="flex min-h-[210px] flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#0d1520] lg:w-[340px] lg:shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] px-3 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <FlaskConical className="h-4 w-4 text-emerald-300" /> Hypothesis pool
            </div>
            <span className="text-[10px] tabular-nums text-neutral-500">{visible.length} shown</span>
          </div>
          <div className="flex gap-1 border-b border-white/[0.06] px-2 py-2">
            {([
              ['SHORTLISTED', 'Shortlist'],
              ['ALL', 'All'],
              ['INSUFFICIENT_EVIDENCE', 'Insufficient'],
            ] as Array<[Filter, string]>).map(([value, label]) => (
              <button key={value} onClick={() => setFilter(value)} className={`rounded-md px-2 py-1.5 text-[10px] font-semibold ${filter === value ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-neutral-300'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="border-b border-white/[0.06] px-2 py-2">
            <select
              value={symbolFilter}
              onChange={event => setSymbolFilter(event.target.value)}
              className="w-full rounded-md border border-white/[0.08] bg-[#101b29] px-2 py-2 text-xs text-neutral-200 outline-none"
            >
              <option value="ALL">All currency pairs</option>
              {FOREX_PAIRS.map(symbol => <option key={symbol} value={symbol}>{symbol}</option>)}
            </select>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {visible.map(item => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={`w-full rounded-lg border p-3 text-left transition ${selected?.id === item.id ? 'border-emerald-400/30 bg-emerald-400/[0.07]' : 'border-transparent bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{item.symbol}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${directionClasses(item.direction)}`}>{directionLabel(item.direction)}</span>
                    </div>
                    <div className="mt-1 truncate text-[11px] text-neutral-300">{item.hypothesisName}</div>
                    <div className="mt-1 text-[10px] text-neutral-500">{item.horizonMinutes}m · {item.forecast.analogueCount} analogues</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs font-bold tabular-nums text-emerald-300">{item.audit.rankScore.toFixed(0)}</div>
                    <div className="text-[9px] uppercase text-neutral-500">Rank</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-neutral-500">
                  <span>{auditLabel(item)}</span>
                  <span>{percent(item.forecast.lowerConfidenceBound)} LCB</span>
                </div>
              </button>
            ))}
            {!visible.length && (
              <div className="px-3 py-10 text-center text-xs leading-5 text-neutral-500">
                {opportunities.length
                  ? 'No opportunities match this filter.'
                  : 'No opportunity batch yet. Generate hypotheses to begin.'}
              </div>
            )}
          </div>
        </section>

        <section className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-xl border border-white/[0.07] bg-[#0d1520]">
          {selected ? (
            <div className="space-y-4 p-3 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-white">{selected.symbol}</h2>
                    <span className={`rounded-md border px-2 py-1 text-[10px] font-bold ${directionClasses(selected.direction)}`}>{directionLabel(selected.direction)}</span>
                    <span className="rounded-md border border-white/10 bg-white/[0.035] px-2 py-1 text-[10px] text-neutral-400">{selected.horizonMinutes}m hypothesis</span>
                  </div>
                  <div className="mt-1 text-sm text-neutral-300">{selected.hypothesisName}</div>
                  <div className="mt-1 max-w-3xl text-xs leading-5 text-neutral-500">{selected.hypothesis}</div>
                </div>
                <div className="rounded-lg border border-white/[0.07] bg-black/10 px-3 py-2 text-right">
                  <div className="text-[9px] uppercase tracking-wide text-neutral-500">Audit state</div>
                  <div className="mt-1 text-xs font-bold text-neutral-200">{auditLabel(selected)}</div>
                  <div className="mt-1 text-[10px] tabular-nums text-neutral-500">Rank {selected.audit.rankScore.toFixed(1)} / 100</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Analogue win rate', percent(selected.forecast.winRate), 'Historical comparison only'],
                  ['95% lower bound', percent(selected.forecast.lowerConfidenceBound), 'Conservative estimate'],
                  ['Payout break-even', percent(selected.forecast.payoutBreakEvenProbability), 'At 80% payout floor'],
                  ['Analogue sample', String(selected.forecast.analogueCount), 'Temporally separated outcomes'],
                ].map(([label, value, sub]) => (
                  <div key={label} className="rounded-lg border border-white/[0.07] bg-black/10 px-3 py-2.5">
                    <div className="text-[10px] text-neutral-500">{label}</div>
                    <div className="mt-1 text-lg font-bold tabular-nums text-white">{value}</div>
                    <div className="mt-1 text-[9px] text-neutral-600">{sub}</div>
                  </div>
                ))}
              </div>

              <ForecastGraph opportunity={selected} />

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-white/[0.07] bg-black/10 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-white"><Activity className="h-4 w-4 text-sky-300" /> Snapshot & schedule</div>
                  <div className="grid grid-cols-2 gap-y-2 text-[11px]">
                    <span className="text-neutral-500">Snapshot</span><span className="text-right text-neutral-200">{formatIST(selected.snapshotAt)}</span>
                    <span className="text-neutral-500">Proposed entry</span><span className="text-right text-neutral-200">{formatIST(selected.entryTimeUtc)}</span>
                    <span className="text-neutral-500">Expiry</span><span className="text-right text-neutral-200">{formatIST(selected.expiryTimeUtc)}</span>
                    <span className="text-neutral-500">Snapshot price</span><span className="text-right font-mono text-neutral-200">{formatPrice(selected.snapshotPrice, selected.symbol)}</span>
                    <span className="text-neutral-500">Indicative entry</span><span className="text-right font-mono text-neutral-200">{formatPrice(selected.proposedEntryPrice, selected.symbol)}</span>
                    <span className="text-neutral-500">Data quality</span><span className="text-right text-neutral-200">{selected.marketDataQuality.toFixed(1)} / 100</span>
                    <span className="text-neutral-500">Data source</span><span className="text-right text-neutral-200">{selected.dataSource}</span>
                    <span className="text-neutral-500">Analogue distance</span><span className="text-right text-neutral-200">{selected.forecast.meanDistance?.toFixed(3) ?? '—'}</span>
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-black/10 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-white"><ShieldCheck className="h-4 w-4 text-amber-300" /> Independent challenge</div>
                  <div className="space-y-2">
                    {selected.audit.reasons.map((reason, index) => (
                      <div key={index} className="flex items-start gap-2 text-[11px] leading-4 text-neutral-300">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" /> {reason}
                      </div>
                    ))}
                    {selected.audit.counterEvidence.map((reason, index) => (
                      <div key={index} className="flex items-start gap-2 text-[11px] leading-4 text-neutral-400">
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" /> {reason}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.07] bg-black/10 p-3">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-white"><SlidersHorizontal className="h-4 w-4 text-emerald-300" /> Human hypothesis revision</div>
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <label className="text-[10px] text-neutral-500">
                    Direction
                    <select value={revisionDirection} onChange={event => setRevisionDirection(event.target.value as 'BUY' | 'SELL')} className="mt-1 w-full rounded-md border border-white/10 bg-[#101b29] px-2 py-2 text-xs text-white outline-none">
                      <option value="BUY">BUY</option>
                      <option value="SELL">SELL</option>
                    </select>
                  </label>
                  <label className="text-[10px] text-neutral-500">
                    Expiry / entry timeframe
                    <select value={revisionHorizon} onChange={event => setRevisionHorizon(event.target.value)} className="mt-1 w-full rounded-md border border-white/10 bg-[#101b29] px-2 py-2 text-xs text-white outline-none">
                      {HORIZONS.map(value => <option key={value} value={value}>{value} minutes</option>)}
                    </select>
                  </label>
                  <button onClick={revise} disabled={isSavingDecision || Date.parse(selected.staleAfter) <= Date.now()} className="mt-auto flex items-center justify-center gap-2 rounded-md border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-400/15 disabled:opacity-40">
                    <RefreshCw className={`h-3.5 w-3.5 ${isSavingDecision ? 'animate-spin' : ''}`} /> Re-evaluate revision
                  </button>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-neutral-500">
                  Revision creates a separate hypothesis linked to the original. Direction changes recalculate outcomes from the stored analogue paths. A different expiry must have its own forecast from the same snapshot.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-black/10 p-3">
                <div className="max-w-xl text-[10px] leading-4 text-neutral-500">
                  <div className="font-semibold text-neutral-300">Human decision · no execution</div>
                  Approval only records that this candidate is accepted for paper review. It does not create a signal, place an order, or authorize a broker.
                  {selected.humanDecision.parentOpportunityId && <div className="mt-1 text-sky-300">Revised from {selected.humanDecision.parentOpportunityId}</div>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => postDecision('REJECT')} disabled={isSavingDecision || selected.humanDecision.status !== 'PENDING'} className="flex items-center gap-1.5 rounded-md border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-400/10 disabled:opacity-40">
                    <XCircle className="h-3.5 w-3.5" /> Reject
                  </button>
                  <button onClick={() => postDecision('APPROVE_FOR_PAPER_REVIEW')} disabled={isSavingDecision || selected.audit.status !== 'SHORTLISTED' || selected.humanDecision.status !== 'PENDING'} className="flex items-center gap-1.5 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/15 disabled:opacity-40">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve for paper review
                  </button>
                </div>
              </div>
              {Date.parse(selected.staleAfter) <= Date.now() && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-200">
                  <Clock3 className="h-4 w-4" /> This snapshot is stale. Generate a new batch before making a decision.
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center px-6 text-center">
              <BrainCircuit className="h-8 w-8 text-neutral-600" />
              <div className="mt-3 text-sm font-semibold text-neutral-300">Select an opportunity</div>
              <p className="mt-1 text-xs text-neutral-500">Choose a hypothesis from the left, or generate a new batch.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
