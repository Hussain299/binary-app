import React, { useState, useEffect } from 'react';
import {
  Compass,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Target,
  Shield,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
  Timer,
  Brain,
  Lightbulb,
  TrendingUp,
  X,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Sparkles,
  Trash2,
  Globe,
  Layers,
  Dna,
  Cpu,
  Microscope,
} from 'lucide-react';
import { AutopilotLog, MarketSessionInfo, ResearchSignal, SynthesizedStrategyGene, LossAutopsy, FOREX_PAIRS, StrategyPerformanceRecord } from '../../types/index.js';
import { AutopilotStream } from '../AutopilotStream.tsx';
import { SignalCard } from '../SignalCard.tsx';

interface EvolutionTelemetry {
  timestamp: string;
  researchCoordinator: {
    status: 'IDLE' | 'SCANNING' | 'WAITING_FOR_HISTORY' | 'WAITING_FOR_NEW_HISTORY' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    symbol?: string;
    batchId?: string;
    startedAt?: string;
    finishedAt?: string;
    checkedAt?: string;
    nextScanAt?: string;
    completedCandidates: number;
    totalCandidates: number;
    historicalPasses: number;
    rejected: number;
    finalists: number;
    message: string;
    error?: string;
    batchRunning: boolean;
    scanIntervalMinutes: number;
    marketPulseSeconds: number;
    requiredNewM1Candles: number;
    historyWindowLimit: number;
  };
  generations: Array<{
    researchBatchId?: string;
    status?: 'COMPLETED' | 'FAILED';
    symbol?: string;
    timestamp: string;
    totalExperiments: number;
    acceptedCount: number;
    rejectedCount: number;
    summary: string;
    bestValidationExpectedValueUnits?: number;
    holdoutPeriod?: { start: string; end: string };
  }>;
  learning: {
    posterior: string;
    selection: string;
    decisiveUpdates: number;
    strategyCount: number;
  };
  episodicMemory: {
    storedTrades: number;
    featureDimensions: number;
    nearestNeighbors: number;
    futureOutcomesExcluded: boolean;
  };
  regimes: Array<{
    symbol: string;
    session: string;
    regime: string;
    directionalEfficiency: number | null;
    atrRatio: number | null;
    observationCount: number;
    reason: string;
    assessedAt: string;
  }>;
  strategies: Array<{
    strategyId: string;
    alpha: number;
    beta: number;
    posteriorWinRate: number;
    decisiveOutcomes: number;
    bayesianUcbScore: number;
    wins: number;
    losses: number;
    scratches: number;
    netReturnUnits: number;
    updatedAt: string;
  }>;
}

interface StrategySearchProgress {
  jobId: string;
  symbol: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  total: number;
  completed: number;
  passedHistorical: number;
  insufficientSample: number;
  rejected: number;
  replicationFinalists: number;
  approvedCount: number;
  error?: string;
}

interface SignalTerminalViewProps {
  signals: ResearchSignal[];
  autopilotLogs?: AutopilotLog[];
  onEvaluateSignals: () => void;
  isEvaluating: boolean;
}

export const SignalTerminalView: React.FC<SignalTerminalViewProps> = ({
  signals,
  autopilotLogs = [],
  onEvaluateSignals,
  isEvaluating,
}) => {
  const [filterState, setFilterState] = useState<'ACTIVE' | 'ALL' | 'CLOSED'>('ACTIVE');
  const [selectedSignal, setSelectedSignal] = useState<ResearchSignal | null>(null);
  const [selectedAutopsy, setSelectedAutopsy] = useState<LossAutopsy | null>(null);
  const [showLearningModal, setShowLearningModal] = useState<boolean>(false);
  const [showStrategiesModal, setShowStrategiesModal] = useState<boolean>(false);
  const [showSessionsModal, setShowSessionsModal] = useState<boolean>(false);
  const [showGenesisModal, setShowGenesisModal] = useState<boolean>(false);
  const [showLogsAccordion, setShowLogsAccordion] = useState<boolean>(false);
  const [isClearingHistory, setIsClearingHistory] = useState<boolean>(false);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [sessionData, setSessionData] = useState<MarketSessionInfo[]>([]);
  const [sessionMarketTime, setSessionMarketTime] = useState<{ marketOpen: boolean; marketStatus: string; marketMessage: string } | null>(null);
  const [synthesizedStrategies, setSynthesizedStrategies] = useState<SynthesizedStrategyGene[]>([]);
  const [strategyPerformance, setStrategyPerformance] = useState<StrategyPerformanceRecord[]>([]);
  const [evolutionTelemetry, setEvolutionTelemetry] = useState<EvolutionTelemetry | null>(null);
  const [evolutionTelemetryError, setEvolutionTelemetryError] = useState<string>('');
  const [isEvolvingStrategy, setIsEvolvingStrategy] = useState<boolean>(false);
  const [searchJob, setSearchJob] = useState<StrategySearchProgress | null>(null);
  const [historyImportPair, setHistoryImportPair] = useState<string>('EUR/USD');
  const [isImportingHistory, setIsImportingHistory] = useState<boolean>(false);
  const [historyImportMessage, setHistoryImportMessage] = useState<string>('');
  const [nowMs, setNowMs] = useState<number>(Date.now());

  // Real-time 1-second ticking timer for candle countdowns
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync session accuracy breakdown
  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions/accuracy');
      if (res.ok) {
        const data = await res.json();
        if (data?.sessions) setSessionData(data.sessions);
        if (data?.marketTime) setSessionMarketTime(data.marketTime);
      }
    } catch (e) {
      console.warn('Failed to fetch session accuracy:', e);
    }
  };

  // Sync synthesized evolutionary strategies
  const fetchSynthesizedStrategies = async () => {
    try {
      const res = await fetch('/api/strategies/synthesized');
      if (res.ok) {
        const data = await res.json();
        if (data?.strategies) setSynthesizedStrategies(data.strategies);
      }
    } catch (e) {
      console.warn('Failed to fetch synthesized strategies:', e);
    }
  };

  const fetchStrategyPerformance = async () => {
    try {
      const res = await fetch('/api/strategies/performance');
      if (res.ok) {
        const data = await res.json();
        if (data?.strategies) setStrategyPerformance(data.strategies);
      }
    } catch (e) {
      console.warn('Failed to fetch forward strategy performance:', e);
    }
  };

  const fetchEvolutionTelemetry = async () => {
    try {
      const res = await fetch('/api/evolution/state');
      if (!res.ok) throw new Error('Evolution telemetry endpoint returned ' + res.status);
      const data = await res.json();
      setEvolutionTelemetry(data);
      setEvolutionTelemetryError('');
    } catch (e: any) {
      setEvolutionTelemetryError(e?.message || 'Could not load persisted learning state.');
    }
  };

  const getForwardPerformance = (strategyId?: string) =>
    strategyPerformance.find(item => item.strategyId === (strategyId || '')) || null;

  useEffect(() => {
    fetchSessions();
    fetchSynthesizedStrategies();
    fetchStrategyPerformance();
    fetchEvolutionTelemetry();
  }, [signals]);

  const handleEvolveStrategy = async () => {
    setIsEvolvingStrategy(true);
    setHistoryImportMessage('');
    try {
      const res = await fetch('/api/strategies/search-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: historyImportPair }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Evolution search could not start.');
      setSearchJob(data);
      setHistoryImportMessage(
        `Evolution started for ${data.symbol}: 300 symbolic candidates will be measured on chronological train/validation data; only preselected finalists reach the untouched test.`
      );
    } catch (error: any) {
      setHistoryImportMessage(error?.message || 'Evolution search could not start.');
      setIsEvolvingStrategy(false);
    }
  };

  useEffect(() => {
    if (!searchJob?.jobId || searchJob.status !== 'RUNNING') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const res = await fetch(`/api/strategies/search-batch/${encodeURIComponent(searchJob.jobId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not read evolution progress.');
        if (cancelled) return;
        setSearchJob(data);
        if (data.status === 'RUNNING') {
          setHistoryImportMessage(
            `Evolution ${data.symbol}: ${data.completed}/${data.total} candidates evaluated · ${data.passedHistorical} passed the historical gates · ${data.replicationFinalists} finalists opened for untouched testing.`
          );
          timer = setTimeout(poll, 1500);
          return;
        }
        setIsEvolvingStrategy(false);
        if (data.status === 'COMPLETED') {
          setHistoryImportMessage(
            `Completed ${data.total} candidates for ${data.symbol}. Historical survivors: ${data.passedHistorical}; finalists tested on the untouched holdout: ${data.replicationFinalists}. Forward approval still requires independent paper outcomes.`
          );
          await fetchSynthesizedStrategies();
          await fetchStrategyPerformance();
          await fetchEvolutionTelemetry();
        } else {
          setHistoryImportMessage(data.error || 'Evolution search failed. No accuracy was assigned to unvalidated candidates.');
        }
      } catch (error: any) {
        if (cancelled) return;
        setIsEvolvingStrategy(false);
        setHistoryImportMessage(error?.message || 'Evolution progress could not be read.');
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [searchJob?.jobId, searchJob?.status]);

  const parseCsvLine = (line: string): string[] => {
    const cells: string[] = [];
    let value = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"' && quoted) { value += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { cells.push(value.trim()); value = ''; }
      else value += ch;
    }
    cells.push(value.trim());
    return cells;
  };

  const handleImportHistoricalFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImportingHistory(true);
    setHistoryImportMessage('');
    try {
      const rawText = await file.text();
      let candles: any[] = [];
      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(rawText);
        candles = Array.isArray(parsed) ? parsed : (parsed.candles || parsed.data || []);
      } else {
        const lines = rawText.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length < 2) throw new Error('CSV must include a header row and at least one candle.');
        const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase().replace(/[ _-]/g, ''));
        const indexOf = (...names: string[]) => headers.findIndex(h => names.includes(h));
        const timeIndex = indexOf('timestamp', 'time', 'date', 'datetime', 'gmttime', 'timestampms');
        const openIndex = indexOf('open', 'o');
        const highIndex = indexOf('high', 'h');
        const lowIndex = indexOf('low', 'l');
        const closeIndex = indexOf('close', 'c');
        const volumeIndex = indexOf('volume', 'vol', 'v');
        if ([timeIndex, openIndex, highIndex, lowIndex, closeIndex].some(i => i < 0)) {
          throw new Error('CSV headers must contain timestamp/time, open, high, low and close columns.');
        }
        candles = lines.slice(1).map(line => {
          const cells = parseCsvLine(line);
          return {
            timestamp: cells[timeIndex],
            open: Number(cells[openIndex]),
            high: Number(cells[highIndex]),
            low: Number(cells[lowIndex]),
            close: Number(cells[closeIndex]),
            volume: volumeIndex >= 0 ? Number(cells[volumeIndex]) : 0,
          };
        });
      }
      if (!candles.length) throw new Error('No candle rows were found in the selected file.');
      const batchSize = 20_000;
      let imported = 0;
      let rejected = 0;
      let totalStored = 0;
      for (let offset = 0; offset < candles.length; offset += batchSize) {
        const batch = candles.slice(offset, offset + batchSize);
        const res = await fetch('/api/research/candles/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: historyImportPair, candles: batch }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Historical import failed at row ${offset + 1}.`);
        imported += data.result.imported;
        rejected += data.result.rejected;
        totalStored = data.result.totalStored;
        setHistoryImportMessage(
          `Importing ${historyImportPair}: ${Math.min(offset + batch.length, candles.length).toLocaleString()} / ${candles.length.toLocaleString()} rows processed…`
        );
      }
      setHistoryImportMessage(
        `Imported ${imported.toLocaleString()} valid candles for ${historyImportPair}. Stored total: ${totalStored.toLocaleString()}. Rejected rows: ${rejected}.`
      );
    } catch (error: any) {
      setHistoryImportMessage(error.message || 'Could not import historical candles.');
    } finally {
      setIsImportingHistory(false);
      event.target.value = '';
    }
  };

  const validatedGenes = synthesizedStrategies.filter(
    gene => gene.accuracyStatus === 'BACKTESTED' && !!gene.backtestMetrics
  );
  const validatedGeneCount = validatedGenes.length;
  const paperTradingGeneCount = synthesizedStrategies.filter(gene => gene.status === 'PAPER_TRADING').length;

  // The terminal surfaces the next exact T-3m decision window for every supported start candle.
  const START_TIMEFRAMES = [5, 10, 15, 20, 25, 30] as const;
  const nextDecisionSchedules = START_TIMEFRAMES.map(timeframeMinutes => {
    const intervalMs = timeframeMinutes * 60_000;
    let entryTimeMs = (Math.floor(nowMs / intervalMs) + 1) * intervalMs;
    let decisionTimeMs = entryTimeMs - 3 * 60_000;
    while (decisionTimeMs + 25_000 <= nowMs) {
      entryTimeMs += intervalMs;
      decisionTimeMs += intervalMs;
    }
    return {
      timeframeMinutes,
      entryTimeMs,
      decisionTimeMs,
      windowActive: nowMs >= decisionTimeMs && nowMs < decisionTimeMs + 25_000,
    };
  });
  const activeDecisionTime = nextDecisionSchedules
    .filter(item => item.windowActive)
    .map(item => item.decisionTimeMs)
    .sort((a, b) => a - b)[0];
  const nextDecisionTimeMs = activeDecisionTime ?? Math.min(...nextDecisionSchedules.map(item => item.decisionTimeMs));
  const nextDecisionGroup = nextDecisionSchedules.filter(item => item.decisionTimeMs === nextDecisionTimeMs);
  const nextDecisionActive = nextDecisionGroup.some(item => item.windowActive);
  const nextEntryMs = nextDecisionGroup[0]?.entryTimeMs ?? nowMs;
  const nextEntryIST = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(new Date(nextEntryMs)).toUpperCase() + ' IST';
  const formatCountdown = (milliseconds: number) => {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  };
  const nextDecisionCountdown = nextDecisionActive
    ? formatCountdown(nextDecisionTimeMs + 25_000 - nowMs)
    : formatCountdown(nextDecisionTimeMs - nowMs);
  const nextEntryCountdown = formatCountdown(nextEntryMs - nowMs);
  const nextDecisionTimeframes = nextDecisionGroup.map(item => `${item.timeframeMinutes}M`).join(' / ');

  const getEntryCountdown = (entryTimeUtc?: string | null) => {
    if (!entryTimeUtc) return 'Entry time unavailable';
    const diffMs = Date.parse(entryTimeUtc) - nowMs;
    if (!Number.isFinite(diffMs)) return 'Entry time unavailable';
    if (diffMs <= 0) return 'Entry boundary passed';
    return `Opens in ${formatCountdown(diffMs)}`;
  };

  const formatIST = (isoString?: string | null) => {
    if (!isoString) return 'At Candle Open';
    try {
      const d = new Date(isoString);
      return (
        new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }).format(d).toUpperCase() + ' IST'
      );
    } catch {
      return isoString;
    }
  };

  // Overall scorecard counts every verified forward paper outcome.
  // Evolved-genome-only metrics remain separate for the Evolution review.
  const historySignals = signals.filter(s =>
    ['CLOSED', 'EXPIRED', 'INVALIDATED'].includes(s.lifecycleState)
  );
  const allCompletedSignals = signals.filter(s =>
    s.lifecycleState === 'CLOSED' &&
    ['WIN', 'LOSS', 'SCRATCH'].includes(s.outcomeResult)
  );
  const allScoredSignals = allCompletedSignals.filter(s => ['WIN', 'LOSS'].includes(s.outcomeResult));
  const totalWins = allScoredSignals.filter(s => s.outcomeResult === 'WIN').length;
  const totalLosses = allScoredSignals.filter(s => s.outcomeResult === 'LOSS').length;
  const calculatedWinRate = allScoredSignals.length > 0
    ? ((totalWins / allScoredSignals.length) * 100).toFixed(1)
    : 'No scored forward outcomes';
  const totalNetReturnUnits = Number(
    allCompletedSignals.reduce((acc, signal) => acc + (signal.netReturnUnits ?? 0), 0).toFixed(3)
  );

  const completedSignals = allCompletedSignals.filter(s =>
    s.isNovelAiSynthesized === true && !!s.synthesizedGeneId
  );
  const evolvedScoredSignals = completedSignals.filter(s => ['WIN', 'LOSS'].includes(s.outcomeResult));
  const evolvedTotalWins = evolvedScoredSignals.filter(s => s.outcomeResult === 'WIN').length;
  const evolvedTotalLosses = evolvedScoredSignals.filter(s => s.outcomeResult === 'LOSS').length;
  const evolvedCalculatedWinRate = evolvedScoredSignals.length > 0
    ? ((evolvedTotalWins / evolvedScoredSignals.length) * 100).toFixed(1)
    : 'No scored evolved outcomes';
  const evolvedNetReturnUnits = Number(
    completedSignals.reduce((acc, signal) => acc + (signal.netReturnUnits ?? 0), 0).toFixed(3)
  );
  const archivedRuleBasedOutcomes = allCompletedSignals.length - completedSignals.length;

  const activeSignals = signals.filter(s =>
    ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE', 'EXIT_PENDING'].includes(s.lifecycleState)
  );

  const filteredSignals = signals.filter(s => {
    if (filterState === 'ACTIVE') {
      return ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE', 'EXIT_PENDING'].includes(
        s.lifecycleState
      );
    }
    if (filterState === 'CLOSED') {
      return ['CLOSED', 'EXPIRED', 'INVALIDATED'].includes(s.lifecycleState);
    }
    return true;
  });

  const handleClearHistory = async () => {
    setIsClearingHistory(true);
    try {
      await fetch('/api/signals/clear-history', { method: 'POST' });
      onEvaluateSignals();
      setShowClearConfirm(false);
    } catch (err) {
      console.error('Failed to clear history:', err);
    } finally {
      setIsClearingHistory(false);
    }
  };

  const getSignalAge = (isoString: string) => {
    const diffSec = Math.max(0, Math.floor((nowMs - Date.parse(isoString)) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const mins = Math.floor(diffSec / 60);
    const secs = diffSec % 60;
    return `${mins}m ${secs}s ago`;
  };

  const getRemainingTime = (exitTimeIso: string | null) => {
    if (!exitTimeIso) return '05m 00s';
    const diffSec = Math.floor((Date.parse(exitTimeIso) - nowMs) / 1000);
    if (diffSec <= 0) return '00m 00s (Closing...)';
    const mins = Math.floor(diffSec / 60);
    const secs = diffSec % 60;
    return `${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-transparent font-sans text-neutral-100">
      <section className="sf-signals-hero shrink-0 px-4 sm:px-6 py-5 sm:py-6">
        <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-5">
          <div className="min-w-0">
            <div className="text-[10px] font-bold tracking-[.2em] text-emerald-300/80 uppercase">
              SignalForge · Research workspace · Paper mode
            </div>
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl sm:text-[30px] font-semibold tracking-[-.045em] text-white">
                Signal monitor
              </h1>
              <span className="sf-signals-paper">PAPER ONLY</span>
            </div>
            <p className="mt-1.5 max-w-2xl text-xs sm:text-[13px] leading-6 text-slate-400">
              Live research observations, exact entry windows and verified outcomes. Missing market data stays unscored.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 xl:justify-end">
            <div className="min-w-[205px] rounded-xl border border-white/[.08] bg-white/[.035] px-4 py-3">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.14em] text-slate-400">
                <span className={`h-1.5 w-1.5 rounded-full ${nextDecisionActive ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                {nextDecisionActive ? 'Decision window closes' : 'Next decision window'}
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="font-mono text-xl font-semibold tabular-nums text-white">{nextDecisionCountdown}</span>
                <span className="text-[10px] text-slate-500">T−3m</span>
              </div>
              <div className="mt-1 text-[10px] text-slate-500">
                {nextDecisionTimeframes} · Entry {nextEntryIST}
              </div>
            </div>
            <button
              onClick={onEvaluateSignals}
              disabled={isEvaluating}
              className="sf-signals-sync"
              title="Reconcile signals using trusted market candles"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isEvaluating ? 'animate-spin' : ''}`} />
              {isEvaluating ? 'Syncing' : 'Sync outcomes'}
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 xl:grid-cols-4 gap-2.5">
          <div className="sf-signals-metric">
            <span>Open / verifying</span>
            <strong>{activeSignals.length}</strong>
            <small>Scheduled, active or awaiting data</small>
          </div>
          <div className="sf-signals-metric">
            <span>Settled observations</span>
            <strong>{allCompletedSignals.length}</strong>
            <small>Exact expiry candle verified</small>
          </div>
          <div className="sf-signals-metric">
            <span>Win rate</span>
            <strong>{allScoredSignals.length ? `${calculatedWinRate}%` : '—'}</strong>
            <small>{totalWins} wins · {totalLosses} losses</small>
          </div>
          <div className="sf-signals-metric">
            <span>Net paper return</span>
            <strong className={totalNetReturnUnits > 0 ? 'text-emerald-300' : totalNetReturnUnits < 0 ? 'text-rose-300' : ''}>
              {totalNetReturnUnits > 0 ? '+' : ''}{totalNetReturnUnits.toFixed(3)}
            </strong>
            <small>Stake units · assumed payout basis</small>
          </div>
        </div>
      </section>

      <div className="sf-signals-toolbar shrink-0 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-white/[.07] bg-black/20 p-1">
          <button
            onClick={() => setFilterState('ACTIVE')}
            className={`sf-signals-tab ${filterState === 'ACTIVE' ? 'is-active' : ''}`}
          >
            Open <span>{activeSignals.length}</span>
          </button>
          <button
            onClick={() => setFilterState('ALL')}
            className={`sf-signals-tab ${filterState === 'ALL' ? 'is-active' : ''}`}
          >
            All <span>{signals.length}</span>
          </button>
          <button
            onClick={() => setFilterState('CLOSED')}
            className={`sf-signals-tab ${filterState === 'CLOSED' ? 'is-active' : ''}`}
          >
            History <span>{historySignals.length}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {filterState === 'CLOSED' && historySignals.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              disabled={isClearingHistory}
              className="sf-signals-action text-rose-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {isClearingHistory ? 'Clearing' : 'Clear history'}
            </button>
          )}
          <button onClick={() => setShowGenesisModal(true)} className="sf-signals-action">
            <Dna className="h-3.5 w-3.5 text-cyan-300" />
            Candidates
            <span className="sf-signals-action-count">{synthesizedStrategies.filter(item => item.status === 'PROMOTED_ACTIVE').length}</span>
          </button>
          <button onClick={() => setShowSessionsModal(true)} className="sf-signals-action">
            <Globe className="h-3.5 w-3.5 text-slate-400" />
            Sessions
            <span className={`sf-signals-market ${sessionMarketTime?.marketOpen === false ? 'is-closed' : ''}`}>
              {sessionMarketTime?.marketOpen === false ? 'Closed' : sessionData.find(item => item.isActive)?.shortName || 'Live'}
            </span>
          </button>
          <button onClick={() => { setShowLearningModal(true); fetchEvolutionTelemetry(); }} className="sf-signals-action">
            <Brain className="h-3.5 w-3.5 text-emerald-300" />
            Evolution state
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5">
        <div className="mx-auto w-full max-w-[1500px] space-y-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                {filterState === 'ACTIVE' ? 'Current observations' : filterState === 'CLOSED' ? 'Outcome history' : 'All observations'}
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {filterState === 'ACTIVE'
                  ? 'Each row shows its next required state or verification step.'
                  : 'Only exact, source-verified expiry candles count as wins, losses or pushes.'}
              </p>
            </div>
            <span className="text-[10px] font-mono text-slate-500">{filteredSignals.length} records</span>
          </div>

          {filteredSignals.length === 0 ? (
            <div className="sf-signals-empty">
              <div className="sf-signals-empty-mark"><Activity className="h-5 w-5" /></div>
              <h3>{filterState === 'CLOSED' ? 'No verified outcomes yet' : 'No open observations'}</h3>
              <p>
                {filterState === 'CLOSED'
                  ? 'When an exact expiry M1 candle is available, the verified result will appear here. Missing candles are never guessed.'
                  : 'The monitor will list a setup when a valid T−3m decision window produces a research signal.'}
              </p>
              <button onClick={() => setFilterState(filterState === 'CLOSED' ? 'ALL' : 'ALL')} className="sf-signals-empty-action">
                View all observations
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredSignals.map(signal => (
                <SignalCard
                  key={signal.id}
                  signal={signal}
                  nowMs={nowMs}
                  formatIST={formatIST}
                  onSelect={() => setSelectedSignal(signal)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 4. OPTIONAL LIVE AUTOPILOT STREAM (COLLAPSIBLE AT BOTTOM) */}
        <div className="mt-6 border border-neutral-800/80 rounded-xl bg-neutral-900/40 overflow-hidden">
          <button
            onClick={() => setShowLogsAccordion(prev => !prev)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-mono text-neutral-400 hover:text-white transition-colors"
          >
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>Research Engine Activity ({autopilotLogs.length} events)</span>
            </div>
            {showLogsAccordion ? (
              <ChevronUp className="w-4 h-4 text-neutral-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-neutral-500" />
            )}
          </button>
          {showLogsAccordion && (
            <div className="p-3 border-t border-neutral-800/80">
              <AutopilotStream logs={autopilotLogs} activeSignalsCount={activeSignals.length} />
            </div>
          )}
        </div>
      </div>

      {/* MODAL 1: WHAT MACHINE LEARNING IS LEARNING (PLAIN ENGLISH) */}
      {showLearningModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-xl w-full p-5 sm:p-6 text-neutral-200 space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <Brain className="w-6 h-6 text-emerald-400" />
                <h3 className="text-lg font-bold text-white">Evolution & Learning State</h3>
              </div>
              <button
                onClick={() => setShowLearningModal(false)}
                className="text-neutral-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs sm:text-sm text-neutral-300 leading-relaxed">
              <div className="bg-neutral-950 p-3.5 rounded-xl border border-purple-800/80 space-y-2">
                <span className="font-bold text-purple-400 block text-sm flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  1. Symbolic Genome Activation (Strength Score, Not Win Probability)
                </span>
                <p>
                  The current candidate engine evaluates each stored symbolic genome against causal, normalized market features. Its activation score controls whether a candidate fires; it is not a calibrated probability of winning. Performance is calculated separately from untouched historical tests and evolved-genome forward paper outcomes.
                </p>
              </div>

              <div className="bg-neutral-950 p-3.5 rounded-xl border border-cyan-800/80 space-y-2">
                <span className="font-bold text-cyan-400 block text-sm flex items-center gap-1.5">
                  <Globe className="w-4 h-4" />
                  2. Session-Segmented Calibration (Asia / London / Overlap / New York)
                </span>
                <p>
                  Completed forward paper outcomes are grouped by their recorded market session. A session with no completed outcomes shows no win rate; a strategy-specific leader is withheld until at least 20 scored forward paper outcomes exist.
                </p>
              </div>

              <div className="bg-neutral-950 p-3.5 rounded-xl border border-emerald-800/80 space-y-2">
                <span className="font-bold text-emerald-400 block text-sm flex items-center gap-1.5">
                  <Brain className="w-4 h-4" />
                  3. Every Closed Evolved-Genome Trade Is Forward Paper Evidence
                </span>
                <p>
                  Each decisive WIN or LOSS updates that strategy's persisted Beta posterior exactly once. SCRATCH results do not change the win/loss posterior. The prediction-time 19-feature vector is stored with its settled outcome in a separate episodic memory bank; later signals compare the ten closest earlier trades and are vetoed only when a sufficiently similar neighborhood has non-positive payout-adjusted return.
                </p>
              </div>

              <div className="bg-neutral-950 p-3.5 rounded-xl border border-emerald-800/80 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold text-emerald-300 block text-sm flex items-center gap-1.5">
                    <Brain className="w-4 h-4" />
                    Persisted learning state
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    {evolutionTelemetry ? new Date(evolutionTelemetry.timestamp).toLocaleTimeString() : 'Not loaded'}
                  </span>
                </div>
                {evolutionTelemetry ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="bg-neutral-900 rounded-lg p-2">
                        <div className="text-[10px] text-neutral-500">Decisive outcomes</div>
                        <div className="text-lg font-bold text-white font-mono">{evolutionTelemetry.learning.decisiveUpdates.toLocaleString()}</div>
                      </div>
                      <div className="bg-neutral-900 rounded-lg p-2">
                        <div className="text-[10px] text-neutral-500">Episodic memories</div>
                        <div className="text-lg font-bold text-white font-mono">{evolutionTelemetry.episodicMemory.storedTrades.toLocaleString()}</div>
                      </div>
                      <div className="bg-neutral-900 rounded-lg p-2">
                        <div className="text-[10px] text-neutral-500">Tracked strategies</div>
                        <div className="text-lg font-bold text-white font-mono">{evolutionTelemetry.learning.strategyCount.toLocaleString()}</div>
                      </div>
                    </div>
                    <p className="text-[11px] text-neutral-400">
                      {evolutionTelemetry.learning.posterior} posterior · {evolutionTelemetry.learning.selection} selection.
                      Memory uses {evolutionTelemetry.episodicMemory.featureDimensions} normalized features and checks the {evolutionTelemetry.episodicMemory.nearestNeighbors} closest earlier trades.
                    </p>
                    {evolutionTelemetry.strategies.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-neutral-500">Highest current selection scores</div>
                        {[...evolutionTelemetry.strategies]
                          .sort((a, b) => b.bayesianUcbScore - a.bayesianUcbScore)
                          .slice(0, 5)
                          .map(item => (
                            <div key={item.strategyId} className="flex items-center justify-between gap-3 text-[11px] border-t border-neutral-800 pt-1.5">
                              <span className="text-neutral-300 truncate">{item.strategyId}</span>
                              <span className="text-right font-mono text-neutral-400 shrink-0">
                                Beta({item.alpha.toFixed(1)}, {item.beta.toFixed(1)}) · n={item.decisiveOutcomes}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                    {evolutionTelemetry.regimes.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-neutral-500">Last measured market regimes</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {evolutionTelemetry.regimes.slice(0, 8).map(item => (
                            <div key={item.symbol} className="bg-neutral-900 rounded-lg px-2 py-1.5 text-[11px]">
                              <div className="flex justify-between gap-2">
                                <span className="text-neutral-300">{item.symbol}</span>
                                <span className="text-cyan-300 font-mono">{item.regime}</span>
                              </div>
                              <div className="text-[10px] text-neutral-500">
                                {item.session} · ER {item.directionalEfficiency?.toFixed(2) ?? 'n/a'} · ATR× {item.atrRatio?.toFixed(2) ?? 'n/a'}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-neutral-400">
                    {evolutionTelemetryError || 'No persisted learning telemetry has been returned yet.'}
                  </p>
                )}
              </div>

              {evolutionTelemetry && (
                <div className="bg-neutral-950 p-3.5 rounded-xl border border-cyan-800/80 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-cyan-300 text-sm flex items-center gap-1.5">
                      <Dna className="w-4 h-4" />
                      Autonomous evolutionary research
                    </span>
                    <span className="text-[10px] text-neutral-400 font-mono">
                      {evolutionTelemetry.researchCoordinator.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-300">
                    {evolutionTelemetry.researchCoordinator.message}
                  </p>
                  {evolutionTelemetry.researchCoordinator.batchRunning && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-neutral-400 font-mono">
                        <span>{evolutionTelemetry.researchCoordinator.symbol || 'Research batch'}</span>
                        <span>
                          {evolutionTelemetry.researchCoordinator.completedCandidates}/
                          {evolutionTelemetry.researchCoordinator.totalCandidates}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-neutral-800 overflow-hidden">
                        <div
                          className="h-full bg-cyan-400 transition-all"
                          style={{
                            width: `${Math.min(100, 100 * evolutionTelemetry.researchCoordinator.completedCandidates / Math.max(1, evolutionTelemetry.researchCoordinator.totalCandidates))}%`,
                          }}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[10px] font-mono text-neutral-400">
                        <span>Historical pass: {evolutionTelemetry.researchCoordinator.historicalPasses}</span>
                        <span>Rejected: {evolutionTelemetry.researchCoordinator.rejected}</span>
                        <span>Holdout finalists: {evolutionTelemetry.researchCoordinator.finalists}</span>
                      </div>
                    </div>
                  )}
                  <p className="text-[10px] text-neutral-500">
                    Market signals are polled every {evolutionTelemetry.researchCoordinator.marketPulseSeconds}s. Heavy candidate research is isolated to a {evolutionTelemetry.researchCoordinator.scanIntervalMinutes}-minute schedule and requires {evolutionTelemetry.researchCoordinator.requiredNewM1Candles.toLocaleString()} new M1 candles per consumed pair holdout. Research window capped at {evolutionTelemetry.researchCoordinator.historyWindowLimit.toLocaleString()} candles.
                  </p>
                  {evolutionTelemetry.generations.filter(item => !!item.researchBatchId).slice(0, 3).map(item => (
                    <div key={item.researchBatchId} className="border-t border-neutral-800 pt-2 space-y-1">
                      <div className="flex justify-between gap-2 text-[10px] font-mono">
                        <span className="text-neutral-300">{item.symbol || 'Research'} · {item.status || 'RECORDED'}</span>
                        <span className="text-neutral-500">{new Date(item.timestamp).toLocaleString()}</span>
                      </div>
                      <p className="text-[10px] text-neutral-400">{item.summary}</p>
                    </div>
                  ))}
                  {evolutionTelemetry.researchCoordinator.error && (
                    <p className="text-[11px] text-rose-300">{evolutionTelemetry.researchCoordinator.error}</p>
                  )}
                </div>
              )}

              <div className="bg-neutral-950 p-3.5 rounded-xl border border-amber-800/80 space-y-2">
                <span className="font-bold text-amber-400 block text-sm flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  4. Entry Candle: 5m–30m · Decision: Exactly T−3m
                </span>
                <p>
                  Each candidate is evaluated for a matching <strong>5m, 10m, 15m, 20m, 25m or 30m entry candle</strong>. The signal must use a fully closed M1 decision bar exactly three minutes before that candle opens; expiry is measured on the matching horizon and exact expiry minute.
                </p>
              </div>

              <div className="bg-neutral-950 p-3.5 rounded-xl border border-cyan-800/80 space-y-2">
                <span className="font-bold text-cyan-300 block text-sm flex items-center gap-1.5">
                  <Dna className="w-4 h-4 text-cyan-400" />
                  5. Strategy Candidate Generation and Validation
                </span>
                <p>
                  The search evolves executable symbolic expression trees over causal market features. Validated parents, strategy diversity and sufficiently large forward-paper samples steer mutation and reproduction. Candidate generation creates no accuracy claim; only pre-registered historical finalists and independent forward-paper outcomes can qualify a strategy.
                </p>
              </div>

              <p className="text-[10px] text-neutral-500">
                Evolved-genome score only. {archivedRuleBasedOutcomes} legacy rule-based paper outcomes are excluded from this win rate and return total.
              </p>
              <div className="bg-emerald-950/40 p-3.5 rounded-xl border border-emerald-800/80 flex items-center justify-between">
                <div>
                  <div className="text-xs text-neutral-400">Completed forward paper outcomes:</div>
                  <div className="text-2xl font-extrabold text-emerald-400 font-mono">
                    {evolvedScoredSignals.length ? `${evolvedCalculatedWinRate}% forward paper win rate` : 'No completed forward outcomes'}
                  </div>
                </div>
                <div className="text-right text-xs text-neutral-300 font-mono">
                  <div>{evolvedTotalWins} Wins</div>
                  <div className="text-rose-400">{evolvedTotalLosses} Losses</div>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowLearningModal(false)}
              className="w-full py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white font-bold rounded-xl transition-colors text-xs"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* MODAL 2: DISCOVERED STRATEGIES */}
      {showStrategiesModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-xl w-full p-5 sm:p-6 text-neutral-200 space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-6 h-6 text-amber-400" />
                <h3 className="text-lg font-bold text-white">Top Discovered Strategies</h3>
              </div>
              <button
                onClick={() => setShowStrategiesModal(false)}
                className="text-neutral-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              {synthesizedStrategies.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-700 p-5 text-center text-xs text-neutral-400">
                  No strategy candidates have been generated. Import at least 60,000 genuine one-minute candles for a pair, then run the 300-candidate evolutionary research batch.
                </div>
              ) : (
                [...synthesizedStrategies]
                  .sort((a, b) =>
                    Number(b.status === 'PROMOTED_ACTIVE') - Number(a.status === 'PROMOTED_ACTIVE') ||
                    Number(b.status === 'PAPER_TRADING') - Number(a.status === 'PAPER_TRADING') ||
                    (b.discoveryMetrics?.validationExpectedValueUnits ?? -Infinity) -
                      (a.discoveryMetrics?.validationExpectedValueUnits ?? -Infinity)
                  )
                  .slice(0, 10)
                  .map(gene => {
                    const forward = strategyPerformance.find(item => item.strategyId === gene.id);
                    const measuredTest = gene.accuracyStatus === 'BACKTESTED' && !!gene.backtestMetrics;
                    const statusLabel = gene.status === 'PROMOTED_ACTIVE'
                      ? 'FORWARD PAPER GATE PASSED'
                      : gene.status === 'PAPER_TRADING'
                        ? 'PAPER TRADING'
                        : gene.status === 'REJECTED'
                          ? 'REJECTED'
                          : 'UNVALIDATED';
                    return (
                      <div key={gene.id} className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h4 className="font-bold text-white text-sm">{gene.name}</h4>
                            <span className="text-[11px] text-neutral-400">
                              {gene.symbol || 'Unassigned pair'} · {gene.optimalHorizonMinutes}M entry / expiry · {gene.sessionAffinity}
                            </span>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 text-[10px] font-mono">
                            {statusLabel}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-cyan-200 break-all">{gene.mathematicalFormula}</div>
                        {gene.discoveryMetrics && (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono">
                            <div><span className="text-neutral-500 block">Train WR · n</span><strong>{(gene.discoveryMetrics.trainWinRate * 100).toFixed(1)}% · {gene.discoveryMetrics.trainScoredTrades}</strong></div>
                            <div><span className="text-neutral-500 block">Validation WR · n</span><strong>{(gene.discoveryMetrics.validationWinRate * 100).toFixed(1)}% · {gene.discoveryMetrics.validationScoredTrades}</strong></div>
                            <div><span className="text-neutral-500 block">Validation EV</span><strong>{gene.discoveryMetrics.validationExpectedValueUnits.toFixed(4)} units</strong></div>
                            <div><span className="text-neutral-500 block">Mutation pressure</span><strong>{(gene.mutationRate * 100).toFixed(1)}%</strong></div>
                          </div>
                        )}
                        {measuredTest && gene.backtestMetrics ? (
                          <div className="text-[11px] text-emerald-300 font-mono">
                            Untouched-test result: {(gene.backtestMetrics.testWinRate * 100).toFixed(1)}% · scored n={gene.backtestMetrics.testScoredSampleSize} · 95% Wilson lower bound {(gene.backtestMetrics.confidenceInterval95[0] * 100).toFixed(1)}%.
                          </div>
                        ) : (
                          <div className="text-[11px] text-neutral-500">No untouched-test accuracy has been recorded for this candidate.</div>
                        )}
                        {forward && (
                          <div className="text-[11px] text-neutral-300 font-mono">
                            Forward paper: {forward.wins}W / {forward.losses}L / {forward.scratches} scratches · {(forward.netReturnUnits ?? 0) > 0 ? '+' : ''}{(forward.netReturnUnits ?? 0).toFixed(3)} stake units.
                          </div>
                        )}
                        {gene.validationFailureReason && (
                          <div className="text-[10px] text-rose-300">{gene.validationFailureReason}</div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
            <button
              onClick={() => setShowStrategiesModal(false)}
              className="w-full py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white font-bold rounded-xl transition-colors text-xs"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* MODAL 3: SIGNAL DETAILS & VERIFICATION AUDIT */}
      {selectedSignal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-lg w-full p-5 text-xs font-mono text-neutral-300 space-y-4 max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <span className="text-xl font-black text-white">{selectedSignal.symbol}</span>
                <span
                  className={`px-2.5 py-0.5 rounded-lg font-black ${
                    selectedSignal.direction === 'BUY'
                      ? 'bg-emerald-500 text-neutral-950'
                      : 'bg-rose-500 text-white'
                  }`}
                >
                  {selectedSignal.direction} ({selectedSignal.expiryMinutes || 5}M)
                </span>
                <span className="text-neutral-400 text-[11px]">[{selectedSignal.lifecycleState}]</span>
              </div>
              <button
                onClick={() => setSelectedSignal(null)}
                className="text-neutral-400 hover:text-white p-1 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* Timings */}
            <div className="bg-neutral-950 p-3.5 rounded-xl border border-neutral-800 space-y-2">
              <div className="text-neutral-400 text-[10px] uppercase font-bold tracking-wider">
                {selectedSignal.entryTimeframeMinutes ?? selectedSignal.expiryMinutes ?? 5}-MINUTE ENTRY CANDLE SCHEDULE
              </div>
              <div className="flex justify-between text-neutral-200 text-xs">
                <span>Entry Time ({selectedSignal.entryTimeframeMinutes ?? selectedSignal.expiryMinutes ?? 5}M Open):</span>
                <strong className="text-emerald-400">
                  {selectedSignal.candleOpenTimeIst || formatIST(selectedSignal.actualEntryTimeUtc || selectedSignal.entryWindowStartUtc)}
                </strong>
              </div>
              <div className="flex justify-between text-neutral-200 text-xs">
                <span>Expiry Time ({selectedSignal.expiryMinutes || 5}M Close):</span>
                <strong className="text-rose-400">
                  {selectedSignal.candleCloseTimeIst || formatIST(selectedSignal.plannedExitTimeUtc)}
                </strong>
              </div>
              <div className="flex justify-between text-neutral-400 text-xs">
                <span>Duration:</span>
                <span>{selectedSignal.expiryMinutes || 5} Minutes Dynamic Expiry</span>
              </div>
              {selectedSignal.actualEntryPrice && (
                <div className="flex justify-between text-neutral-200 pt-1 border-t border-neutral-800">
                  <span>Entry Open Fill Price:</span>
                  <span className="text-white font-bold">{selectedSignal.actualEntryPrice}</span>
                </div>
              )}
              {selectedSignal.actualExitPrice && (
                <div className="flex justify-between text-neutral-200">
                  <span>Exit Close Price:</span>
                  <span className="text-white font-bold">{selectedSignal.actualExitPrice}</span>
                </div>
              )}
            </div>

            {/* Strategy & Confluence Stacking */}
            <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-800 space-y-2">
              <div className="flex justify-between items-center text-neutral-400 text-[10px] uppercase font-bold">
                <span>Quantitative Strategy</span>
                {selectedSignal.marketSessionName && (
                  <span className="text-cyan-400 font-mono font-normal">
                    {selectedSignal.marketSessionName}
                  </span>
                )}
              </div>
              <div className="flex justify-between items-center">
                <span className="font-bold text-white">
                  {selectedSignal.strategyName || 'Unclassified historical signal'}
                </span>
                <span className="text-emerald-400 font-bold">
                  {selectedSignal.paperOnly ? 'PAPER ONLY · NOT APPROVED' : (selectedSignal.strategyEvidenceStatus === 'BACKTESTED' && typeof selectedSignal.strategyWinRate === 'number' ? `${selectedSignal.strategyWinRate.toFixed(1)}% Historical test WR · n=${selectedSignal.strategyHistoricalSampleSize || 0}` : 'Historical result not validated')}
                </span>
              </div>
              {(() => {
                const forward = getForwardPerformance(selectedSignal.strategyId);
                const scoredTrades = forward ? forward.wins + forward.losses : 0;
                return (
                  <div className="text-[11px] text-neutral-400 pt-2">
                    Forward paper results: {forward && forward.trades > 0
                      ? `${scoredTrades > 0 ? `${((forward.wins / scoredTrades) * 100).toFixed(1)}% across ${scoredTrades} scored outcomes` : 'No scored outcomes'} · ${forward.scratches} scratches · ${(forward.netReturnUnits ?? 0) > 0 ? '+' : ''}${(forward.netReturnUnits ?? 0).toFixed(3)} payout-adjusted stake units`
                      : 'No completed forward outcomes yet'}
                  </div>
                );
              })()}
              {selectedSignal.confluenceStrategies && selectedSignal.confluenceStrategies.length > 0 && (
                <div className="pt-2 border-t border-neutral-850 space-y-1">
                  <span className="text-[10px] text-purple-400 font-bold uppercase block">
                    Confluence Confirmations ({selectedSignal.confluenceScore || selectedSignal.confluenceStrategies.length} Stacked Models):
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {selectedSignal.confluenceStrategies.map((c, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-[10px] text-neutral-200">
                        ✓ {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* GENERATED STRATEGY CANDIDATE FORMULA */}
              {selectedSignal.mathematicalFormula && (
                <div className="pt-2 border-t border-neutral-850 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-cyan-400 uppercase font-black tracking-wider flex items-center gap-1.5">
                      <Dna className="w-3.5 h-3.5" />
                      GENERATED STRATEGY CANDIDATE FORMULA
                    </span>
                    <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[9px] font-bold">
                      Evolved Strategy Candidates
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-cyan-950/40 font-mono text-cyan-200 text-xs border border-cyan-800/70 overflow-x-auto">
                    {selectedSignal.mathematicalFormula}
                  </div>
                  {selectedSignal.whyHumansMissThis && (
                    <div className="text-[11px] text-neutral-300 leading-relaxed bg-neutral-900/80 p-2.5 rounded-lg border border-neutral-800">
                      <strong className="text-amber-400 block mb-0.5">Candidate Design Rationale:</strong>
                      {selectedSignal.whyHumansMissThis}
                    </div>
                  )}
                </div>
              )}

              {selectedSignal.lifecycleState === 'CLOSED' && (
                <div className="pt-2 border-t border-neutral-850 flex justify-between items-center text-[10px] text-neutral-400">
                  <span>Forward Signal Observation:</span>
                  <span className="text-cyan-300 font-mono">exp_live_{selectedSignal.id}</span>
                </div>
              )}

              {/* OBSERVED LOSS RECORD */}
              {selectedSignal.lossAutopsy && (
                <div className="pt-2 border-t border-rose-900/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-rose-400 uppercase font-black tracking-wider flex items-center gap-1.5 font-mono">
                      <Microscope className="w-3.5 h-3.5 text-rose-400" />
                      OBSERVED LOSS RECORD · NO CAUSAL CLAIM
                    </span>
                    <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono text-[9px] font-bold">
                      {selectedSignal.lossAutopsy.rootCause.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-900/60 text-xs text-neutral-300 space-y-2">
                    <div>
                      <strong className="text-rose-300 block mb-1 text-[11px]">Observed outcome:</strong>
                      <p className="leading-relaxed text-[11px] text-neutral-300">
                        {selectedSignal.lossAutopsy.rootCauseExplanation}
                      </p>
                    </div>

                    <div className="pt-1.5 border-t border-rose-900/40">
                      <strong className="text-amber-400 block mb-1 text-[11px]">Recorded evidence:</strong>
                      <ul className="list-disc list-inside space-y-1 text-[11px] text-neutral-300">
                        {selectedSignal.lossAutopsy.lessonsLearned.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="pt-1.5 border-t border-rose-900/40 text-[11px] text-neutral-400">
                      No replacement genome was fabricated from this loss. Its outcome is already stored against the original evolved genome and can influence future selection only when the forward sample is sufficiently mature.
                    </div>                  </div>
                </div>
              )}
            </div>

            {/* Audit History */}
            <div className="space-y-1.5">
              <div className="text-neutral-400 text-[10px] uppercase font-bold">Audit Log</div>
              <div className="bg-neutral-950 rounded-xl p-3 border border-neutral-800 space-y-1.5 text-[11px] max-h-36 overflow-y-auto">
                {selectedSignal.lifecycleHistory?.map((evt, idx) => (
                  <div key={idx} className="border-b border-neutral-850 pb-1 last:border-0 last:pb-0">
                    <div className="flex justify-between text-neutral-500 text-[10px]">
                      <span>{evt.fromState} → {evt.toState}</span>
                      <span>{formatIST(evt.timestamp)}</span>
                    </div>
                    <p className="text-neutral-300 text-[10px] mt-0.5">{evt.reason}</p>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => setSelectedSignal(null)}
              className="w-full py-2 bg-neutral-800 hover:bg-neutral-700 text-white font-bold rounded-xl transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* MODAL 4: CLEAR HISTORY CONFIRMATION */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-sm w-full p-5 text-neutral-200 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-400">
              <Trash2 className="w-5 h-5" />
              <h3 className="text-base font-bold text-white">Clear Trade History?</h3>
            </div>
            <p className="text-xs text-neutral-400 leading-relaxed">
              This will remove all {historySignals.length} completed trade records and reset win/loss statistics. Active trades in progress will not be affected.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleClearHistory}
                disabled={isClearingHistory}
                className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
              >
                {isClearingHistory ? 'Clearing...' : 'Yes, Clear History'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: MARKET SESSIONS ACCURACY MATRIX */}
      {showSessionsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-2xl w-full p-5 sm:p-6 text-neutral-200 space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <Globe className="w-6 h-6 text-cyan-400" />
                <div>
                  <h3 className="text-lg font-bold text-white">Forward Market Session Outcomes</h3>
                  <p className="text-xs text-neutral-400">Session grouping of completed forward paper outcomes</p>
                </div>
              </div>
              <button
                onClick={() => setShowSessionsModal(false)}
                className="text-neutral-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-neutral-300 leading-relaxed">
              Only settled paper outcomes whose decision, entry and expiry all fell inside one open FX week are counted. They are grouped by actual entry time across five exclusive New York-time reporting buckets; UTC and IST labels adjust for daylight saving. This analytics split does not change the existing strategy session-affinity rules and does not prove that a session causes better performance:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {sessionData.length === 0 ? (
                <div className="col-span-2 p-5 rounded-xl border border-neutral-800 bg-neutral-950 text-sm text-neutral-400">
                  No completed forward outcomes are available yet. Session win rates appear only after a paper signal reaches its modeled expiry.
                </div>
              ) : sessionData.map(sess => (
                <div
                  key={sess.id}
                  className={`p-3.5 rounded-xl border flex flex-col justify-between space-y-2.5 ${
                    sess.isActive
                      ? 'bg-neutral-950 border-emerald-500 ring-1 ring-emerald-500/40 shadow-lg'
                      : 'bg-neutral-950/60 border-neutral-800'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-white text-sm">{sess.name}</span>
                      </div>
                      <span className="text-[10px] text-neutral-400 font-mono block mt-0.5">
                        {sess.istRange}
                      </span>
                    </div>
                    {sess.isActive ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-neutral-950 font-black text-[10px] uppercase flex items-center gap-1 shadow-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-neutral-950 animate-ping" />
                        Active Now
                      </span>
                    ) : (
                      <span className="text-[10px] text-neutral-500 font-mono">Closed</span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-neutral-800/80 text-xs font-mono">
                    <div className="bg-neutral-900/80 p-2 rounded-lg border border-neutral-800">
                      <span className="text-[10px] text-neutral-400 block uppercase">Win Rate</span>
                      <span className="text-base font-extrabold text-emerald-400">{sess.hasMeasuredData ? `${sess.winRate}%` : "No data"}</span>
                    </div>
                    <div className="bg-neutral-900/80 p-2 rounded-lg border border-neutral-800">
                      <span className="text-[10px] text-neutral-400 block uppercase">Observed Paper Net Return</span>
                      <span className={`text-sm font-bold ${sess.netReturnUnits >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {sess.netReturnUnits > 0 ? '+' : ''}{sess.netReturnUnits.toFixed(3)} Stake Units
                      </span>
                      <span className="text-[9px] text-neutral-500 block">({sess.wins}W / {sess.losses}L / {sess.scratches} scratches · {sess.totalTrades} total)</span>
                    </div>
                  </div>

                  <div className="text-[11px] bg-neutral-900/60 p-2 rounded-lg border border-neutral-800/60">
                    <span className="text-neutral-400 block text-[10px] uppercase font-bold text-amber-400/90">
                      Top Strategy:
                    </span>
                    <span className="text-neutral-200 font-medium">{sess.bestStrategy}</span>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowSessionsModal(false)}
              className="w-full py-2.5 bg-neutral-800 hover:bg-neutral-700 font-semibold text-white rounded-xl text-xs transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* MODAL 6: STRATEGY CANDIDATE RESEARCH */}
      {showGenesisModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-3xl w-full p-5 sm:p-6 text-neutral-200 space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-950/80 border border-cyan-700/80 text-cyan-400">
                  <Dna className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span>Strategy Candidate Research</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-mono">
                      Candidate formula search
                    </span>
                  </h3>
                  <p className="text-xs text-neutral-400">
                    Executable symbolic candidates with measured historical and forward-paper evidence
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowGenesisModal(false)}
                className="text-neutral-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* GENESIS CONTROLS & STATS BAR */}
            <div className="bg-neutral-950 p-4 rounded-xl border border-cyan-900/60 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-white uppercase tracking-wider block">
                    Evolutionary Research Run
                  </span>
                  <p className="text-[11px] text-neutral-400">
                    Runs 300 candidates through train/validation ranking. Only pre-registered finalists access the untouched test; later promotion requires independent forward paper evidence.
                  </p>
                </div>
                <button
                  onClick={handleEvolveStrategy}
                  disabled={isEvolvingStrategy}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-linear-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-neutral-950 font-black text-xs transition-all shadow-lg shadow-cyan-950/50 disabled:opacity-50"
                >
                  <Sparkles className={`w-4 h-4 ${isEvolvingStrategy ? 'animate-spin' : ''}`} />
                  <span>{isEvolvingStrategy ? `Evolving ${searchJob?.completed ?? 0}/300 candidates...` : '🧬 Run 300-Candidate Evolution'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-neutral-850 text-xs font-mono">
                <div className="bg-neutral-900/80 p-2 rounded-lg border border-neutral-800">
                  <span className="text-[10px] text-neutral-400 block uppercase">Forward-paper gate passed (paper only)</span>
                  <span className="text-sm font-extrabold text-cyan-400">
                    {synthesizedStrategies.filter(s => s.status === 'PROMOTED_ACTIVE').length} Strategies
                  </span>
                </div>
                <div className="bg-neutral-900/80 p-2 rounded-lg border border-neutral-800">
                  <span className="text-[10px] text-neutral-400 block uppercase">Generation</span>
                  <span className="text-sm font-extrabold text-white">
                    {synthesizedStrategies[0]?.generation ? `Gen-${synthesizedStrategies[0].generation}+` : '—'}
                  </span>
                </div>
                <div className="bg-neutral-900/80 p-2 rounded-lg border border-neutral-800">
                  <span className="text-[10px] text-neutral-400 block uppercase">Backtested Candidates</span>
                  <span className="text-sm font-extrabold text-emerald-400">{validatedGeneCount}</span>
                </div>
                <div className="bg-neutral-900/80 p-2 rounded-lg border border-neutral-800">
                  <span className="text-[10px] text-neutral-400 block uppercase">Paper Trading</span>
                  <span className="text-sm font-extrabold text-amber-300">{paperTradingGeneCount} Candidates</span>
                </div>
                <div className="bg-neutral-900/80 p-2 rounded-lg border border-neutral-800">
                  <span className="text-[10px] text-neutral-400 block uppercase">Operators</span>
                  <span className="text-sm font-extrabold text-purple-400">
                    Non-Linear (4)
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 space-y-3">
              <div>
                <h4 className="text-sm font-bold text-white">Import externally sourced historical candles</h4>
                <p className="text-[11px] text-neutral-400 mt-1">Upload 1-minute CSV or JSON candles. Candidate validation requires at least 60,000 structurally valid M1 rows to support the full 5m–30m horizon range. Synthetic fallback candles are rejected. The app checks OHLC and timestamps but cannot independently authenticate an uploaded file's provider or contents; import only genuine broker/provider exports.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={historyImportPair}
                  onChange={e => setHistoryImportPair(e.target.value)}
                  className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white"
                >
                  {FOREX_PAIRS.map(pair => <option key={pair} value={pair}>{pair}</option>)}
                </select>
                <label className="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-white cursor-pointer">
                  {isImportingHistory ? 'Importing…' : 'Choose CSV / JSON'}
                  <input type="file" accept=".csv,.json,application/json,text/csv" className="hidden" disabled={isImportingHistory} onChange={handleImportHistoricalFile} />
                </label>
              </div>
              {historyImportMessage && <p className="text-[11px] text-cyan-200 break-words">{historyImportMessage}</p>}
            </div>

            {/* CANDIDATE VALIDATION POLICY */}
            <div className="p-3.5 rounded-xl bg-cyan-950/20 border border-cyan-800/40 text-xs text-neutral-300 space-y-1.5 leading-relaxed">
              <strong className="text-cyan-300 font-bold flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-cyan-400" />
                How candidates become forward-approved:
              </strong>
              <p>
                The generator evolves executable symbolic expression trees over causal market features using crossover, adaptive mutation and species-preserving parent selection. Candidate generation provides no accuracy; a candidate starts unvalidated, must pass the chronological historical gates, then must independently satisfy the 300-outcome forward paper gate before it can be marked forward-approved.
              </p>
            </div>

            {/* LIST OF SYNTHESIZED GENETIC STRATEGIES */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-mono text-neutral-400">
                <span className="uppercase font-bold tracking-wider">
                  Strategy Candidate Pool ({synthesizedStrategies.length})
                </span>
                <span className="text-[11px] text-neutral-400">Promotion requires untouched-test evidence</span>
              </div>

              {synthesizedStrategies.map((gene, idx) => {
                const isPromoted = gene.status === 'PROMOTED_ACTIVE';
                const isPaperTrading = gene.status === 'PAPER_TRADING';
                return (
                  <div
                    key={gene.id || idx}
                    className={`p-4 rounded-xl border space-y-3 transition-all ${
                      isPromoted
                        ? 'bg-neutral-950 border-cyan-700/80 shadow-md ring-1 ring-cyan-500/20'
                        : 'bg-neutral-950/70 border-neutral-800'
                    }`}
                  >
                    {/* Header */}
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-600/80 font-mono text-xs font-black text-cyan-300">
                            GEN-{gene.generation}
                          </span>
                          <span className="font-bold text-white text-sm">{gene.name}</span>
                        </div>
                        <span className="text-[11px] text-neutral-400 font-mono block">
                          Entry candle / expiry: <strong className="text-amber-300">{gene.optimalHorizonMinutes} minutes</strong> · Session: <strong className="text-cyan-300">{gene.sessionAffinity}</strong>
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {isPromoted ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold">
                            FORWARD APPROVED
                          </span>
                        ) : isPaperTrading ? (
                          <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-xs font-mono font-bold">
                            PAPER TRADING
                          </span>
                        ) : gene.status === 'REJECTED' ? (
                          <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 text-xs font-mono">
                            REJECTED
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 text-xs font-mono">
                            UNVALIDATED / RESEARCH
                          </span>
                        )}
                        <span className="px-2.5 py-0.5 rounded-lg bg-emerald-950 text-emerald-300 border border-emerald-800/80 text-xs font-mono font-black">
                          {gene.backtestMetrics ? `${(gene.backtestMetrics.testWinRate * 100).toFixed(1)}% Test WR · scored n=${gene.backtestMetrics.testScoredSampleSize}` : 'UNVALIDATED'}
                        </span>
                      </div>
                    </div>

                    {/* Mathematical Formula Box */}
                    <div className="p-3 rounded-lg bg-neutral-900 border border-cyan-900/60 font-mono text-cyan-200 text-xs space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-neutral-400 uppercase tracking-wider pb-1 border-b border-neutral-800">
                        <span className="text-cyan-400 font-bold">Mathematical Equation:</span>
                        <span className="px-1.5 py-0.2 rounded bg-purple-900/40 text-purple-300 text-[9px]">
                          Genome complexity: {gene.genome?.complexity ?? 'legacy'}
                        </span>
                      </div>
                      <div className="text-sm font-bold text-cyan-300 pt-1 overflow-x-auto">
                        {gene.mathematicalFormula}
                      </div>
                    </div>

                    {gene.backtestMetrics && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono bg-neutral-900/60 border border-neutral-800 rounded-lg p-3">
                        <div><span className="text-neutral-500 block">Train · scored n={gene.backtestMetrics.trainScoredSampleSize} / total n={gene.backtestMetrics.trainSampleSize}</span><strong className="text-neutral-200">{(gene.backtestMetrics.trainWinRate * 100).toFixed(1)}%</strong></div>
                        <div><span className="text-neutral-500 block">Validation · scored n={gene.backtestMetrics.validationScoredSampleSize} / total n={gene.backtestMetrics.validationSampleSize}</span><strong className="text-neutral-200">{(gene.backtestMetrics.validationWinRate * 100).toFixed(1)}%</strong></div>
                        <div><span className="text-neutral-500 block">Untouched test · scored n={gene.backtestMetrics.testScoredSampleSize} / total n={gene.backtestMetrics.testSampleSize}</span><strong className="text-emerald-300">{(gene.backtestMetrics.testWinRate * 100).toFixed(1)}%</strong></div>
                        <div><span className="text-neutral-500 block">EV / Profit factor</span><strong className="text-neutral-200">{gene.backtestMetrics.expectedValueUnits.toFixed(4)} stake units/trade · {gene.backtestMetrics.profitFactor.toFixed(2)}</strong></div>
                        <div className="col-span-2 sm:col-span-4 text-neutral-500">95% Wilson interval for net-positive WR: {(gene.backtestMetrics.confidenceInterval95[0] * 100).toFixed(1)}%–{(gene.backtestMetrics.confidenceInterval95[1] * 100).toFixed(1)}%</div>
                      </div>
                    )}
                    {gene.forwardPerformance && (
                      <div className="text-[11px] font-mono text-neutral-300 bg-neutral-900/60 border border-neutral-800 rounded-lg p-3">
                        Forward paper results: {gene.forwardPerformance.wins}W / {gene.forwardPerformance.losses}L / {gene.forwardPerformance.scratches} scratches · {gene.forwardPerformance.trades} completed contracts · {(gene.forwardPerformance.netReturnUnits ?? 0) > 0 ? '+' : ''}{(gene.forwardPerformance.netReturnUnits ?? 0).toFixed(3)} stake units
                      </div>
                    )}
                    {gene.accuracyStatus !== 'BACKTESTED' && (
                      <span className="text-[10px] text-neutral-500">Candidate remains unvalidated until the next pre-registered batch test.</span>
                    )}

                    {/* Parents & Lineage */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                      <span className="text-neutral-400 uppercase font-bold text-[10px]">Genetic Parents:</span>
                      {gene.parents.map((p, pIdx) => (
                        <span
                          key={pIdx}
                          className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-300 text-[10px]"
                        >
                          {pIdx > 0 ? '⨉ ' : ''}{p}
                        </span>
                      ))}
                    </div>

                    {/* Why Humans Miss This & Hypothesis */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      <div className="p-2.5 rounded-lg bg-neutral-900/70 border border-neutral-800 space-y-1">
                        <span className="text-[10px] uppercase font-bold text-amber-400 block">
                          Why Humans Miss This:
                        </span>
                        <p className="text-neutral-300 text-[11px] leading-relaxed">
                          {gene.whyHumansMissThis}
                        </p>
                      </div>
                      <div className="p-2.5 rounded-lg bg-neutral-900/70 border border-neutral-800 space-y-1">
                        <span className="text-[10px] uppercase font-bold text-cyan-400 block">
                          Scientific Hypothesis:
                        </span>
                        <p className="text-neutral-300 text-[11px] leading-relaxed">
                          {gene.scientificHypothesis}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => setShowGenesisModal(false)}
              className="w-full py-2.5 bg-neutral-800 hover:bg-neutral-700 font-semibold text-white rounded-xl text-xs transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
