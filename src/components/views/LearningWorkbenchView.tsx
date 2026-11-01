import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, BrainCircuit, CheckCircle2, Clock3, Database, Gauge, LineChart, RefreshCw, ShieldCheck, SlidersHorizontal, Sparkles, Target, TrendingDown, Trophy } from 'lucide-react';
import type { LearningBoard, LearningPrediction } from '../../server/learningPlatform.js';

const pct = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? (value * 100).toFixed(1) + '%' : '—';
const num = (value: number | null | undefined, digits = 4) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
const ist = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).format(date) + ' IST' : '—';
};
const badge = (state: string) => ['RESOLVED','WIN','CHALLENGER_ELIGIBLE','CURRENT_CHAMPION'].includes(state) ? 'border-emerald-400/20 bg-emerald-400/[.07] text-emerald-200' : ['LOSS','INVALID_DATA','DETERIORATING','NOT_BETTER'].includes(state) ? 'border-rose-400/20 bg-rose-400/[.07] text-rose-200' : ['PENDING','INSUFFICIENT_SAMPLE','INSUFFICIENT_PAIRED_EVIDENCE'].includes(state) ? 'border-amber-400/20 bg-amber-400/[.06] text-amber-200' : 'border-white/10 bg-white/[.035] text-neutral-300';

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={'sf-lab-panel min-w-0 p-4 sm:p-5 ' + className}>{children}</section>;
}
function Heading({ icon: Icon, eyebrow, title, note }: { icon: React.ComponentType<{ className?: string }>; eyebrow: string; title: string; note: string }) {
  return <div className="mb-4 flex items-start gap-3"><div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[.06] p-2 text-emerald-300"><Icon className="h-4 w-4"/></div><div><div className="text-[9px] font-semibold uppercase tracking-[.16em] text-emerald-300/75">{eyebrow}</div><h2 className="mt-0.5 text-base font-semibold text-white">{title}</h2><p className="mt-1 text-[11px] leading-5 text-neutral-500">{note}</p></div></div>;
}
function Metric({ label, value, note, icon: Icon, positive = false }: { label: string; value: string; note: string; icon: React.ComponentType<{ className?: string }>; positive?: boolean }) {
  return <div className="sf-lab-panel p-4"><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] font-semibold uppercase tracking-[.13em] text-neutral-500">{label}</div><div className={'mt-2 text-2xl font-semibold tabular-nums ' + (positive ? 'text-emerald-300' : 'text-white')}>{value}</div><div className="mt-1 text-[9px] text-neutral-500">{note}</div></div><div className="rounded-lg border border-white/[.07] bg-white/[.03] p-2 text-neutral-400"><Icon className="h-4 w-4"/></div></div></div>;
}
function Reliability({ board }: { board: LearningBoard }) {
  const size = 420, pad = 34, x = (v: number) => pad + v * (size - 2 * pad), y = (v: number) => size - pad - v * (size - 2 * pad);
  return <div className="rounded-xl border border-white/[.07] bg-[#09111b] p-3">
    <div className="mb-2 flex justify-between"><span className="text-xs font-semibold text-neutral-200">Forecast reliability</span><span className={'rounded-full border px-2 py-1 text-[9px] ' + badge(board.calibration.evidenceStatus)}>{board.calibration.evidenceStatus.replace(/_/g,' ')}</span></div>
    <svg viewBox={'0 0 ' + size + ' ' + size} className="block w-full" role="img" aria-label="Forecast probability compared with observed win rate">
      {[0,.25,.5,.75,1].map(t=><g key={t}><line x1={x(t)} y1={pad} x2={x(t)} y2={size-pad} stroke="rgba(255,255,255,.07)" strokeDasharray="3 5"/><line x1={pad} y1={y(t)} x2={size-pad} y2={y(t)} stroke="rgba(255,255,255,.07)" strokeDasharray="3 5"/><text x={x(t)} y={size-10} textAnchor="middle" fontSize="10" fill="#778392">{Math.round(t*100)}%</text><text x={pad-7} y={y(t)+3} textAnchor="end" fontSize="10" fill="#778392">{Math.round(t*100)}%</text></g>)}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="rgba(255,255,255,.4)" strokeDasharray="5 5"/>
      {board.calibration.reliabilityBins.filter(b=>b.sampleSize>0 && b.meanPredicted!==null && b.observedRate!==null).map(b=><g key={b.bucket}><circle cx={x(b.meanPredicted!)} cy={y(b.observedRate!)} r={Math.min(10,4+Math.sqrt(b.sampleSize))} fill="rgba(52,211,153,.15)" stroke="#34d399" strokeWidth="1.5"/><text x={x(b.meanPredicted!)} y={y(b.observedRate!)+3} fontSize="8" textAnchor="middle" fill="#d1fae5">{b.sampleSize}</text></g>)}
      <text x={size/2} y={size-1} textAnchor="middle" fontSize="10" fill="#94a3b8">Forecast probability</text>
      <text x="10" y={size/2} textAnchor="middle" fontSize="10" fill="#94a3b8" transform={'rotate(-90 10 ' + size/2 + ')'}>Observed win rate</text>
    </svg>
    <div className="mt-1 text-center text-[9px] text-neutral-600">Dotted line = perfect calibration · sample count appears inside each bin</div>
  </div>;
}
function OutcomeBadge({ item }: { item: LearningPrediction }) {
  const state = item.status === 'RESOLVED' ? item.outcome?.directionOutcome || 'RESOLVED' : item.status;
  return <span className={'inline-flex rounded-full border px-2 py-1 text-[9px] font-semibold ' + badge(state)}>{state.replace(/_/g,' ')}</span>;
}

export const LearningWorkbenchView: React.FC = () => {
  const [board,setBoard] = useState<LearningBoard|null>(null);
  const [loading,setLoading] = useState(true);
  const [refreshing,setRefreshing] = useState(false);
  const [capturing,setCapturing] = useState(false);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [dirty,setDirty] = useState(false);
  const [payout,setPayout] = useState('80');
  const [spread,setSpread] = useState('');
  const [slippage,setSlippage] = useState('');
  const [latency,setLatency] = useState('');
  const [availability,setAvailability] = useState<'UNKNOWN'|'AVAILABLE'|'UNAVAILABLE'>('UNKNOWN');
  const [acceptance,setAcceptance] = useState<'UNKNOWN'|'ACCEPTED'|'REJECTED'>('UNKNOWN');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const response = await fetch('/api/learning/board',{headers:{Accept:'application/json'}});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Learning board could not be loaded.');
      setBoard(data as LearningBoard); setError('');
    } catch (err: any) { setError(err.message || 'Learning service is unavailable.'); }
    finally { setLoading(false); if (!quiet) setRefreshing(false); }
  },[]);
  useEffect(()=>{void load(true);const timer=window.setInterval(()=>void load(true),30_000);return()=>window.clearInterval(timer);},[load]);
  useEffect(()=>{
    if(!board || dirty) return;
    setPayout(String(board.executionProfile.payoutPct));
    setSpread(board.executionProfile.spreadPips===null?'':String(board.executionProfile.spreadPips));
    setSlippage(board.executionProfile.slippagePips===null?'':String(board.executionProfile.slippagePips));
    setLatency(board.executionProfile.latencyMs===null?'':String(board.executionProfile.latencyMs));
    setAvailability(board.executionProfile.assetAvailability);
    setAcceptance(board.executionProfile.brokerAcceptance);
  },[board,dirty]);

  const capture = async () => {
    setCapturing(true);setError('');setMessage('');
    try {
      const response=await fetch('/api/learning/capture-approved',{method:'POST'});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||'Snapshot capture failed.');
      setMessage(data.captured+' captured · '+data.duplicates+' already stored · '+data.rejected+' rejected by eligibility checks.');
      await load(true);
    } catch(err:any){setError(err.message||'Snapshot capture failed.');}
    finally{setCapturing(false);}
  };
  const saveProfile = async (event:React.FormEvent) => {
    event.preventDefault();setSaving(true);setError('');setMessage('');
    try {
      const response=await fetch('/api/learning/execution-profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payoutPct:Number(payout),spreadPips:spread.trim()?Number(spread):null,slippagePips:slippage.trim()?Number(slippage):null,latencyMs:latency.trim()?Number(latency):null,assetAvailability:availability,brokerAcceptance:acceptance})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Assumptions were rejected.');
      setDirty(false);setMessage('Assumptions saved. New snapshots will freeze these values; existing records remain unchanged.');await load(true);
    }catch(err:any){setError(err.message||'Could not save assumptions.');}finally{setSaving(false);}
  };
  const chooseChampion=async(cohortKey:string,modelVersion:string)=>{
    setError('');setMessage('');
    try{const response=await fetch('/api/learning/champion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cohortKey,modelVersion})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Evidence gate rejected the designation.');setBoard(data.board as LearningBoard);setMessage(modelVersion+' is now the human-designated champion. No live execution is enabled.');}
    catch(err:any){setError(err.message||'Champion review failed.');}
  };

  const summary=board?.summary;
  const winRate=summary&&summary.decisive?summary.wins/summary.decisive:null;
  const p=board?.executionProfile;
  const executionStatus=!p?'Loading':p.assetAvailability==='UNAVAILABLE'?'Asset unavailable':p.brokerAcceptance==='REJECTED'?'Rejected scenario':p.latencyMs!==null&&p.latencyMs!==0?'Latency not replayable':p.spreadPips===null||p.slippagePips===null||p.latencyMs===null||p.assetAvailability!=='AVAILABLE'||p.brokerAcceptance!=='ACCEPTED'?'Reference only':'Scenario configured';

  return <div className="sf-opportunity-view flex h-full min-h-0 flex-col overflow-hidden bg-transparent text-neutral-100">
    <header className="sf-opportunity-hero shrink-0 border-b border-white/[.07] px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-3xl">
        <div className="sf-opportunity-kicker flex items-center gap-2"><BrainCircuit className="h-4 w-4"/> Research intelligence · forward evidence</div>
        <h1 className="sf-opportunity-title mt-2">Learning workbench</h1>
        <p className="sf-opportunity-copy mt-2">Frozen predictions. Exact forward outcomes. Measured calibration. Human-governed model evolution. Every decision remains auditable.</p>
        <div className="mt-3 flex flex-wrap gap-2"><span className="rounded-full border border-emerald-400/20 bg-emerald-400/[.06] px-2.5 py-1 text-[9px] text-emerald-200">Immutable ledger</span><span className="rounded-full border border-white/10 bg-white/[.03] px-2.5 py-1 text-[9px] text-neutral-400">Paper research only</span><span className="rounded-full border border-white/10 bg-white/[.03] px-2.5 py-1 text-[9px] text-neutral-400">IST reporting</span></div>
      </div><div className="flex items-center gap-2">
        <button onClick={capture} disabled={capturing||loading} className="sf-primary-button flex items-center gap-2 disabled:opacity-50"><Sparkles className="h-4 w-4"/>{capturing?'Freezing snapshots…':'Capture approved ideas'}</button>
        <button onClick={()=>void load()} disabled={refreshing} aria-label="Refresh learning board" className="sf-icon-button"><RefreshCw className={'h-4 w-4 '+(refreshing?'animate-spin':'')}/></button>
      </div></div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-neutral-500"><span>Service {board?'connected':'connecting'}</span><span>Updated {ist(board?.generatedAt)}</span><span>Refreshes every 30 seconds while open</span><span>No broker connection</span></div>
      {(message||error)&&<div role="status" aria-live="polite" className={'sf-inline-notice mt-3 rounded-lg border px-3 py-2 text-[11px] '+(error?'border-rose-400/20 bg-rose-400/[.06] text-rose-200':'border-emerald-400/15 bg-emerald-400/[.05] text-emerald-100')}>{error||message}</div>}
    </header>
    <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
      {loading&&!board?<div className="flex min-h-[360px] flex-col items-center justify-center text-neutral-500"><RefreshCw className="h-6 w-6 animate-spin text-emerald-300"/><p className="mt-3 text-xs">Loading research evidence…</p></div>
      :!board?<Panel><AlertTriangle className="mx-auto h-7 w-7 text-amber-300"/><p className="mt-3 text-center text-sm text-white">Learning service unavailable</p><button onClick={()=>void load()} className="sf-primary-button mx-auto mt-4">Try again</button></Panel>
      :<div className="mx-auto max-w-[1600px] space-y-4">
        <section className="grid grid-cols-2 gap-2 xl:grid-cols-5">
          <Metric label="Frozen predictions" value={String(summary!.predictions)} note="Human-approved snapshots" icon={Database}/>
          <Metric label="Awaiting expiry" value={String(summary!.pending)} note="Never scored early" icon={Clock3}/>
          <Metric label="Resolved" value={String(summary!.resolved)} note={summary!.invalidData+' invalid-data records excluded'} icon={CheckCircle2} positive/>
          <Metric label="Decisive win rate" value={pct(winRate)} note={summary!.wins+' wins · '+summary!.losses+' losses · '+summary!.scratches+' scratches'} icon={Target} positive/>
          <Metric label="Forecast drift" value={board.calibration.drift.replace(/_/g,' ')} note="Latest 50 vs prior 50 Brier" icon={Activity}/>
        </section>
        <section className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
          <Panel><Heading icon={Gauge} eyebrow="Probability quality" title="Calibration & drift" note="Brier, log loss and calibration error are measured against later resolved predictions. Lower is better; no claim below 50 decisive samples."/>
            <div className="grid grid-cols-3 gap-2">{[['Brier',num(board.calibration.brierScore)],['Log loss',num(board.calibration.logLoss)],['ECE',num(board.calibration.expectedCalibrationError)]].map(([label,value])=><div key={label} className="rounded-lg border border-white/[.06] bg-black/10 px-3 py-2"><div className="text-[9px] text-neutral-500">{label}</div><div className="mt-1 text-lg font-semibold tabular-nums text-white">{value}</div></div>)}</div>
            <div className="mt-3 grid grid-cols-3 gap-2">{[['Scored samples',String(board.calibration.sampleSize)],['Prior 50 Brier',num(board.calibration.prior50Brier)],['Latest 50 Brier',num(board.calibration.last50Brier)]].map(([label,value])=><div key={label} className="rounded-lg bg-white/[.025] px-3 py-2"><div className="text-[9px] text-neutral-500">{label}</div><div className="mt-1 text-sm font-semibold text-white">{value}</div></div>)}</div>
            <div className="mt-3"><Reliability board={board}/></div>
          </Panel>
          <div className="space-y-4">
            <Panel><Heading icon={LineChart} eyebrow="Market context" title="Regime intelligence" note="OHLC diagnostic from prediction-time history. A label is context, not a trade signal."/>
              {board.regimeBreakdown.length?<div className="space-y-3">{board.regimeBreakdown.map(row=><div key={row.regime}><div className="mb-1.5 flex justify-between text-[10px]"><span className="text-neutral-200">{row.regime.replace(/_/g,' ')}</span><span className="tabular-nums text-neutral-400">{pct(row.winRate)} · n={row.sampleSize}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-emerald-400/80" style={{width:(row.winRate||0)*100+'%'}}/></div></div>)}</div>:<div className="py-8 text-center text-xs text-neutral-600">No resolved forward evidence yet.</div>}
              <div className="mt-3 border-t border-white/[.06] pt-3 text-[9px] text-neutral-600">OHLC_DIAGNOSTIC_V1 · minimum 30 valid bars, otherwise UNKNOWN.</div>
            </Panel>
            <Panel><Heading icon={BrainCircuit} eyebrow="Strategy anatomy" title="Hypothesis families" note="Outcome scorecard from this forward ledger; scratches are excluded from decisive win rate."/>
              {board.familyBreakdown.length?<div className="overflow-x-auto"><table className="w-full min-w-[390px] text-left text-[10px]"><thead className="text-[9px] uppercase text-neutral-500"><tr><th className="pb-2">Family</th><th className="pb-2 text-right">n</th><th className="pb-2 text-right">Win rate</th><th className="pb-2 text-right">Brier</th></tr></thead><tbody>{board.familyBreakdown.map(row=><tr key={row.hypothesisType} className="border-t border-white/[.06]"><td className="py-2 text-neutral-200">{row.hypothesisType.replace(/_/g,' ')}</td><td className="py-2 text-right text-neutral-400">{row.sampleSize}</td><td className="py-2 text-right text-neutral-300">{pct(row.winRate)}</td><td className="py-2 text-right text-neutral-400">{num(row.meanBrier,3)}</td></tr>)}</tbody></table></div>:<div className="py-6 text-center text-xs text-neutral-600">Awaiting outcome evidence.</div>}
            </Panel>
          </div>
        </section>
        <Panel><Heading icon={Trophy} eyebrow="Model governance" title="Champion vs challenger" note="Exact symbol/family/horizon cohort comparisons. The engine identifies eligibility; only a human may designate a champion."/>
          {!board.models.length?<div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-xs text-neutral-500">No resolved cohorts. Capture fresh approved ideas and let their exact expiry windows settle.</div>
          :<div className="overflow-x-auto"><table className="w-full min-w-[830px] text-left text-[10px]"><thead className="text-[9px] uppercase text-neutral-500"><tr><th className="pb-3">Cohort / model</th><th className="pb-3 text-right">n</th><th className="pb-3 text-right">Brier</th><th className="pb-3 text-right">Paired n</th><th className="pb-3 text-right">Improvement</th><th className="pb-3">Gate</th><th className="pb-3 text-right">Human review</th></tr></thead><tbody>{board.models.map(row=><tr key={row.cohortKey+'|'+row.modelVersion} className="border-t border-white/[.06]"><td className="py-3"><div className="font-semibold text-neutral-100">{row.symbol} · {row.hypothesisType.replace(/_/g,' ')} · {row.horizonMinutes}m</div><div className="mt-1 font-mono text-[9px] text-neutral-500">{row.modelVersion}</div></td><td className="py-3 text-right text-neutral-300">{row.sampleSize}</td><td className="py-3 text-right text-neutral-300">{num(row.brierScore)}</td><td className="py-3 text-right text-neutral-300">{row.pairedSampleSize}</td><td className="py-3 text-right text-neutral-300">{num(row.pairedBrierImprovement)}</td><td className="py-3"><span className={'rounded-full border px-2 py-1 text-[9px] '+badge(row.promotionStatus)}>{row.promotionStatus.replace(/_/g,' ')}</span></td><td className="py-3 text-right">{['INITIAL_REVIEW_READY','CHALLENGER_ELIGIBLE'].includes(row.promotionStatus)?<button onClick={()=>void chooseChampion(row.cohortKey,row.modelVersion)} className="rounded-md border border-emerald-400/20 bg-emerald-400/[.07] px-2.5 py-1.5 text-[9px] font-semibold text-emerald-100">Designate</button>:row.isChampion?<span className="text-emerald-300">Current</span>:<span className="text-neutral-600">Locked</span>}</td></tr>)}</tbody></table></div>}
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/15 bg-amber-400/[.04] p-3 text-[9px] leading-4 text-amber-100/80"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"/>Research gate, not proof of profit: 100 resolved observations for initial review, or at least 50 paired outcomes and 0.02 Brier improvement for a challenger. No automatic promotion.</div>
        </Panel>
        <section className="grid gap-4 xl:grid-cols-[1fr_390px]">
          <Panel><Heading icon={Database} eyebrow="Permanent research memory" title="Prediction ledger" note="The original forecast and model version remain frozen after resolution. Each scored result points to its exact candle-path fingerprint."/>
            {!board.ledger.length?<div className="rounded-lg border border-dashed border-white/10 px-4 py-10 text-center"><Database className="mx-auto h-7 w-7 text-neutral-600"/><p className="mt-3 text-xs font-semibold text-neutral-300">No frozen predictions yet</p><p className="mt-1 text-[10px] text-neutral-600">Approve an eligible Opportunity Lab hypothesis, then capture it inside the fresh T−3 window.</p></div>
            :<div className="overflow-x-auto"><table className="w-full min-w-[950px] text-left text-[9px]"><thead className="text-[9px] uppercase text-neutral-500"><tr><th className="pb-2 pr-3">Prediction</th><th className="pb-2 pr-3">Forecast</th><th className="pb-2 pr-3">Regime</th><th className="pb-2 pr-3">Entry / expiry</th><th className="pb-2 pr-3">Actual path</th><th className="pb-2">Result</th></tr></thead><tbody>{board.ledger.map(item=><tr key={item.id} className="border-t border-white/[.06] align-top"><td className="py-3 pr-3"><div className="font-semibold text-white">{item.symbol} · <span className={item.direction==='BUY'?'text-emerald-300':'text-rose-300'}>{item.direction}</span></div><div className="mt-1 text-neutral-300">{item.hypothesisType.replace(/_/g,' ')} · {item.horizonMinutes}m</div><div className="mt-1 font-mono text-[8px] text-neutral-600">{item.modelVersion} · {item.predictionHash.slice(0,12)}…</div></td><td className="py-3 pr-3"><div className="font-semibold text-neutral-200">{pct(item.forecastProbability)}</div><div className="mt-1 text-[8px] text-neutral-600">Lower {pct(item.forecastLowerBound)}</div></td><td className="py-3 pr-3 text-neutral-300">{item.regime.label.replace(/_/g,' ')}<div className="mt-1 text-[8px] text-neutral-600">n={item.regime.sampleSize}</div></td><td className="py-3 pr-3 text-neutral-300"><div>{ist(item.entryTimeUtc)}</div><div className="mt-1 text-neutral-500">{ist(item.expiryTimeUtc)}</div></td><td className="py-3 pr-3 text-neutral-300">{item.outcome?<><div>{num(item.outcome.entryPrice,item.symbol.includes('JPY')?3:5)} → {num(item.outcome.expiryPrice,item.symbol.includes('JPY')?3:5)}</div><div className="mt-1 text-[8px] text-neutral-600">{item.outcome.pathCandleCount} exact bars · {item.outcome.sourceProviders.join(', ')}</div><div className="mt-1 text-[8px] text-neutral-600">{item.outcome.execution.status.replace(/_/g,' ')}</div></>:<span className="text-neutral-600">{item.invalidReason||'Awaiting exact expiry path'}</span>}</td><td className="py-3"><OutcomeBadge item={item}/></td></tr>)}</tbody></table></div>}
          </Panel>
          <div className="space-y-4">
            <Panel><Heading icon={SlidersHorizontal} eyebrow="Explicit paper assumptions" title="Execution scenario" note="User-entered assumptions only. Each new snapshot freezes its profile; this is not a broker quote or fill."/>
              <div className="mb-3 flex justify-between rounded-lg border border-white/[.06] bg-black/10 px-3 py-2 text-[9px]"><span className="text-neutral-500">Simulator mode</span><span className={'rounded-full border px-2 py-1 '+badge(executionStatus==='Scenario configured'?'RESOLVED':'PENDING')}>{executionStatus}</span></div>
              <form onSubmit={saveProfile} className="space-y-3"><div className="grid grid-cols-2 gap-2">
                <label className="text-[9px] text-neutral-500">Payout (%)<input required type="number" min="0" max="100" step=".1" value={payout} onChange={e=>{setPayout(e.target.value);setDirty(true)}} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1420] px-3 py-2 text-xs text-white outline-none"/></label>
                <label className="text-[9px] text-neutral-500">Spread (pips)<input type="number" min="0" step=".01" value={spread} placeholder="Unknown" onChange={e=>{setSpread(e.target.value);setDirty(true)}} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1420] px-3 py-2 text-xs text-white outline-none"/></label>
                <label className="text-[9px] text-neutral-500">Slippage (pips)<input type="number" min="0" step=".01" value={slippage} placeholder="Unknown" onChange={e=>{setSlippage(e.target.value);setDirty(true)}} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1420] px-3 py-2 text-xs text-white outline-none"/></label>
                <label className="text-[9px] text-neutral-500">Latency (ms)<input type="number" min="0" step="1" value={latency} placeholder="Unknown" onChange={e=>{setLatency(e.target.value);setDirty(true)}} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1420] px-3 py-2 text-xs text-white outline-none"/></label>
                <label className="text-[9px] text-neutral-500">Asset availability<select value={availability} onChange={e=>{setAvailability(e.target.value as typeof availability);setDirty(true)}} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1420] px-3 py-2 text-xs text-white"><option value="UNKNOWN">Unknown</option><option value="AVAILABLE">Available</option><option value="UNAVAILABLE">Unavailable</option></select></label>
                <label className="text-[9px] text-neutral-500">Acceptance assumption<select value={acceptance} onChange={e=>{setAcceptance(e.target.value as typeof acceptance);setDirty(true)}} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1420] px-3 py-2 text-xs text-white"><option value="UNKNOWN">Unknown</option><option value="ACCEPTED">Accepted</option><option value="REJECTED">Rejected</option></select></label>
              </div><button type="submit" disabled={saving} className="w-full rounded-lg border border-emerald-400/20 bg-emerald-400/[.08] px-3 py-2.5 text-[10px] font-semibold text-emerald-100 disabled:opacity-50">{saving?'Saving…':'Save paper assumptions'}</button></form>
              <div className="mt-3 rounded-lg border border-amber-400/15 bg-amber-400/[.04] p-3 text-[9px] leading-4 text-amber-100/75">M1 OHLC cannot replay sub-minute quote latency. Non-zero latency is marked not replayable. A complete cost scenario is an estimate, never an actual broker fill.</div>
            </Panel>
            <Panel><Heading icon={TrendingDown} eyebrow="Evidence-based review" title="Recent losses" note="A loss is an observation. The engine does not invent causal explanations or auto-mutate a strategy."/>
              {board.recentLosses.length?<div className="space-y-2">{board.recentLosses.slice(0,8).map(item=><div key={item.id} className="rounded-lg border border-white/[.06] bg-black/10 px-3 py-2"><div className="flex justify-between text-[10px]"><span className="font-semibold text-white">{item.symbol} · {item.direction}</span><span className="text-rose-200">LOSS</span></div><div className="mt-1 text-[8px] text-neutral-500">{item.hypothesisType.replace(/_/g,' ')} · {item.horizonMinutes}m · {ist(item.outcome?.resolvedAt)}</div></div>)}</div>:<div className="py-5 text-center text-[10px] text-neutral-600">No resolved losses in this ledger yet.</div>}
            </Panel>
          </div>
        </section>
        <footer className="flex flex-wrap justify-between gap-2 border-t border-white/[.06] pt-3 text-[9px] text-neutral-600"><span>Forward learning · schema v1 · SHA-256 prediction snapshots</span><span>Research only · no order creation · no live execution</span></footer>
      </div>}
    </main>
  </div>;
};
