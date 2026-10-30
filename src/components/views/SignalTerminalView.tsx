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
  const [synthesizedStrategies, setSynthesizedStrategies] = useState<SynthesizedStrategyGene[]>([]);
  const [strategyPerformance, setStrategyPerformance] = useState<StrategyPerformanceRecord[]>([]);
  const [isEvolvingStrategy, setIsEvolvingStrategy] = useState<boolean>(false);
  const [historyImportPair, setHistoryImportPair] = useState<string>('EUR/USD');
  const [isImportingHistory, setIsImportingHistory] = useState<boolean>(false);
  const [historyImportMessage, setHistoryImportMessage] = useState<string>('');
  const [validatingGeneId, setValidatingGeneId] = useState<string | null>(null);
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

  const getForwardPerformance = (strategyId?: string) =>
    strategyPerformance.find(item => item.strategyId === (strategyId || '')) || null;

  useEffect(() => {
    fetchSessions();
    fetchSynthesizedStrategies();
    fetchStrategyPerformance();
  }, [signals]);

  const handleEvolveStrategy = async () => {
    setIsEvolvingStrategy(true);
    try {
      const res = await fetch('/api/strategies/evolve', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        await fetchSynthesizedStrategies();
        await fetchStrategyPerformance();
        onEvaluateSignals();
      }
    } catch (err) {
      console.error('Failed to evolve novel strategy:', err);
    } finally {
      setIsEvolvingStrategy(false);
    }
  };

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

  const handleValidateGene = async (geneId: string, symbol?: string) => {
    setValidatingGeneId(geneId);
    setHistoryImportMessage('');
    try {
      const res = await fetch('/api/strategies/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geneId, symbol: symbol || historyImportPair }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Strategy validation failed.');
      await fetchSynthesizedStrategies();
      setHistoryImportMessage(
        `${data.gene.name}: untouched-test win rate ${data.gene.verifiedAccuracy}% from ${data.gene.sampleCount} trades. Status: ${data.gene.status}.`
      );
    } catch (error: any) {
      setHistoryImportMessage(error.message || 'Strategy validation failed.');
    } finally {
      setValidatingGeneId(null);
    }
  };

  const validatedGenes = synthesizedStrategies.filter(
    gene => gene.accuracyStatus === 'BACKTESTED' && !!gene.backtestMetrics
  );
  const validatedGeneCount = validatedGenes.length;
  const paperTradingGeneCount = synthesizedStrategies.filter(gene => gene.status === 'PAPER_TRADING').length;

  // 5-Minute Candle Synchronization
  const FIVE_MIN_MS = 5 * 60 * 1000;
  const current5mOpenMs = Math.floor(nowMs / FIVE_MIN_MS) * FIVE_MIN_MS;
  const next5mOpenMs = current5mOpenMs + FIVE_MIN_MS;
  const secondsToNext5m = Math.max(0, Math.floor((next5mOpenMs - nowMs) / 1000));
  const next5mMin = Math.floor(secondsToNext5m / 60);
  const next5mSec = secondsToNext5m % 60;
  const next5mCountdownStr = `${next5mMin.toString().padStart(2, '0')}:${next5mSec.toString().padStart(2, '0')}`;

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

  const next5mOpenIST = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(new Date(next5mOpenMs)).toUpperCase() + ' IST';

  // Overall Accuracy & Metrics
  const historySignals = signals.filter(s =>
    ['CLOSED', 'EXPIRED', 'INVALIDATED'].includes(s.lifecycleState)
  );
  const completedSignals = signals.filter(
    s => s.lifecycleState === 'CLOSED' && ['WIN', 'LOSS', 'SCRATCH'].includes(s.outcomeResult)
  );
  const closedSignals = completedSignals.filter(s => ['WIN', 'LOSS'].includes(s.outcomeResult));
  const totalWins = closedSignals.filter(s => s.outcomeResult === 'WIN').length;
  const totalLosses = closedSignals.filter(s => s.outcomeResult === 'LOSS').length;
  const calculatedWinRate =
    closedSignals.length > 0
      ? ((totalWins / closedSignals.length) * 100).toFixed(1)
      : 'No scored forward outcomes';
  const totalNetPips = Number(
    completedSignals.reduce((acc, s) => acc + (s.netReturnPips || 0), 0).toFixed(1)
  );

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
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-950 font-sans text-neutral-100">
      {/* 1. TOP STATUS BAR: Zero clutter, essential numbers at a glance */}
      <div className="bg-neutral-900/90 border-b border-neutral-800 px-3 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Live 5M Candle Clock */}
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs sm:text-sm font-bold text-white uppercase tracking-wide">
              Next 5M Trade Open In:
            </span>
            <span className="text-sm sm:text-base font-extrabold font-mono text-emerald-400 tabular-nums">
              {next5mCountdownStr}
            </span>
            <span className="text-[11px] text-neutral-400 font-mono hidden xs:inline">
              ({next5mOpenIST})
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono border flex items-center gap-1 ${
                secondsToNext5m <= 180
                  ? 'bg-amber-950/80 border-amber-500/80 text-amber-300 animate-pulse'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-400'
              }`}
              title="Only generate signals strictly 3 minutes in advance of 5M candle open"
            >
              <Clock className="w-3 h-3 text-amber-400" />
              {secondsToNext5m <= 180
                ? '⚡ Strict 3M Window Active'
                : `3M Window in ${Math.floor((secondsToNext5m - 180) / 60)}m ${((secondsToNext5m - 180) % 60).toString().padStart(2, '0')}s`}
            </span>
          </div>
        </div>

        {/* Global Accuracy Pill */}
        <div className="flex items-center gap-2">
          <div className="px-2.5 py-1 rounded-lg bg-emerald-950/80 border border-emerald-800/80 flex items-center gap-2">
            <Target className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs font-bold text-emerald-300 font-mono">
              {closedSignals.length ? `${calculatedWinRate}% Forward signal win rate` : 'No completed forward outcomes'}
            </span>
            <span className="text-[10px] text-neutral-400 font-mono hidden sm:inline">
              ({totalWins}W / {totalLosses}L · n={closedSignals.length})
            </span>
          </div>

          <button
            onClick={onEvaluateSignals}
            disabled={isEvaluating}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold text-neutral-200 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors disabled:opacity-50"
            title="Scan market and sync signals"
          >
            <RefreshCw className={`w-3 h-3 ${isEvaluating ? 'animate-spin text-emerald-400' : ''}`} />
            <span className="hidden xs:inline">{isEvaluating ? 'Scanning...' : 'Sync'}</span>
          </button>
        </div>
      </div>

      {/* SESSION ACCURACY STRIP (ASIA · LONDON · OVERLAP · NEW YORK) */}
      <div className="bg-neutral-900/60 border-b border-neutral-800/80 px-3 sm:px-5 py-1.5 flex items-center justify-between gap-2 overflow-x-auto text-[11px] font-mono scrollbar-none shrink-0">
        <div className="flex items-center gap-2 text-neutral-400 shrink-0">
          <Globe className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-bold text-neutral-300 uppercase text-[10px] tracking-wider">Forward Session Outcomes:</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {sessionData.length === 0 ? (
            <span className="text-neutral-500">No completed forward session outcomes yet</span>
          ) : sessionData.map(s => (
            <button
              key={s.id}
              onClick={() => setShowSessionsModal(true)}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border transition-all ${
                s.isActive
                  ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 font-bold shadow-xs'
                  : 'bg-neutral-950/70 border-neutral-800/80 text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {s.isActive && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
              )}
              <span>{s.shortName}:</span>
              <strong className={s.isActive ? 'text-emerald-400' : 'text-neutral-200'}>{s.hasMeasuredData ? `${s.winRate}%` : '—'}</strong>
              <span className="text-[9px] text-neutral-500">n={s.totalTrades}</span>
              {s.isActive && <span className="text-[9px] uppercase px-1 rounded bg-emerald-500/20 text-emerald-400">Live</span>}
            </button>
          ))}
        </div>
      </div>

      {/* 2. SECONDARY CONTROLS & INFO BUTTONS */}
      <div className="bg-neutral-950 px-3 sm:px-5 py-2 border-b border-neutral-800/70 flex flex-wrap items-center justify-between gap-2 shrink-0">
        {/* Filters: Active | All | History */}
        <div className="flex items-center gap-1 bg-neutral-900 p-1 rounded-lg border border-neutral-800 text-xs font-medium">
          <button
            onClick={() => setFilterState('ACTIVE')}
            className={`px-3 py-1 rounded-md transition-colors font-bold flex items-center gap-1.5 ${
              filterState === 'ACTIVE'
                ? 'bg-emerald-500 text-neutral-950 shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Zap className="w-3 h-3" />
            <span>Active Signals ({activeSignals.length})</span>
          </button>

          <button
            onClick={() => setFilterState('ALL')}
            className={`px-3 py-1 rounded-md transition-colors ${
              filterState === 'ALL'
                ? 'bg-neutral-800 text-white font-bold'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <span>All ({signals.length})</span>
          </button>

          <button
            onClick={() => setFilterState('CLOSED')}
            className={`px-3 py-1 rounded-md transition-colors ${
              filterState === 'CLOSED'
                ? 'bg-neutral-800 text-white font-bold'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <span>History ({historySignals.length})</span>
          </button>
        </div>

        {/* Secondary Actions & Clear History */}
        <div className="flex items-center gap-2">
          {filterState === 'CLOSED' && historySignals.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              disabled={isClearingHistory}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-xs text-rose-300 font-medium transition-colors disabled:opacity-50"
              title="Clear completed trade history"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>{isClearingHistory ? 'Clearing...' : 'Clear History'}</span>
            </button>
          )}

          <button
            onClick={() => setShowGenesisModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-600/80 text-xs text-cyan-200 font-bold transition-all shadow-xs"
            title="Inspect strategy candidates and validation evidence"
          >
            <Dna className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span className="hidden sm:inline">Candidates</span>
            <span className="sm:hidden">Candidates</span>
            <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-[10px] text-cyan-300 font-mono font-bold">
              {synthesizedStrategies.filter(s => s.status === 'PROMOTED_ACTIVE').length}
            </span>
          </button>

          <button
            onClick={() => setShowSessionsModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-800/80 text-xs text-emerald-300 font-medium transition-colors"
          >
            <Globe className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Sessions</span>
            <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-[10px] text-emerald-400 font-mono font-bold">
              {sessionData.find(s => s.isActive)?.shortName || 'Live'}
            </span>
          </button>

          <button
            onClick={() => setShowLearningModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-300 font-medium transition-colors"
          >
            <Brain className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">What AI Learns</span>
            <span className="sm:hidden">AI Brain</span>
          </button>

          <button
            onClick={() => setShowStrategiesModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-300 font-medium transition-colors"
          >
            <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Strategies</span>
            <span className="sm:hidden">Strategies</span>
          </button>
        </div>
      </div>

      {/* 3. MAIN SIGNALS FEED: BOLD, UNCLUTTERED, DIRECT TRADING TICKETS */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4">
        {/* HISTORY SUMMARY BANNER (Shown when viewing History tab) */}
        {filterState === 'CLOSED' && historySignals.length > 0 && (
          <div className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                <Target className="w-6 h-6" />
              </div>
              <div>
                <span className="text-[11px] text-neutral-400 uppercase tracking-wider font-bold block">
                  Closed Trades Performance
                </span>
                <div className="text-xl sm:text-2xl font-black font-mono text-white">
                  {closedSignals.length ? `${calculatedWinRate}% forward paper win rate` : 'No completed forward outcomes'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono">
              <div className="text-center bg-neutral-950 px-3 py-1.5 rounded-xl border border-neutral-800">
                <span className="text-[10px] text-neutral-400 block uppercase">Total Trades</span>
                <span className="font-bold text-white text-sm">{historySignals.length}</span>
              </div>
              <div className="text-center bg-neutral-950 px-3 py-1.5 rounded-xl border border-emerald-900/50">
                <span className="text-[10px] text-emerald-400 block uppercase">Wins</span>
                <span className="font-bold text-emerald-300 text-sm">{totalWins}</span>
              </div>
              <div className="text-center bg-neutral-950 px-3 py-1.5 rounded-xl border border-rose-900/50">
                <span className="text-[10px] text-rose-400 block uppercase">Losses</span>
                <span className="font-bold text-rose-300 text-sm">{totalLosses}</span>
              </div>
              <div className="text-center bg-neutral-950 px-3 py-1.5 rounded-xl border border-neutral-800">
                <span className="text-[10px] text-neutral-400 block uppercase">Net Return</span>
                <span className={`font-bold text-sm ${totalNetPips >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {totalNetPips > 0 ? '+' : ''}{totalNetPips} Pips
                </span>
              </div>
            </div>
          </div>
        )}

        {filteredSignals.length === 0 ? (
          <div className="min-h-[280px] flex flex-col items-center justify-center text-center bg-neutral-900/30 border-2 border-dashed border-neutral-800 rounded-2xl p-6">
            <Clock className="w-12 h-12 text-emerald-500 mb-3 animate-pulse" />
            <h3 className="text-lg font-bold text-white">
              {filterState === 'CLOSED'
                ? 'No Closed Trades in History Yet'
                : 'Bot Is Scanning for the Next 5-Minute Setup'}
            </h3>
            <p className="mt-2 text-xs sm:text-sm text-neutral-400 max-w-md leading-relaxed">
              {filterState === 'CLOSED'
                ? 'When active 5-minute trades reach their expiry, their full trade execution, entry fill, exit fill, and win/loss pips will appear here.'
                : 'Every trade strictly opens at the 5-minute candle opening (:00, :05, :10, :15, :20, :25, :30, :35, :40, :45, :50, :55) with dynamic expiry duration.'}
            </p>
            <button
              onClick={() => setFilterState(filterState === 'CLOSED' ? 'ACTIVE' : 'ALL')}
              className="mt-4 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs font-semibold"
            >
              {filterState === 'CLOSED' ? `View Active Signals (${activeSignals.length})` : `View All Signals (${signals.length})`}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSignals.map(sig => {
              const isBuy = sig.direction === 'BUY';
              const isWaiting = sig.lifecycleState === 'WAITING_FOR_ENTRY';
              const isActive = ['ACTIVE', 'ENTRY_TRIGGERED'].includes(sig.lifecycleState);
              const isClosed = sig.lifecycleState === 'CLOSED';
              const isWin = sig.outcomeResult === 'WIN';
              const isLoss = sig.outcomeResult === 'LOSS';

              return (
                <div
                  key={sig.id}
                  onClick={() => setSelectedSignal(sig)}
                  className={`border-2 rounded-2xl p-4 sm:p-5 flex flex-col justify-between transition-all cursor-pointer shadow-lg relative ${
                    isActive
                      ? 'bg-neutral-900/95 border-emerald-500 shadow-emerald-950/40 ring-1 ring-emerald-500/40'
                      : isWaiting
                      ? 'bg-neutral-900/95 border-amber-500/80 shadow-amber-950/20'
                      : 'bg-neutral-900/70 border-neutral-800 hover:border-neutral-700'
                  }`}
                >
                  <div className="space-y-3.5">
                    {/* ROW 1: PAIR + DIRECTION (MASSIVE & UNMISSABLE) */}
                    <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-white">
                            {sig.symbol}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/40 text-[10px] font-bold text-amber-300">
                            3m Advance
                          </span>
                          {sig.marketSessionName && (
                            <span className="px-2 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-800/80 text-[10px] font-bold text-cyan-300 font-mono">
                              {sig.marketSessionName.split(' ')[0]} Session
                            </span>
                          )}
                          {sig.isNovelAiSynthesized && (
                            <span className="px-2 py-0.5 rounded-full bg-linear-to-r from-cyan-950 to-emerald-950 border border-cyan-500 text-[10px] font-black text-cyan-300 font-mono shadow-xs flex items-center gap-1">
                              <Dna className="w-2.5 h-2.5 text-cyan-400 animate-pulse" />
                              Formula Candidate
                            </span>
                          )}
                          {sig.isStackedStrategy && !sig.isNovelAiSynthesized && (
                            <span className="px-2 py-0.5 rounded-full bg-purple-950/80 border border-purple-700/80 text-[10px] font-bold text-purple-300 font-mono">
                              Stacked ({sig.confluenceScore || 2} Models)
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-neutral-400 font-mono mt-0.5">
                          {getSignalAge(sig.predictionTimeUtc)} · Expiry: <strong className="text-amber-300">{sig.expiryMinutes || 5} Min Dynamic</strong>
                        </div>
                      </div>

                      <div
                        className={`px-3.5 py-1.5 rounded-xl font-black text-sm sm:text-base flex items-center gap-1.5 shadow-md ${
                          isBuy
                            ? 'bg-emerald-500 text-neutral-950 shadow-emerald-500/30'
                            : 'bg-rose-500 text-white shadow-rose-500/30'
                        }`}
                      >
                        {isBuy ? (
                          <ArrowUpRight className="w-5 h-5 stroke-[3]" />
                        ) : (
                          <ArrowDownRight className="w-5 h-5 stroke-[3]" />
                        )}
                        <span>{isBuy ? 'BUY (CALL)' : 'SELL (PUT)'}</span>
                      </div>
                    </div>

                    {/* ROW 2: PROMINENT STATUS BANNER & COUNTDOWN */}
                    {isWaiting && (
                      <div className="bg-amber-950/60 border border-amber-500/80 rounded-xl p-2.5 text-xs text-amber-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-amber-400 animate-pulse shrink-0" />
                          <div>
                            <span className="font-extrabold text-amber-300 block">
                              🔔 3-MIN ADVANCE NOTICE
                            </span>
                            <span className="text-[10px] text-amber-400/90 font-mono">
                              Entry at 5M Candle Open ({sig.candleOpenTimeIst || next5mOpenIST})
                            </span>
                          </div>
                        </div>
                        <span className="font-mono text-xs font-black text-white bg-amber-900/80 px-2 py-1 rounded border border-amber-600 shrink-0 ml-2">
                          Opens in {next5mCountdownStr}
                        </span>
                      </div>
                    )}

                    {isActive && (
                      <div className="bg-emerald-950/70 border border-emerald-500 rounded-xl p-2.5 text-xs text-emerald-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="relative flex h-2.5 w-2.5 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                          </span>
                          <div>
                            <span className="font-bold text-emerald-300 block">
                              TRADE ACTIVE IN PROGRESS
                            </span>
                            <span className="text-[10px] text-emerald-400/90 font-mono">
                              Dynamic {sig.expiryMinutes || 5} Min Expiry Duration
                            </span>
                          </div>
                        </div>
                        <span className="font-mono text-xs font-black text-white bg-emerald-900 px-2 py-1 rounded border border-emerald-600 shrink-0 ml-2">
                          {getRemainingTime(sig.plannedExitTimeUtc)}
                        </span>
                      </div>
                    )}

                    {isClosed && (
                      <div
                        className={`rounded-xl p-3 text-xs flex flex-col gap-2 border ${
                          isWin
                            ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-200 shadow-md ring-1 ring-emerald-500/30'
                            : isLoss
                            ? 'bg-rose-950/60 border-rose-500/80 text-rose-200 shadow-md ring-1 ring-rose-500/30'
                            : 'bg-neutral-800 border-neutral-700 text-neutral-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-black text-sm">
                            {isWin ? (
                              <>
                                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                                <span className="text-emerald-300">TRADE WON</span>
                              </>
                            ) : isLoss ? (
                              <>
                                <XCircle className="w-5 h-5 text-rose-400" />
                                <span className="text-rose-300">TRADE LOST</span>
                              </>
                            ) : (
                              <>
                                <AlertTriangle className="w-4 h-4 text-amber-400" />
                                <span>{sig.lifecycleState}</span>
                              </>
                            )}
                          </div>
                          <span className="font-mono text-sm font-black px-2 py-0.5 rounded bg-neutral-950 border border-neutral-800">
                            {sig.netReturnPips !== null ? `${sig.netReturnPips > 0 ? '+' : ''}${sig.netReturnPips} Pips` : (sig.outcomeResult || 'CLOSED')}
                          </span>
                        </div>

                        {sig.actualEntryPrice && (
                          <div className="flex justify-between items-center text-[11px] font-mono border-t border-neutral-800/80 pt-1.5 text-neutral-300">
                            <span>Entry Fill: <strong className="text-white">{sig.actualEntryPrice}</strong></span>
                            <span>Exit Fill: <strong className="text-white">{sig.actualExitPrice || '—'}</strong></span>
                          </div>
                        )}

                        {isLoss && (
                          <div className="mt-2 pt-2 border-t border-rose-900/60 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black uppercase text-rose-300 flex items-center gap-1 font-mono">
                                <Microscope className="w-3.5 h-3.5 text-rose-400" />
                                Loss Diagnostics
                              </span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-900/40 text-rose-300 font-mono">
                                {sig.lossAutopsy ? sig.lossAutopsy.rootCause.replace(/_/g, ' ') : 'Self-Evolved Antidote'}
                              </span>
                            </div>
                            {sig.lossAutopsy && (
                              <div className="p-2 rounded-lg bg-neutral-950/80 border border-rose-900/40 text-[10px] space-y-1 font-mono">
                                <div className="text-neutral-300">
                                  <strong className="text-amber-400">Lesson:</strong> {sig.lossAutopsy.lessonsLearned[0]}
                                </div>
                                <div className="text-cyan-300 truncate">
                                  <strong className="text-neutral-400">Unvalidated Filter Candidate:</strong> {sig.lossAutopsy.antidoteStrategyName}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ROW 3: THE TWO ESSENTIAL TIMINGS (HIGH CONTRAST BOXES) */}
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      {/* ENTRY BOX */}
                      <div className="bg-neutral-950 p-2.5 rounded-xl border border-neutral-800 flex flex-col justify-between">
                        <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          ENTRY (5M OPEN)
                        </span>
                        <div className="text-sm sm:text-base font-extrabold text-white mt-1 tabular-nums">
                          {sig.candleOpenTimeIst || formatIST(sig.actualEntryTimeUtc || sig.entryWindowStartUtc)}
                        </div>
                        <span className="text-[10px] text-neutral-400 mt-0.5">Strict 5M Open</span>
                      </div>

                      {/* EXIT / EXPIRY BOX */}
                      <div className="bg-neutral-950 p-2.5 rounded-xl border border-neutral-800 flex flex-col justify-between">
                        <span className="text-[10px] text-rose-400 font-bold uppercase tracking-wider flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                          EXPIRY ({sig.expiryMinutes || 5} MIN)
                        </span>
                        <div className="text-sm sm:text-base font-extrabold text-white mt-1 tabular-nums">
                          {sig.candleCloseTimeIst || formatIST(sig.plannedExitTimeUtc)}
                        </div>
                        <span className="text-[10px] text-neutral-400 mt-0.5">Dynamic Close</span>
                      </div>
                    </div>

                    {/* ROW 4: STRATEGY & WIN RATE BANNER */}
                    <div className="bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 truncate">
                          {sig.isNovelAiSynthesized ? (
                            <Dna className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          ) : (
                            <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          )}
                          <span className="text-neutral-200 font-semibold truncate text-[11px]">
                            {sig.strategyName || '5-Min Momentum Breakout'}
                          </span>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/80 font-mono text-[11px] font-bold shrink-0">
                          {sig.strategyEvidenceStatus === 'BACKTESTED' && typeof sig.strategyWinRate === 'number' ? `${sig.strategyWinRate.toFixed(1)}% Historical test WR · n=${sig.strategyHistoricalSampleSize || 0}` : 'Historical result not validated'}
                        </span>
                      </div>

                      {(() => {
                        const forward = getForwardPerformance(sig.strategyId);
                        const scoredTrades = forward ? forward.wins + forward.losses : 0;
                        return (
                          <div className="text-[10px] font-mono text-neutral-400 pt-1">
                            Forward paper results: {forward && forward.trades > 0
                              ? `${scoredTrades > 0 ? `${((forward.wins / scoredTrades) * 100).toFixed(1)}% across ${scoredTrades} scored outcomes` : 'No scored outcomes'} · ${forward.scratches} scratches · ${forward.netPips > 0 ? '+' : ''}${forward.netPips.toFixed(1)} modeled net pips`
                              : 'No completed forward outcomes yet'}
                          </div>
                        );
                      })()}

                      {sig.mathematicalFormula && (
                        <div className="mt-1 p-2 rounded-lg bg-cyan-950/40 border border-cyan-800/70 font-mono text-[10px] text-cyan-200 flex items-center justify-between gap-1 overflow-x-auto scrollbar-none">
                          <span className="text-cyan-400 font-bold shrink-0">Equation:</span>
                          <span className="truncate">{sig.mathematicalFormula}</span>
                          <span className="text-[9px] px-1 py-0.2 bg-cyan-500/20 text-cyan-300 rounded shrink-0 font-bold">Formula</span>
                        </div>
                      )}

                      {sig.confluenceStrategies && sig.confluenceStrategies.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1 border-t border-neutral-800/60">
                          {sig.confluenceStrategies.map((c, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-[9px] text-neutral-300 font-mono flex items-center gap-1">
                              <span className="text-emerald-400">✓</span> {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* CARD FOOTER: Tap hint & Confidence */}
                  <div className="pt-2.5 mt-3 border-t border-neutral-800/60 flex items-center justify-between text-[11px] text-neutral-400">
                    <span className="font-mono">
                      Signal score (not a probability):{' '}
                      <strong className="text-emerald-400">
                        {(sig.confidence * 100).toFixed(0)}%
                      </strong>
                    </span>
                    <span className="text-[10px] text-neutral-500 hover:text-white underline">
                      View Candle Proof →
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 4. OPTIONAL LIVE AUTOPILOT STREAM (COLLAPSIBLE AT BOTTOM) */}
        <div className="mt-6 border border-neutral-800/80 rounded-xl bg-neutral-900/40 overflow-hidden">
          <button
            onClick={() => setShowLogsAccordion(prev => !prev)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-mono text-neutral-400 hover:text-white transition-colors"
          >
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>Live AI Brain Background Activity ({autopilotLogs.length} events)</span>
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
                <h3 className="text-lg font-bold text-white">What The AI Is Learning</h3>
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
                  1. Signal Confluence (Strength Score, Not Win Probability)
                </span>
                <p>
                  The current rule-based signal engine combines technical confluences such as trend direction, wick geometry, RSI and range expansion. A larger confluence count is only a signal-strength heuristic; it does not establish a win rate. Performance is calculated separately from uploaded historical tests and completed forward paper outcomes.
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
                  3. Every Closed Trade Is Forward Paper Evidence
                </span>
                <p>
                  When a trade finishes, its observed result is stored in a per-strategy forward outcome ledger and tagged as a single live-trade record. One trade does not update historical accuracy or qualify a strategy for promotion; performance is reported with its accumulated sample count.
                </p>
              </div>

              <div className="bg-neutral-950 p-3.5 rounded-xl border border-amber-800/80 space-y-2">
                <span className="font-bold text-amber-400 block text-sm flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  4. Dynamic Expiry (5m to 30m) & Strict 5M Open Entry
                </span>
                <p>
                  Every trade takes entry strictly on the 5-minute candle opening (:00, :05, :10, :15, :20, :25, :30, :35, :40, :45, :50, :55) with 3 minutes advance notice. The bot selects dynamic expiries from <strong>5m to 30m</strong> based on the setup's velocity and time-horizon conviction.
                </p>
              </div>

              <div className="bg-neutral-950 p-3.5 rounded-xl border border-cyan-800/80 space-y-2">
                <span className="font-bold text-cyan-300 block text-sm flex items-center gap-1.5">
                  <Dna className="w-4 h-4 text-cyan-400" />
                  5. Strategy Candidate Generation and Validation
                </span>
                <p>
                  The candidate generator samples operator families and coefficients and stores the exact executable parameters with each formula. Candidate generation alone provides no evidence of an edge; candidates must pass the untouched historical test and subsequent forward observation before promotion.
                </p>
              </div>

              <div className="bg-emerald-950/40 p-3.5 rounded-xl border border-emerald-800/80 flex items-center justify-between">
                <div>
                  <div className="text-xs text-neutral-400">Completed forward paper outcomes:</div>
                  <div className="text-2xl font-extrabold text-emerald-400 font-mono">
                    {closedSignals.length ? `${calculatedWinRate}% forward paper win rate` : 'No completed forward outcomes'}
                  </div>
                </div>
                <div className="text-right text-xs text-neutral-300 font-mono">
                  <div>{totalWins} Wins</div>
                  <div className="text-rose-400">{totalLosses} Losses</div>
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
              {/* Strategy 1 */}
              <div className="bg-neutral-950 p-4 rounded-xl border border-emerald-800/80 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-white text-sm">1. 5-Minute Momentum Breakout</h4>
                    <span className="text-[11px] text-neutral-400">Expiry: 5 Minutes · Best Pairs: EUR/USD, GBP/USD, EUR/JPY</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold">
                    Not validated
                  </span>
                </div>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  Enters at the exact opening of the next 5-minute candle when the setup candle closed with high directional volume and a body filling &gt;60% of total candle range. Exits at 5m candle close.
                </p>
              </div>

              {/* Strategy 2 */}
              <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-white text-sm">2. 10-Minute Liquidity Wick Reversal</h4>
                    <span className="text-[11px] text-neutral-400">Expiry: 10 Minutes · Best Pairs: USD/JPY, AUD/USD, AUD/CAD</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-mono font-bold">
                    Not validated
                  </span>
                </div>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  Identifies institutional liquidity sweeps where price tested a key high/low and got aggressively rejected with a long wick (&gt;50% of range). Enters on 5M candle open with 10-minute expiry.
                </p>
              </div>

              {/* Strategy 3 */}
              <div className="bg-neutral-950 p-4 rounded-xl border border-cyan-800/80 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-white text-sm">3. 15-Minute Statistical Mean Reversion</h4>
                    <span className="text-[11px] text-neutral-400">Expiry: 15 Minutes · Best Pairs: EUR/GBP, USD/CAD</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-xs font-mono font-bold">
                    Not validated
                  </span>
                </div>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  Triggers when price extends &gt;8 pips away from its 20-period moving average. Enters counter-trend on 5M candle open with a 15-minute dynamic expiry window.
                </p>
              </div>

              {/* Strategy 4 */}
              <div className="bg-neutral-950 p-4 rounded-xl border border-purple-800/80 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-white text-sm">4. 20-to-30 Minute Volatility Breakout</h4>
                    <span className="text-[11px] text-neutral-400">Expiry: 20–30 Minutes · Best Pairs: GBP/USD, EUR/JPY</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 text-xs font-mono font-bold">
                    Not validated
                  </span>
                </div>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  Monitors multi-candle consolidation breakouts. Once verified with purged walk-forward confidence, takes position at 5M candle open for a longer 20m or 30m trend run.
                </p>
              </div>
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
                5-MINUTE CANDLE SCHEDULE
              </div>
              <div className="flex justify-between text-neutral-200 text-xs">
                <span>Entry Time (5M Open):</span>
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
                  {selectedSignal.strategyName || '5-Min Momentum Breakout'}
                </span>
                <span className="text-emerald-400 font-bold">
                  {selectedSignal.strategyEvidenceStatus === 'BACKTESTED' && typeof selectedSignal.strategyWinRate === 'number' ? `${selectedSignal.strategyWinRate.toFixed(1)}% Historical test WR · n=${selectedSignal.strategyHistoricalSampleSize || 0}` : 'Historical result not validated'}
                </span>
              </div>
              {(() => {
                const forward = getForwardPerformance(selectedSignal.strategyId);
                const scoredTrades = forward ? forward.wins + forward.losses : 0;
                return (
                  <div className="text-[11px] text-neutral-400 pt-2">
                    Forward paper results: {forward && forward.trades > 0
                      ? `${scoredTrades > 0 ? `${((forward.wins / scoredTrades) * 100).toFixed(1)}% across ${scoredTrades} scored outcomes` : 'No scored outcomes'} · ${forward.scratches} scratches · ${forward.netPips > 0 ? '+' : ''}${forward.netPips.toFixed(1)} modeled net pips`
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

              {/* NON-HUMAN MATHEMATICAL FORMULA & WHY HUMANS MISS THIS */}
              {selectedSignal.mathematicalFormula && (
                <div className="pt-2 border-t border-neutral-850 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-cyan-400 uppercase font-black tracking-wider flex items-center gap-1.5">
                      <Dna className="w-3.5 h-3.5" />
                      NOVEL NON-HUMAN MATHEMATICAL FORMULA
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

              {/* RULE-BASED LOSS DIAGNOSTICS */}
              {selectedSignal.lossAutopsy && (
                <div className="pt-2 border-t border-rose-900/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-rose-400 uppercase font-black tracking-wider flex items-center gap-1.5 font-mono">
                      <Microscope className="w-3.5 h-3.5 text-rose-400" />
                      RULE-BASED LOSS DIAGNOSTICS
                    </span>
                    <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono text-[9px] font-bold">
                      {selectedSignal.lossAutopsy.rootCause.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-900/60 text-xs text-neutral-300 space-y-2">
                    <div>
                      <strong className="text-rose-300 block mb-1 text-[11px]">Rule-based Diagnostic:</strong>
                      <p className="leading-relaxed text-[11px] text-neutral-300">
                        {selectedSignal.lossAutopsy.rootCauseExplanation}
                      </p>
                    </div>

                    <div className="pt-1.5 border-t border-rose-900/40">
                      <strong className="text-amber-400 block mb-1 text-[11px]">Algorithmic Lessons Learned:</strong>
                      <ul className="list-disc list-inside space-y-1 text-[11px] text-neutral-300">
                        {selectedSignal.lossAutopsy.lessonsLearned.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="pt-1.5 border-t border-rose-900/40">
                      <strong className="text-cyan-400 block mb-1 text-[11px]">Autonomously Evolved Antidote Strategy:</strong>
                      <div className="p-2 rounded-lg bg-neutral-950 border border-cyan-800/60 font-mono text-[10px] text-cyan-300 space-y-0.5">
                        <span className="font-bold text-white block">{selectedSignal.lossAutopsy.antidoteStrategyName}</span>
                        <span>{selectedSignal.lossAutopsy.antidoteFormula}</span>
                      </div>
                    </div>
                  </div>
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
              Closed paper outcomes are grouped by the session recorded at entry. This is a descriptive breakdown; it does not prove that a session causes better performance or that the model optimizes separately by session:
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
                        {sess.istRange} ({sess.utcRange})
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
                      <span className="text-[10px] text-neutral-400 block uppercase">Observed Paper Net Pips</span>
                      <span className={`text-sm font-bold ${sess.netPips >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {sess.netPips > 0 ? '+' : ''}{sess.netPips} Pips
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
                    Randomized formula candidates with historical validation and forward paper-trading evidence
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
                    Candidate Formula Generator
                  </span>
                  <p className="text-[11px] text-neutral-400">
                    Generates candidate formulas. Validation and promotion require out-of-sample evidence from uploaded historical candles.
                  </p>
                </div>
                <button
                  onClick={handleEvolveStrategy}
                  disabled={isEvolvingStrategy}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-linear-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-neutral-950 font-black text-xs transition-all shadow-lg shadow-cyan-950/50 disabled:opacity-50"
                >
                  <Sparkles className={`w-4 h-4 ${isEvolvingStrategy ? 'animate-spin' : ''}`} />
                  <span>{isEvolvingStrategy ? 'Evolving Next Generation...' : '🧬 Evolve New Strategy Now'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-neutral-850 text-xs font-mono">
                <div className="bg-neutral-900/80 p-2 rounded-lg border border-neutral-800">
                  <span className="text-[10px] text-neutral-400 block uppercase">Forward Approved</span>
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
                <p className="text-[11px] text-neutral-400 mt-1">Upload 1-minute CSV or JSON candles. Validation requires at least 10,000 structurally valid M1 rows. Synthetic fallback candles are rejected. The app checks OHLC and timestamps but cannot independently authenticate an uploaded file's provider or contents; import only genuine broker/provider exports.</p>
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
                The generator samples four executable operator families and stores the exact coefficients used by the live evaluator. A generated equation is only a candidate: it starts unvalidated, must pass a chronological historical test using the scheduled entry/expiry model, and then must accumulate at least 200 scored forward paper outcomes before it can be marked forward-approved.
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
                          Optimal Horizon: <strong className="text-amber-300">{gene.optimalHorizonMinutes} Min Dynamic Expiry</strong> · Session: <strong className="text-cyan-300">{gene.sessionAffinity}</strong>
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
                          Operator: {gene.nonLinearOperator}
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
                        <div><span className="text-neutral-500 block">EV / Profit factor</span><strong className="text-neutral-200">{gene.backtestMetrics.expectedValuePips.toFixed(2)} pips · {gene.backtestMetrics.profitFactor.toFixed(2)}</strong></div>
                        <div className="col-span-2 sm:col-span-4 text-neutral-500">95% Wilson interval for net-positive WR: {(gene.backtestMetrics.confidenceInterval95[0] * 100).toFixed(1)}%–{(gene.backtestMetrics.confidenceInterval95[1] * 100).toFixed(1)}%</div>
                      </div>
                    )}
                    {gene.forwardPerformance && (
                      <div className="text-[11px] font-mono text-neutral-300 bg-neutral-900/60 border border-neutral-800 rounded-lg p-3">
                        Forward paper results: {gene.forwardPerformance.wins}W / {gene.forwardPerformance.losses}L / {gene.forwardPerformance.scratches} scratches · {gene.forwardPerformance.trades} completed trades · {gene.forwardPerformance.netPips > 0 ? '+' : ''}{gene.livePerformance.netPips.toFixed(1)} net pips
                      </div>
                    )}
                    {gene.accuracyStatus !== 'BACKTESTED' && (
                      gene.operatorParameters ? (
                        <button
                          onClick={() => handleValidateGene(gene.id, gene.symbol)}
                          disabled={validatingGeneId === gene.id}
                          className="px-3 py-2 rounded-lg bg-cyan-900/60 border border-cyan-700 text-cyan-200 text-[11px] font-semibold disabled:opacity-50"
                        >
                          {validatingGeneId === gene.id ? 'Validating against imported history…' : `Validate against ${gene.symbol || historyImportPair} history`}
                        </button>
                      ) : (
                        <span className="text-[10px] text-neutral-500">Legacy candidate has no stored executable coefficients. Generate a new candidate to validate it.</span>
                      )
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
