import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Gauge,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  Workflow,
} from 'lucide-react';
import type {
  ModelEvidenceSummary,
  PaperExecutionSimulationInput,
  PaperExecutionSimulationResult,
  ResearchEvidenceStream,
  ResearchIntelligenceDashboard,
  ResearchOutcomeRecord,
  ResearchPredictionRecord,
} from '../../types/index.js';

const EMPTY_SIMULATION: PaperExecutionSimulationInput = {
  symbol: 'EUR/USD',
  direction: 'BUY',
  referenceEntryPrice: 1.10000,
  expiryPrice: 1.10100,
  payoutPct: 80,
  stakeUnits: 1,
  spreadPips: 1.1,
  slippagePips: 0.2,
  maximumSlippagePips: 2,
  entryLatencyMs: 3000,
  maximumDecisionDelayMs: 25000,
  assetAvailable: true,
  brokerRejected: false,
};

const pct = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : (value * 100).toFixed(1) + '%';
const number = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);
const dateLabel = (value?: string | null) => {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(value)) + ' IST';
};

function outcomeMap(outcomes: ResearchOutcomeRecord[]) {
  return new Map(outcomes.map(item => [item.predictionId, item]));
}

function PromotionStatus({ summary }: { summary: ModelEvidenceSummary }) {
  const label: Record<ModelEvidenceSummary['promotionStatus'], string> = {
    INSUFFICIENT_EVIDENCE: 'Collecting evidence',
    REJECTED: 'Gate not passed',
    DOES_NOT_BEAT_CHAMPION: 'Below champion',
    REVIEW_READY: 'Review ready',
    CURRENT_CHAMPION: 'Current champion',
  };
  const classes: Record<ModelEvidenceSummary['promotionStatus'], string> = {
    INSUFFICIENT_EVIDENCE: 'sf-intel-badge muted',
    REJECTED: 'sf-intel-badge danger',
    DOES_NOT_BEAT_CHAMPION: 'sf-intel-badge warn',
    REVIEW_READY: 'sf-intel-badge positive',
    CURRENT_CHAMPION: 'sf-intel-badge champion',
  };
  return <span className={classes[summary.promotionStatus]}>{label[summary.promotionStatus]}</span>;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
  tone = 'neutral',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  note: string;
  tone?: 'neutral' | 'green' | 'amber' | 'blue';
}) {
  return (
    <div className="sf-intel-metric">
      <div className="flex items-center justify-between gap-2">
        <span className="sf-intel-label">{label}</span>
        <Icon className={`h-4 w-4 ${tone === 'green' ? 'text-emerald-300' : tone === 'amber' ? 'text-amber-300' : tone === 'blue' ? 'text-sky-300' : 'text-neutral-500'}`} />
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-white">{value}</div>
      <div className="mt-1 text-[10px] leading-4 text-neutral-500">{note}</div>
    </div>
  );
}

export const ResearchIntelligenceView: React.FC = () => {
  const [dashboard, setDashboard] = useState<ResearchIntelligenceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [simulationInput, setSimulationInput] = useState<PaperExecutionSimulationInput>(EMPTY_SIMULATION);
  const [simulation, setSimulation] = useState<PaperExecutionSimulationResult | null>(null);
  const [promotionTarget, setPromotionTarget] = useState<ModelEvidenceSummary | null>(null);
  const [adminToken, setAdminToken] = useState('');
  const [promotionReason, setPromotionReason] = useState('');

  const loadDashboard = async (initial = false) => {
    if (initial) setLoading(true);
    else setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/intelligence/dashboard', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load research intelligence.');
      setDashboard(data as ResearchIntelligenceDashboard);
    } catch (err: any) {
      setError(err.message || 'Could not load research intelligence.');
    } finally {
      setLoading(false);
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadDashboard(true);
  }, []);

  const outcomesByPrediction = useMemo(
    () => outcomeMap(dashboard?.recentOutcomes || []),
    [dashboard?.recentOutcomes]
  );

  const reconcile = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/intelligence/reconcile', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Forward reconciliation failed.');
      setNotice(`Settled ${data.reconciliation.settled} forecasts. ${data.reconciliation.waitingForData} are waiting for exact real-market candles.`);
      await loadDashboard(false);
    } catch (err: any) {
      setError(err.message || 'Forward reconciliation failed.');
    } finally {
      setBusy(false);
    }
  };

  const runSimulation = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/intelligence/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simulationInput),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Simulation failed.');
      setSimulation(data.simulation as PaperExecutionSimulationResult);
      setNotice('Scenario saved to the paper-simulation history. No broker was contacted.');
      await loadDashboard(false);
    } catch (err: any) {
      setError(err.message || 'Simulation failed.');
    } finally {
      setBusy(false);
    }
  };

  const promoteChampion = async () => {
    if (!promotionTarget) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/intelligence/champion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-research-admin-token': adminToken,
        },
        body: JSON.stringify({
          stream: promotionTarget.stream,
          modelVersion: promotionTarget.modelVersion,
          reason: promotionReason,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Champion review was rejected.');
      setNotice(data.message);
      setPromotionTarget(null);
      setAdminToken('');
      setPromotionReason('');
      await loadDashboard(false);
    } catch (err: any) {
      setError(err.message || 'Champion review was rejected.');
    } finally {
      setBusy(false);
    }
  };

  const updateSimulation = <K extends keyof PaperExecutionSimulationInput>(
    key: K,
    value: PaperExecutionSimulationInput[K]
  ) => setSimulationInput(previous => ({ ...previous, [key]: value }));

  const regimeFresh = dashboard?.regimes.filter(item => item.dataFreshness === 'FRESH').length || 0;
  const pending = dashboard?.pendingCount || 0;
  const signalN = dashboard?.signalOutcomeCount || 0;
  const opportunityN = dashboard?.opportunityOutcomeCount || 0;

  if (loading) {
    return (
      <div className="sf-intelligence-view flex h-full items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-neutral-400">
          <RefreshCw className="h-4 w-4 animate-spin text-emerald-300" /> Loading forward research evidence…
        </div>
      </div>
    );
  }

  return (
    <div className="sf-intelligence-view flex h-full min-h-0 flex-col overflow-hidden">
      <header className="sf-intel-hero shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="sf-intel-kicker flex items-center gap-2"><BrainCircuit className="h-4 w-4" /> SIGNALFORGE / RESEARCH INTELLIGENCE</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Evidence, not confidence theatre.</h1>
            <p className="mt-2 max-w-2xl text-xs leading-6 text-neutral-400">
              A forward-only record of what each model predicted, what real market data later showed, and whether a challenger has earned human review. No automatic model promotion or broker execution.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void loadDashboard(false)} disabled={busy} className="sf-intel-secondary">
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> Refresh evidence
            </button>
            <button onClick={reconcile} disabled={busy} className="sf-intel-primary">
              <Activity className="h-3.5 w-3.5" /> Reconcile matured forecasts
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="sf-intel-live"><span /> Research ledger active</span>
          <span className="sf-intel-chip">Append-only outcomes</span>
          <span className="sf-intel-chip">Exact-candle replay</span>
          <span className="sf-intel-chip">Human-governed promotion</span>
          <span className="sf-intel-updated">As of {dateLabel(dashboard?.generatedAtUtc)}</span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
        {error && <div role="alert" className="sf-intel-alert danger">{error}</div>}
        {notice && <div role="status" aria-live="polite" className="sf-intel-alert">{notice}</div>}

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricCard icon={Workflow} label="Frozen predictions" value={(dashboard?.predictionCount || 0).toLocaleString('en-IN')} note="Snapshots captured at decision time" tone="blue" />
          <MetricCard icon={CheckCircle2} label="Forward outcomes" value={(dashboard?.settledCount || 0).toLocaleString('en-IN')} note={`${signalN} signal-ledger · ${opportunityN} market replays`} tone="green" />
          <MetricCard icon={Clock3} label="Awaiting exact candles" value={pending.toLocaleString('en-IN')} note="Missing data stays pending; no later candle substitution" tone="amber" />
          <MetricCard icon={Gauge} label="Fresh regimes" value={`${regimeFresh}/${dashboard?.regimes.length || 0}`} note="Only consecutive, closed real M1 candles count" tone="blue" />
        </section>

        <section className="mt-4 grid gap-3 xl:grid-cols-2">
          <div className="sf-intel-panel">
            <div className="sf-intel-panel-head">
              <div>
                <div className="sf-intel-overline">PROBABILITY QUALITY</div>
                <h2 className="sf-intel-heading">Forward calibration</h2>
              </div>
              <span className={`sf-intel-badge ${dashboard?.calibration.status === 'CALIBRATION_WARNING' ? 'warn' : dashboard?.calibration.status === 'MEASURED' ? 'positive' : 'muted'}`}>
                {dashboard?.calibration.status === 'MEASURED' ? 'Measured' : dashboard?.calibration.status === 'CALIBRATION_WARNING' ? 'Drift warning' : 'Collecting'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><div className="sf-intel-label">Scored samples</div><div className="sf-intel-value">{dashboard?.calibration.sampleSize || 0}</div></div>
              <div><div className="sf-intel-label">Validation tail</div><div className="sf-intel-value">{dashboard?.calibration.validationSampleSize || 0}</div></div>
              <div><div className="sf-intel-label">Brier score</div><div className="sf-intel-value">{number(dashboard?.calibration.brierScore, 4)}</div></div>
              <div><div className="sf-intel-label">Calibration error</div><div className="sf-intel-value">{pct(dashboard?.calibration.expectedCalibrationError)}</div></div>
            </div>
            <div className="sf-intel-divider" />
            <div className="grid grid-cols-2 gap-3">
              <div><div className="sf-intel-label">Mean predicted probability</div><div className="mt-1 text-lg font-semibold text-white">{pct(dashboard?.calibration.meanPredictedProbability)}</div></div>
              <div><div className="sf-intel-label">Observed win rate</div><div className="mt-1 text-lg font-semibold text-white">{pct(dashboard?.calibration.observedWinRate)}</div></div>
            </div>
            <p className="sf-intel-footnote">
              Only probability values frozen before the outcome are evaluated. Raw conviction scores and analogue win rates are never relabelled as probabilities.
            </p>
          </div>

          <div className="sf-intel-panel">
            <div className="sf-intel-panel-head">
              <div>
                <div className="sf-intel-overline">FORECAST REALITY CHECK</div>
                <h2 className="sf-intel-heading">Predicted path vs actual path</h2>
              </div>
              <span className={`sf-intel-badge ${dashboard?.forecastDiagnostics.status === 'MEASURED' ? 'positive' : 'muted'}`}>
                {dashboard?.forecastDiagnostics.status === 'MEASURED' ? 'Measured' : 'Collecting'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><div className="sf-intel-label">Replayed paths</div><div className="sf-intel-value">{dashboard?.forecastDiagnostics.sampleSize || 0}</div></div>
              <div><div className="sf-intel-label">Matched points</div><div className="sf-intel-value">{dashboard?.forecastDiagnostics.matchedPoints || 0}</div></div>
              <div><div className="sf-intel-label">10–90% coverage</div><div className="sf-intel-value">{pct(dashboard?.forecastDiagnostics.q10ToQ90Coverage)}</div></div>
              <div><div className="sf-intel-label">Median abs. error</div><div className="sf-intel-value">{number(dashboard?.forecastDiagnostics.medianAbsoluteErrorPips, 2)} pips</div></div>
            </div>
            <div className="sf-intel-divider" />
            <p className="sf-intel-footnote">
              Coverage is empirical: it measures how often replayed prices fell inside the frozen 10th–90th percentile band. A small sample is descriptive only, not calibration approval.
            </p>
          </div>
        </section>

        <section className="mt-4 sf-intel-panel">
          <div className="sf-intel-panel-head">
            <div>
              <div className="sf-intel-overline">CONTROLLED MODEL EVOLUTION</div>
              <h2 className="sf-intel-heading">Champion vs challenger</h2>
              <p className="sf-intel-subtitle">Separate evidence streams prevent signal outcomes and theoretical opportunity replays from being mixed.</p>
            </div>
            <span className="sf-intel-badge muted">300 decisive outcomes required</span>
          </div>
          <div className="overflow-x-auto">
            <table className="sf-intel-table">
              <thead><tr>
                <th>Evidence stream</th><th>Model</th><th>Settled</th><th>Win rate</th><th>Adjusted lower bound</th><th>EV / stake</th><th>Recent blocks</th><th>Governance</th>
              </tr></thead>
              <tbody>
                {(dashboard?.modelEvidence || []).map(item => (
                  <tr key={item.stream + item.modelVersion}>
                    <td><span className="sf-intel-smallcaps">{item.stream === 'SIGNAL_FORWARD' ? 'Signal observations' : 'Opportunity replays'}</span></td>
                    <td className="font-mono text-xs text-white">{item.modelVersion}</td>
                    <td className="tabular-nums">{item.decisiveCount}</td>
                    <td className="tabular-nums">{pct(item.winRate)}</td>
                    <td className="tabular-nums">{pct(item.adjustedLowerBound)}</td>
                    <td className="tabular-nums">{number(item.meanReturnUnits, 3)}</td>
                    <td className="tabular-nums">{item.lastThreeHundredBlockWinRates.length ? item.lastThreeHundredBlockWinRates.map(rate => pct(rate)).join(' / ') : '—'}</td>
                    <td>
                      <div className="flex flex-col items-start gap-1.5">
                        <PromotionStatus summary={item} />
                        {item.promotionStatus === 'REVIEW_READY' && (
                          <button onClick={() => setPromotionTarget(item)} className="text-[10px] font-semibold text-emerald-300 underline decoration-emerald-300/30 underline-offset-4 hover:text-emerald-200">
                            Review promotion
                          </button>
                        )}
                        <span className="max-w-[240px] text-[9px] leading-4 text-neutral-600">{item.promotionReasons[0]}</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {!dashboard?.modelEvidence.length && <tr><td colSpan={8} className="py-8 text-center text-xs text-neutral-500">No matured forward model evidence yet. New prediction snapshots will appear as the system runs.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="sf-intel-note">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-300" />
            Promotion is never automatic. A candidate must pass the multiple-comparison-adjusted lower bound, positive payout-adjusted returns, profit-factor and three consecutive 100-outcome block gates, then receive authenticated human approval.
          </div>
        </section>

        <section className="mt-4 grid gap-3 xl:grid-cols-[1.2fr_.8fr]">
          <div className="sf-intel-panel">
            <div className="sf-intel-panel-head">
              <div>
                <div className="sf-intel-overline">CONTEXT AT PREDICTION TIME</div>
                <h2 className="sf-intel-heading">Market regime intelligence</h2>
              </div>
              <span className="sf-intel-badge muted">Descriptive, not predictive</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(dashboard?.regimes || []).map(regime => (
                <div key={regime.symbol} className="sf-regime-card">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-white">{regime.symbol}</span>
                    <span className={`sf-regime-dot ${regime.dataFreshness === 'FRESH' ? 'fresh' : 'stale'}`} title={regime.dataFreshness} />
                  </div>
                  <div className="mt-2 text-xs font-semibold text-emerald-200">{regime.label.replaceAll('_', ' ')}</div>
                  <div className="mt-1 text-[10px] text-neutral-500">Efficiency {number(regime.directionalEfficiency, 2)} · Vol ratio {number(regime.volatilityRatio, 2)}</div>
                  <div className="mt-1 truncate text-[9px] text-neutral-600">{regime.reason}</div>
                </div>
              ))}
            </div>
            {!dashboard?.regimes.length && <div className="sf-intel-empty">No persisted real M1 regime observations yet.</div>}
            <p className="sf-intel-footnote">Regimes use the latest 60 uninterrupted, closed real M1 candles. Stale, synthetic, test or gap-contaminated data abstains as UNKNOWN.</p>
          </div>

          <div className="sf-intel-panel">
            <div className="sf-intel-panel-head">
              <div>
                <div className="sf-intel-overline">CONDITIONAL PERFORMANCE</div>
                <h2 className="sf-intel-heading">Regime evidence</h2>
              </div>
            </div>
            <div className="space-y-2">
              {(dashboard?.regimeEvidence || []).slice(0, 8).map(item => (
                <div key={item.stream + item.regime} className="sf-regime-evidence">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-neutral-200">{item.regime.replaceAll('_', ' ')}</div>
                    <div className="mt-0.5 text-[9px] text-neutral-500">{item.stream === 'SIGNAL_FORWARD' ? 'Signal' : 'Opportunity'} · n={item.sampleSize}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums text-white">{pct(item.winRate)}</div>
                    <div className="text-[9px] text-neutral-500">{number(item.meanReturnUnits, 3)} units/trade</div>
                  </div>
                </div>
              ))}
              {!dashboard?.regimeEvidence.length && <div className="sf-intel-empty">Regime-conditioned results will appear after forward outcomes settle.</div>}
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-3 xl:grid-cols-2">
          <div className="sf-intel-panel">
            <div className="sf-intel-panel-head">
              <div>
                <div className="sf-intel-overline">FAILURE MEMORY</div>
                <h2 className="sf-intel-heading">Where losses cluster</h2>
              </div>
              <span className="sf-intel-badge warn">Correlation ≠ cause</span>
            </div>
            <div className="space-y-2">
              {(dashboard?.failureClusters || []).slice(0, 8).map((item, index) => (
                <div key={index} className="sf-regime-evidence">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-neutral-200">{item.family}</div>
                    <div className="mt-0.5 text-[9px] text-neutral-500">{item.regime.replaceAll('_', ' ')} · {item.stream === 'SIGNAL_FORWARD' ? 'Signal' : 'Opportunity'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums text-rose-300">{item.losses}/{item.sampleSize}</div>
                    <div className="text-[9px] text-neutral-500">{pct(item.observedLossShare)} loss share</div>
                  </div>
                </div>
              ))}
              {!dashboard?.failureClusters.length && <div className="sf-intel-empty">Loss clusters require at least 20 observations and 5 losses. No causal explanation is inferred.</div>}
            </div>
            <p className="sf-intel-footnote">This panel preserves where errors concentrate. It does not claim that regime or family membership caused the loss.</p>
          </div>

          <div className="sf-intel-panel">
            <div className="sf-intel-panel-head">
              <div>
                <div className="sf-intel-overline">PAPER EXECUTION REALITY</div>
                <h2 className="sf-intel-heading">Friction & latency simulator</h2>
              </div>
              <span className="sf-intel-badge muted">Scenario only</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <label className="sf-intel-field">Pair
                <select value={simulationInput.symbol} onChange={event => updateSimulation('symbol', event.target.value as PaperExecutionSimulationInput['symbol'])}>
                  {['EUR/USD','GBP/USD','USD/JPY','EUR/JPY','AUD/USD','USD/CAD','EUR/GBP','GBP/JPY'].map(symbol => <option key={symbol} value={symbol}>{symbol}</option>)}
                </select>
              </label>
              <label className="sf-intel-field">Direction
                <select value={simulationInput.direction} onChange={event => updateSimulation('direction', event.target.value as 'BUY' | 'SELL')}>
                  <option value="BUY">BUY</option><option value="SELL">SELL</option>
                </select>
              </label>
              <label className="sf-intel-field">Payout %
                <input type="number" min="1" max="500" step="1" value={simulationInput.payoutPct} onChange={event => updateSimulation('payoutPct', Number(event.target.value))} />
              </label>
              <label className="sf-intel-field">Reference entry
                <input type="number" step={simulationInput.symbol.includes('JPY') ? '0.001' : '0.00001'} value={simulationInput.referenceEntryPrice} onChange={event => updateSimulation('referenceEntryPrice', Number(event.target.value))} />
              </label>
              <label className="sf-intel-field">Expiry price
                <input type="number" step={simulationInput.symbol.includes('JPY') ? '0.001' : '0.00001'} value={simulationInput.expiryPrice} onChange={event => updateSimulation('expiryPrice', Number(event.target.value))} />
              </label>
              <label className="sf-intel-field">Stake (units)
                <input type="number" min="0.01" step="0.1" value={simulationInput.stakeUnits} onChange={event => updateSimulation('stakeUnits', Number(event.target.value))} />
              </label>
              <label className="sf-intel-field">Spread (pips)
                <input type="number" min="0" step="0.1" value={simulationInput.spreadPips} onChange={event => updateSimulation('spreadPips', Number(event.target.value))} />
              </label>
              <label className="sf-intel-field">Slippage (pips)
                <input type="number" min="0" step="0.1" value={simulationInput.slippagePips} onChange={event => updateSimulation('slippagePips', Number(event.target.value))} />
              </label>
              <label className="sf-intel-field">Max slippage
                <input type="number" min="0" step="0.1" value={simulationInput.maximumSlippagePips} onChange={event => updateSimulation('maximumSlippagePips', Number(event.target.value))} />
              </label>
              <label className="sf-intel-field">Entry latency (ms)
                <input type="number" min="0" step="100" value={simulationInput.entryLatencyMs} onChange={event => updateSimulation('entryLatencyMs', Number(event.target.value))} />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-neutral-400">
              <label className="flex items-center gap-2"><input type="checkbox" checked={simulationInput.assetAvailable} onChange={event => updateSimulation('assetAvailable', event.target.checked)} /> Asset available</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={simulationInput.brokerRejected} onChange={event => updateSimulation('brokerRejected', event.target.checked)} /> Simulate broker rejection</label>
            </div>
            <button onClick={runSimulation} disabled={busy} className="sf-intel-primary mt-3 w-full justify-center">
              <Target className="h-3.5 w-3.5" /> Run paper scenario
            </button>
            {simulation && (
              <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-white">{simulation.status.replaceAll('_', ' ')}</span>
                  <span className={`sf-intel-badge ${simulation.result === 'WIN' ? 'positive' : simulation.result === 'LOSS' ? 'danger' : 'muted'}`}>{simulation.result || 'Not settled'}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                  <div><div className="text-neutral-500">Simulated entry</div><div className="mt-1 font-mono text-neutral-200">{number(simulation.simulatedEntryPrice, simulation.input.symbol.includes('JPY') ? 3 : 5)}</div></div>
                  <div><div className="text-neutral-500">Friction</div><div className="mt-1 text-neutral-200">{number(simulation.frictionPips, 2)} pips</div></div>
                  <div><div className="text-neutral-500">P/L units</div><div className="mt-1 text-neutral-200">{number(simulation.pnlUnits, 3)}</div></div>
                </div>
              </div>
            )}
            <p className="sf-intel-footnote">No network, broker session, order or live fill is used. This cannot model actual broker quote behavior unless independently measured inputs are supplied.</p>
          </div>
        </section>

        <section className="mt-4 sf-intel-panel">
          <div className="sf-intel-panel-head">
            <div>
              <div className="sf-intel-overline">IMMUTABLE RESEARCH JOURNAL</div>
              <h2 className="sf-intel-heading">Prediction ledger</h2>
              <p className="sf-intel-subtitle">The prediction row is frozen at decision time. A separate settlement row records the later observed result.</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="sf-intel-table">
              <thead><tr><th>Decision time</th><th>Pair</th><th>Source / family</th><th>Direction</th><th>Model</th><th>Regime</th><th>Entry → expiry</th><th>Outcome</th><th>Settled</th></tr></thead>
              <tbody>
                {(dashboard?.recentPredictions || []).slice(0, 25).map(item => {
                  const outcome = outcomesByPrediction.get(item.id);
                  return (
                    <tr key={item.id}>
                      <td className="whitespace-nowrap">{dateLabel(item.decisionTimeUtc)}</td>
                      <td className="font-mono text-xs text-white">{item.symbol}</td>
                      <td><div className="text-[10px] text-neutral-200">{item.source}</div><div className="text-[9px] text-neutral-600">{item.family}</div></td>
                      <td className={item.direction === 'BUY' ? 'text-emerald-300' : item.direction === 'SELL' ? 'text-rose-300' : 'text-neutral-500'}>{item.direction}</td>
                      <td className="font-mono text-[10px]">{item.modelVersion}</td>
                      <td>{item.marketRegimeAtPrediction.replaceAll('_', ' ')}</td>
                      <td className="whitespace-nowrap">{dateLabel(item.entryTimeUtc)}<div className="text-[9px] text-neutral-600">{item.horizonMinutes}m</div></td>
                      <td>{outcome ? <span className={`sf-intel-badge ${outcome.result === 'WIN' ? 'positive' : outcome.result === 'LOSS' ? 'danger' : 'muted'}`}>{outcome.result}</span> : <span className="sf-intel-badge muted">Pending</span>}</td>
                      <td>{outcome ? dateLabel(outcome.settledAtUtc) : '—'}</td>
                    </tr>
                  );
                })}
                {!dashboard?.recentPredictions.length && <tr><td colSpan={9} className="py-8 text-center text-xs text-neutral-500">The forward ledger starts capturing new signal and opportunity predictions after this version is deployed. Legacy history is not retroactively relabelled as forward evidence.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-4 sf-intel-panel">
          <div className="sf-intel-panel-head">
            <div>
              <div className="sf-intel-overline">HUMAN GOVERNANCE</div>
              <h2 className="sf-intel-heading">Approved research champions</h2>
            </div>
            <LockKeyhole className="h-4 w-4 text-neutral-500" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(dashboard?.champions || []).map(champion => (
              <div key={champion.stream} className="sf-regime-card">
                <div className="text-[9px] uppercase tracking-widest text-neutral-500">{champion.stream.replaceAll('_', ' ')}</div>
                <div className="mt-1 font-mono text-sm text-white">{champion.modelVersion}</div>
                <div className="mt-1 text-[10px] text-neutral-500">Approved {dateLabel(champion.promotedAtUtc)} · n={champion.evidenceSnapshot.decisiveCount}</div>
                <div className="mt-1 text-[10px] text-neutral-400">{champion.reason}</div>
              </div>
            ))}
            {!dashboard?.champions.length && <div className="sf-intel-empty sm:col-span-2">No champion has been manually approved. Models remain challengers until they earn the evidence gates and an authenticated operator signs off.</div>}
          </div>
        </section>
      </div>

      {promotionTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d1620] p-5 shadow-2xl">
            <div className="flex items-center gap-2 text-emerald-300"><ShieldCheck className="h-4 w-4" /><span className="text-[10px] font-bold uppercase tracking-widest">Authenticated human review</span></div>
            <h3 className="mt-2 text-xl font-semibold text-white">Promote {promotionTarget.modelVersion}?</h3>
            <p className="mt-2 text-xs leading-5 text-neutral-400">This changes the research champion record only. It does not enable signals, broker access or automatic execution. The model passed the current statistical gates; the operator must still decide.</p>
            <label className="sf-intel-field mt-4">Reason for approval
              <textarea rows={3} value={promotionReason} onChange={event => setPromotionReason(event.target.value)} placeholder="Record the rationale for accepting this challenger…" />
            </label>
            <label className="sf-intel-field mt-3">Operator admin token
              <input type="password" autoComplete="off" value={adminToken} onChange={event => setAdminToken(event.target.value)} placeholder="RESEARCH_ADMIN_TOKEN" />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPromotionTarget(null)} className="sf-intel-secondary">Cancel</button>
              <button onClick={promoteChampion} disabled={busy || promotionReason.trim().length < 12 || !adminToken} className="sf-intel-primary">
                {busy ? 'Submitting…' : 'Confirm human approval'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
