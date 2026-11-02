import React, { useEffect, useState } from 'react';
import { Activity, BrainCircuit, Database, Dna, FlaskConical, RefreshCw, ShieldCheck, Sparkles, Waves } from 'lucide-react';

type IntelligenceOverview = {
  generatedAt: string;
  researchOnly: boolean;
  brokerExecutionEnabled: boolean;
  scheduler: any;
  worldModel: { regimeSnapshots: number; regimeCounts: Record<string, number>; assessedPairs: Array<{symbol:string;regime:string;session:string;assessedAt:string;observationCount:number;directionalEfficiency:number|null;atrRatio:number|null}> };
  memory: { episodicExperiences:number; lossAutopsies:number; forwardPredictions:number; resolvedPredictions:number; pendingPredictions:number; invalidPredictions:number; events:number };
  research: { opportunities:number; experiments:number; generations:number; agentReviews:number; signalsObserved:number; latestExperimentAt:string|null; latestGenerationAt:string|null };
  governance: Record<string, boolean>;
};

const Metric: React.FC<{label:string;value:string|number;detail:string;icon:React.ReactNode}> = ({label,value,detail,icon}) => (
  <div className="sf-intel-metric">
    <div className="flex items-center justify-between gap-3">
      <span className="sf-intel-label">{label}</span>
      <span className="sf-intel-icon">{icon}</span>
    </div>
    <strong>{value}</strong>
    <small>{detail}</small>
  </div>
);

function timeLabel(value?:string|null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(date)+' IST' : 'Not recorded';
}

export const IntelligenceCoreView: React.FC = () => {
  const [data,setData] = useState<IntelligenceOverview|null>(null);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/intelligence/overview');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Intelligence telemetry unavailable.');
      setData(payload); setError('');
    } catch (e:any) { setError(e?.message || 'Unable to load intelligence telemetry.'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, []);
  const d = data;
  const regimeEntries = Object.entries(d?.worldModel.regimeCounts || {}).sort((a,b)=>b[1]-a[1]);
  return (
    <div className="sf-page sf-intel-page">
      <header className="sf-intel-hero">
        <div className="sf-intel-hero-copy">
          <div className="sf-intel-kicker"><Sparkles className="h-3.5 w-3.5"/> AUTONOMOUS RESEARCH SYSTEM</div>
          <h1>Intelligence core<span>.</span></h1>
          <p>A transparent view of what SignalForge currently observes, remembers, researches and can prove. No simulated intelligence scores or invented activity.</p>
          <div className="sf-intel-hero-badges">
            <span><i className="sf-live-dot"/> {d?.scheduler?.schedulerStarted ? 'Scheduler running' : 'Scheduler stopped'}</span>
            <span>Paper research only</span>
            <span>{d?.scheduler?.market?.isOpen ? 'FX market open' : 'FX market closed'}</span>
          </div>
        </div>
        <div className="sf-intel-orbit" aria-hidden="true">
          <div className="sf-orbit-ring ring-one"/><div className="sf-orbit-ring ring-two"/><div className="sf-orbit-ring ring-three"/>
          <div className="sf-orbit-core"><BrainCircuit size={34}/></div>
          <i className="orbit-point point-one"/><i className="orbit-point point-two"/><i className="orbit-point point-three"/>
        </div>
      </header>
      <div className="flex items-center justify-between gap-3">
        <div><div className="sf-intel-section-title">System observability</div><div className="text-xs text-slate-400 mt-1">Live persisted evidence · refreshes every 15 seconds</div></div>
        <button onClick={load} disabled={loading} className="sf-signals-action"><RefreshCw className={'h-3.5 w-3.5 '+(loading?'animate-spin':'')}/> Refresh</button>
      </div>
      {error && <div role="alert" className="sf-intel-error">{error}</div>}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Market regimes" value={d?.worldModel.regimeSnapshots ?? '—'} detail="Latest pair-level assessments" icon={<Waves size={16}/>}/>
        <Metric label="Episodic memories" value={d?.memory.episodicExperiences ?? '—'} detail="Settled experiences retained" icon={<BrainCircuit size={16}/>}/>
        <Metric label="Forward predictions" value={d?.memory.forwardPredictions ?? '—'} detail={(d?.memory.resolvedPredictions ?? 0)+' resolved · '+(d?.memory.pendingPredictions ?? 0)+' pending'} icon={<Activity size={16}/>}/>
        <Metric label="Research experiments" value={d?.research.experiments ?? '—'} detail={(d?.research.generations ?? 0)+' evolutionary generations' } icon={<FlaskConical size={16}/>}/>
      </section>
      <section className="sf-intel-section">
        <div className="sf-intel-section-heading"><div><h2>World model</h2><p>Observed regime snapshots from the market decision engine.</p></div><span className="sf-intel-count">{d?.worldModel.assessedPairs.length ?? 0} pairs</span></div>
        {regimeEntries.length ? <div className="flex flex-wrap gap-2 mb-4">{regimeEntries.map(([name,count])=><span key={name} className="sf-intel-regime-chip">{name.replaceAll('_',' ')} <b>{count}</b></span>)}</div> : <p className="sf-intel-empty">No regime snapshots have been recorded yet. They appear after market sensing runs.</p>}
        <div className="sf-intel-pair-grid">
          {(d?.worldModel.assessedPairs || []).map(pair=><article key={pair.symbol} className="sf-intel-pair">
            <div className="flex justify-between items-center gap-2"><b>{pair.symbol}</b><span>{pair.regime.replaceAll('_',' ')}</span></div>
            <div className="mt-3 flex justify-between text-[10px] text-slate-400"><span>{pair.session.replaceAll('_',' ')}</span><span>{pair.observationCount} bars</span></div>
            <div className="mt-2 h-1.5 rounded-full bg-white/[.06] overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-300" style={{width:Math.max(0,Math.min(100,(pair.directionalEfficiency ?? 0)*100))+'%'}}/></div>
            <div className="mt-2 flex justify-between text-[9px] text-slate-500"><span>Directional efficiency</span><b>{pair.directionalEfficiency === null ? '—' : (pair.directionalEfficiency*100).toFixed(1)+'%'}</b></div>
          </article>)}
        </div>
      </section>
      <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="sf-intel-section">
          <div className="sf-intel-section-heading"><div><h2>Memory systems</h2><p>Actual persisted learning records, not a synthetic intelligence score.</p></div><Database size={17}/></div>
          {[
            ['Episodic trade memories',d?.memory.episodicExperiences],
            ['Forensic loss autopsies',d?.memory.lossAutopsies],
            ['Resolved forward outcomes',d?.memory.resolvedPredictions],
            ['Pending predictions',d?.memory.pendingPredictions],
            ['Invalidated data records',d?.memory.invalidPredictions],
            ['Immutable learning events',d?.memory.events],
          ].map(([label,value])=><div key={String(label)} className="sf-intel-row"><span>{label}</span><b>{value ?? '—'}</b></div>)}
        </div>
        <div className="sf-intel-section">
          <div className="sf-intel-section-heading"><div><h2>Research engine</h2><p>Observed research throughput and review activity.</p></div><Dna size={17}/></div>
          {[
            ['Opportunities generated',d?.research.opportunities],
            ['Experiments recorded',d?.research.experiments],
            ['Evolution generations',d?.research.generations],
            ['Agent reviews',d?.research.agentReviews],
            ['Signals observed',d?.research.signalsObserved],
            ['Latest experiment',timeLabel(d?.research.latestExperimentAt)],
          ].map(([label,value])=><div key={String(label)} className="sf-intel-row"><span>{label}</span><b>{value ?? '—'}</b></div>)}
        </div>
      </section>
      <section className="sf-intel-section">
        <div className="sf-intel-section-heading"><div><h2>Research governance</h2><p>Safety and evidence constraints currently represented in the platform.</p></div><ShieldCheck size={18}/></div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {Object.entries(d?.governance || {}).map(([key,enabled])=><div key={key} className="sf-intel-governance"><span className={enabled?'governance-on':'governance-off'}>{enabled?'✓':'!'}</span><span>{key.replace(/([A-Z])/g,' $1').replaceAll('_',' ')}</span></div>)}
        </div>
        <div className="sf-intel-footnote">Last snapshot: {timeLabel(d?.generatedAt)}. These are implemented controls and recorded counts, not evidence of general intelligence. Broker execution remains disabled.</div>
      </section>
    </div>
  );
};
