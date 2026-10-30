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
import { Compass, LineChart, Brain, Menu, Zap, Bell, Lightbulb } from 'lucide-react';
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
  const [activeNotification, setActiveNotification] = useState<AppNotification | null>(null);
  const notifiedIdsRef = React.useRef<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRunningCycle, setIsRunningCycle] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);

  const fetchAllData = async () => {
    try {
      const [sigRes, histRes, revRes, genRes, healthRes, autoRes] = await Promise.all([
        fetch('/api/signals').then(r => r.json()).catch(() => ({ signals: [] })),
        fetch('/api/research/history').then(r => r.json()).catch(() => ({ experiments: [], generations: [] })),
        fetch('/api/research/agents').then(r => r.json()).catch(() => ({ reviews: [] })),
        fetch('/api/evolution/state').then(r => r.json()).catch(() => ({ generations: [] })),
        fetch('/api/system/health').then(r => r.json()).catch(() => ({ providers: [] })),
        fetch('/api/autopilot/logs').then(r => r.json()).catch(() => ({ logs: [] })),
      ]);

      if (sigRes?.signals) {
        setSignals(sigRes.signals);

        // Check for fresh signals generated within last 3 minutes (180s) to notify user
        const nowMs = Date.now();
        for (const sig of sigRes.signals) {
          if (!notifiedIdsRef.current.has(sig.id)) {
            notifiedIdsRef.current.add(sig.id);
            const ageSec = Math.floor((nowMs - Date.parse(sig.predictionTimeUtc)) / 1000);
            if (!sig.paperOnly && ageSec <= 180 && ['WAITING_FOR_ENTRY', 'ACTIVE'].includes(sig.lifecycleState)) {
              // Play chime and show toast banner with 3-minute advance notice and IST timings
              soundNotificationService.playSignalAlertSound();
              soundNotificationService.sendBrowserNotification(
                `🔔 3-Min Advance Signal: ${sig.symbol} ${sig.direction}`,
                `Entry at ${sig.candleOpenTimeIst || '5M Open'} · Dynamic Expiry: ${sig.expiryMinutes}m`
              );
              setActiveNotification({
                id: `notif_${sig.id}`,
                signalId: sig.id,
                symbol: sig.symbol,
                direction: sig.direction,
                title: `🔔 3-Min Advance Signal: ${sig.symbol} ${sig.direction}`,
                message: `Scheduled entry at 5M candle open (${sig.candleOpenTimeIst}). Dynamic Expiry: ${sig.expiryMinutes} Min.`,
                timestamp: sig.predictionTimeUtc,
                triggerPrice: sig.triggerPrice,
                expiryMinutes: sig.expiryMinutes,
                read: false,
                candleOpenTimeIst: sig.candleOpenTimeIst,
                candleCloseTimeIst: sig.candleCloseTimeIst,
                advanceNoticeText: '3-Minute Advance Signal Alert',
              });
              break;
            }
          }
        }
      }
      if (histRes?.experiments) setExperiments(histRes.experiments);
      if (revRes?.reviews) setReviews(revRes.reviews);
      if (genRes?.generations) setGenerations(genRes.generations);
      if (healthRes?.providers) setProviders(healthRes.providers);
      if (autoRes?.logs) setAutopilotLogs(autoRes.logs);
    } catch (err) {
      console.error('Failed to sync SignalForge data:', err);
    }
  };

  useEffect(() => {
    fetchAllData();
    // Live Autopilot Pulse Stream: 3 second polling
    const interval = setInterval(fetchAllData, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleRunCycle = async () => {
    setIsRunningCycle(true);
    try {
      const res = await fetch('/api/evolution/run', { method: 'POST' });
      if (res.ok) {
        await fetchAllData();
      }
    } catch (err) {
      console.error('Failed to run research cycle:', err);
    } finally {
      setIsRunningCycle(false);
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

  const activeSignalsCount = signals.filter(s =>
    ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE'].includes(s.lifecycleState)
  ).length;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100 antialiased select-none font-sans relative">
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
        onRunCycle={handleRunCycle}
        isRunningCycle={isRunningCycle}
        onRefresh={fetchAllData}
        isRefreshing={isRefreshing}
        activeSignalsCount={activeSignalsCount}
        onToggleSidebar={() => setIsMobileMenuOpen(prev => !prev)}
        isSidebarOpen={isMobileMenuOpen}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Navigation Sidebar (Desktop persistent, mobile collapsible drawer) */}
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          activeSignalsCount={activeSignalsCount}
          totalExperiments={experiments.length}
          isOpen={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
        />

        {/* Dynamic View Viewport */}
        <main className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-950">
          {activeTab === 'terminal' && (
            <SignalTerminalView
              signals={signals}
              autopilotLogs={autopilotLogs}
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
            <EvolutionLabView
              generations={generations}
              onTriggerGeneration={handleRunCycle}
              isRunning={isRunningCycle}
            />
          )}
          {activeTab === 'agents' && <ResearchAgentsView reviews={reviews} />}
          {activeTab === 'monitor' && <EntryExitMonitorView signals={signals} />}
          {activeTab === 'analytics' && (
            <PerformanceAnalyticsView experiments={experiments} signals={signals} />
          )}
          {activeTab === 'health' && <SystemHealthView />}
          {activeTab === 'config' && <ConfigurationView />}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (Super Clean & Intuitive) */}
      <nav className="lg:hidden h-14 border-t border-neutral-800 bg-neutral-950/95 backdrop-blur px-2 flex items-center justify-around shrink-0 z-20">
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
          <span className="text-[10px]">5M Signals</span>
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
          <span className="text-[10px]">Charts</span>
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
