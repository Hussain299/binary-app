import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.tsx';
import { Sidebar, ViewTab } from './components/Sidebar.tsx';
import { SignalTerminalView } from './components/views/SignalTerminalView.tsx';
import { MarketExplorerView } from './components/views/MarketExplorerView.tsx';
import { ModelLabView } from './components/views/ModelLabView.tsx';
import { StrategyDiscoveryView } from './components/views/StrategyDiscoveryView.tsx';
import { ExperimentHistoryView } from './components/views/ExperimentHistoryView.tsx';
import { EvolutionLabView } from './components/views/EvolutionLabView.tsx';
import { ResearchAgentsView } from './components/views/ResearchAgentsView.tsx';
import { EntryExitMonitorView } from './components/views/EntryExitMonitorView.tsx';
import { PerformanceAnalyticsView } from './components/views/PerformanceAnalyticsView.tsx';
import { SystemHealthView } from './components/views/SystemHealthView.tsx';
import { ConfigurationView } from './components/views/ConfigurationView.tsx';
import { LineChart, Menu, Zap, Lightbulb } from 'lucide-react';
import { soundNotificationService } from './utils/notifications.ts';
import { NotificationBanner } from './components/NotificationBanner.tsx';
import {
  AgentReview,
  AppNotification,
  AutopilotLog,
  EvolutionGeneration,
  ProviderHealth,
  ResearchExperiment,
  ResearchSignal,
} from './types/index.ts';

export default function App() {
  const [activeTab, setActiveTab] = useState<ViewTab>('terminal');
  const [signals, setSignals] = useState<ResearchSignal[]>([]);
  const [experiments, setExperiments] = useState<ResearchExperiment[]>([]);
  const [reviews, setReviews] = useState<AgentReview[]>([]);
  const [generations, setGenerations] = useState<EvolutionGeneration[]>([]);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [autopilotLogs, setAutopilotLogs] = useState<AutopilotLog[]>([]);
  const [autopilotStatus, setAutopilotStatus] = useState<any>(null);
  const [activeNotification, setActiveNotification] = useState<AppNotification | null>(null);
  const notifiedIdsRef = React.useRef<Set<string>>(new Set());
  const fetchInFlightRef = React.useRef<Promise<void> | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);

  const fetchAllData = async () => {
    // Keep polling and manual refresh single-flight. This prevents stale snapshots
    // without starving updates when a provider/API response takes longer than 3s.
    if (fetchInFlightRef.current) return fetchInFlightRef.current;

    const request = (async () => {
      try {
        const [sigRes, histRes, revRes, genRes, healthRes, autoRes, autoStatusRes] = await Promise.all([
          fetch('/api/signals').then(r => r.json()).catch(() => ({ signals: [] })),
          fetch('/api/research/history').then(r => r.json()).catch(() => ({ experiments: [], generations: [] })),
          fetch('/api/research/agents').then(r => r.json()).catch(() => ({ reviews: [] })),
          fetch('/api/evolution/state').then(r => r.json()).catch(() => ({ generations: [] })),
          fetch('/api/system/health').then(r => r.json()).catch(() => ({ providers: [] })),
          fetch('/api/autopilot/logs').then(r => r.json()).catch(() => ({ logs: [] })),
          fetch('/api/autopilot/status').then(r => r.json()).catch(() => null),
        ]);

        if (sigRes?.signals) {
          setSignals(sigRes.signals);

          // Check for fresh signals generated within last 3 minutes (180s) to notify user.
          const nowMs = Date.now();
          for (const sig of sigRes.signals) {
            if (notifiedIdsRef.current.has(sig.id)) continue;

            const predictionTimeMs = Date.parse(sig.predictionTimeUtc);
            if (!Number.isFinite(predictionTimeMs)) continue;
            const ageSec = Math.floor((nowMs - predictionTimeMs) / 1000);

            // Do not mark a future-dated record as notified; it may become valid
            // on a later poll. Only retire genuinely expired records.
            if (ageSec > 180) {
              notifiedIdsRef.current.add(sig.id);
              continue;
            }
            if (ageSec < 0) continue;

            if (
              ageSec <= 180 &&
              ['WAITING_FOR_ENTRY', 'ACTIVE'].includes(sig.lifecycleState)
            ) {
              notifiedIdsRef.current.add(sig.id);
              const isPaperOnly = Boolean(sig.paperOnly);
              const alertTitle = isPaperOnly
                ? `📊 PAPER RESEARCH: ${sig.symbol} ${sig.direction}`
                : `🔔 3-Min Advance Signal: ${sig.symbol} ${sig.direction}`;
              const entryLabel = sig.candleOpenTimeIst || '5M Open';
              const alertBody = isPaperOnly
                ? `Paper-only observation. No broker order is placed. Entry at ${entryLabel}; expiry ${sig.expiryMinutes}m.`
                : `Entry at ${entryLabel} · Dynamic Expiry: ${sig.expiryMinutes}m`;

              soundNotificationService.playSignalAlertSound();
              soundNotificationService.sendBrowserNotification(alertTitle, alertBody);
              setActiveNotification({
                id: `notif_${sig.id}`,
                signalId: sig.id,
                symbol: sig.symbol,
                direction: sig.direction,
                title: alertTitle,
                message: alertBody,
                timestamp: sig.predictionTimeUtc,
                triggerPrice: sig.triggerPrice,
                expiryMinutes: sig.expiryMinutes,
                read: false,
                paperOnly: isPaperOnly,
                candleOpenTimeIst: sig.candleOpenTimeIst,
                candleCloseTimeIst: sig.candleCloseTimeIst,
                advanceNoticeText: isPaperOnly ? 'Paper Research Signal' : '3-Minute Advance Signal Alert',
              });
              break;
            }
          }
        }
        if (histRes?.experiments) setExperiments(histRes.experiments);
        if (revRes?.reviews) setReviews(revRes.reviews);
        if (genRes?.generations) setGenerations(genRes.generations);
        if (healthRes?.providers) setProviders(healthRes.providers);
        if (autoRes?.logs) setAutopilotLogs(autoRes.logs);
        if (autoStatusRes) setAutopilotStatus(autoStatusRes);
      } catch (err) {
        console.error('Failed to sync SignalForge data:', err);
      }
    })();

    fetchInFlightRef.current = request;
    try {
      await request;
    } finally {
      if (fetchInFlightRef.current === request) fetchInFlightRef.current = null;
    }
  };

  useEffect(() => {
    fetchAllData();
    // Live Autopilot Pulse Stream: 3 second polling
    const interval = setInterval(fetchAllData, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchAllData();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleEvaluateSignals = async () => {
    setIsEvaluating(true);
    try {
      const res = await fetch('/api/signals/evaluate', { method: 'POST' });
      if (res.ok) {
        await fetchAllData();
      }
    } catch (err) {
      console.error('Failed to evaluate signals:', err);
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleExperimentComplete = (newExp: ResearchExperiment) => {
    setExperiments(prev => [newExp, ...prev]);
    fetchAllData();
  };

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const activeSignalsCount = signals.filter(s =>
    ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE'].includes(s.lifecycleState)
  ).length;

  return (
    <div className="app-shell sf-app-shell relative flex min-h-[100dvh] w-full min-w-0 flex-col text-neutral-100 antialiased font-sans">
      {/* Real-time In-App Signal Alert Banner */}
      <NotificationBanner
        notification={activeNotification}
        onDismiss={() => setActiveNotification(null)}
        onSelectSignal={(sigId) => {
          setActiveTab('terminal');
        }}
      />

      {/* Top Header with Hamburger Toggle */}
      <Header
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        onToggleSidebar={() => setIsMobileMenuOpen(prev => !prev)}
        isSidebarOpen={isMobileMenuOpen}
        autopilotStatus={autopilotStatus}
      />

      {/* Main Content Area */}
      <div className="flex flex-1 min-w-0 items-stretch">
        {/* Navigation Sidebar (Desktop persistent, mobile collapsible drawer) */}
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          activeSignalsCount={activeSignalsCount}
          totalExperiments={experiments.length}
          isOpen={isMobileMenuOpen}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(prev => !prev)}
          onClose={() => setIsMobileMenuOpen(false)}
        />

        {/* Dynamic View Viewport */}
        <main className="app-main min-w-0 flex flex-1 flex-col bg-transparent">
          <div key={activeTab} className="sf-view-stage">
          {activeTab === 'terminal' && (
            <SignalTerminalView
              signals={signals}
              autopilotLogs={autopilotLogs}
              autopilotStatus={autopilotStatus}
              onEvaluateSignals={handleEvaluateSignals}
              isEvaluating={isEvaluating}
            />
          )}
          {activeTab === 'explorer' && <MarketExplorerView providers={providers} />}
          {activeTab === 'modellab' && (
            <ModelLabView
              experiments={experiments}
              onExperimentComplete={handleExperimentComplete}
            />
          )}
          {activeTab === 'strategy' && (
            <StrategyDiscoveryView onGoToSignals={() => setActiveTab('terminal')} />
          )}
          {activeTab === 'history' && <ExperimentHistoryView experiments={experiments} />}
          {activeTab === 'evolution' && (
            <EvolutionLabView generations={generations} />
          )}
          {activeTab === 'agents' && <ResearchAgentsView reviews={reviews} />}
          {activeTab === 'monitor' && <EntryExitMonitorView signals={signals} />}
          {activeTab === 'analytics' && (
            <PerformanceAnalyticsView experiments={experiments} signals={signals} />
          )}
          {activeTab === 'health' && <SystemHealthView />}
          {activeTab === 'config' && <ConfigurationView />}
          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (Super Clean & Intuitive) */}
      <nav className="app-bottom-nav lg:hidden h-14 border-t border-white/[0.07] bg-[#0b1018]/95 backdrop-blur px-2 flex items-center justify-around shrink-0 z-20">
        <button
          onClick={() => {
            setActiveTab('terminal');
            setIsMobileMenuOpen(false);
          }}
          className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 transition-colors ${
            activeTab === 'terminal' ? 'text-emerald-400 font-bold' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Zap className="w-4 h-4" />
          <span className="text-[10px]">Signals</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('strategy');
            setIsMobileMenuOpen(false);
          }}
          className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 transition-colors ${
            activeTab === 'strategy' ? 'text-amber-400 font-bold' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Lightbulb className="w-4 h-4" />
          <span className="text-[10px]">Strategies</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('explorer');
            setIsMobileMenuOpen(false);
          }}
          className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 transition-colors ${
            activeTab === 'explorer' ? 'text-cyan-400 font-bold' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <LineChart className="w-4 h-4" />
          <span className="text-[10px]">Markets</span>
        </button>

        <button
          onClick={() => setIsMobileMenuOpen(prev => !prev)}
          className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 transition-colors ${
            isMobileMenuOpen ? 'text-white font-bold' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Menu className="w-4 h-4" />
          <span className="text-[10px]">Menu</span>
        </button>
      </nav>
    </div>
  );
}
