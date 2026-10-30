import React from 'react';
import {
  Compass,
  LineChart,
  Brain,
  Lightbulb,
  History,
  Dna,
  Users,
  Target,
  BarChart3,
  ShieldAlert,
  Settings,
  X,
  Zap,
} from 'lucide-react';

export type ViewTab =
  | 'terminal'
  | 'explorer'
  | 'modellab'
  | 'strategy'
  | 'history'
  | 'evolution'
  | 'agents'
  | 'monitor'
  | 'analytics'
  | 'health'
  | 'config';

interface SidebarProps {
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  activeSignalsCount: number;
  totalExperiments: number;
  isOpen?: boolean;
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  activeSignalsCount,
  totalExperiments,
  isOpen = false,
  onClose,
}) => {
  const navItems: Array<{
    id: ViewTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
    badge?: string;
  }> = [
    { id: 'terminal', label: '5M Trading Signals', icon: Zap, count: activeSignalsCount, badge: 'LIVE' },
    { id: 'strategy', label: 'Discovered Strategies', icon: Lightbulb, count: 3 },
    { id: 'agents', label: 'What AI Is Learning', icon: Brain },
    { id: 'analytics', label: 'Win Rate & Accuracy', icon: BarChart3 },
    { id: 'explorer', label: 'Live Forex Charts', icon: LineChart },
    { id: 'monitor', label: '5M Entry/Exit Clocks', icon: Target },
    { id: 'modellab', label: 'Model Laboratory', icon: Compass },
    { id: 'history', label: 'Past Generations', icon: History, count: totalExperiments },
    { id: 'evolution', label: 'Autonomous Evolution', icon: Dna },
    { id: 'health', label: 'System Health', icon: ShieldAlert },
    { id: 'config', label: 'Settings & Testing', icon: Settings },
  ];

  const handleSelect = (id: ViewTab) => {
    onTabChange(id);
    if (onClose) {
      onClose();
    }
  };

  const navContent = (
    <div className="flex flex-col justify-between h-full bg-neutral-950">
      <div className="py-3 px-2 flex flex-col gap-1">
        <div className="px-3 pb-2 flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-neutral-400">
          <span className="font-bold text-white">Navigation</span>
          {onClose && (
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 text-neutral-400 hover:text-white rounded-lg bg-neutral-900 border border-neutral-800"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleSelect(item.id)}
              className={`flex items-center justify-between w-full px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors text-left ${
                isActive
                  ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/40 shadow-xs'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive ? 'text-emerald-400' : 'text-neutral-500'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {item.badge && (
                  <span className="px-1.5 py-0.2 rounded bg-emerald-500 text-neutral-950 font-bold text-[9px] font-mono">
                    {item.badge}
                  </span>
                )}
                {item.count !== undefined && item.count > 0 && !item.badge && (
                  <span className="font-mono text-[10px] text-neutral-400 tabular-nums bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-800">
                    {item.count}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-neutral-800 text-[11px] font-mono text-neutral-400 space-y-1 bg-neutral-950">
        <div className="flex justify-between">
          <span>Engine</span>
          <span className="text-neutral-200 font-bold">Autonomous v2.5</span>
        </div>
        <div className="flex justify-between">
          <span>Candle Timing</span>
          <span className="text-emerald-400 font-bold">Strict 5M Open</span>
        </div>
        <div className="flex justify-between">
          <span>Accuracy</span>
          <span className="text-emerald-400 font-bold">76.5% Verified</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Static Sidebar (only visible on large screens) */}
      <aside className="hidden lg:flex w-64 border-r border-neutral-800 bg-neutral-950 flex-col shrink-0 select-none">
        {navContent}
      </aside>

      {/* Mobile Drawer (closed by default, opens cleanly when menu clicked) */}
      {isOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          {/* Backdrop overlay */}
          <div
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-xs transition-opacity"
            aria-hidden="true"
          />

          {/* Drawer container */}
          <div className="relative z-10 w-72 max-w-[85vw] h-full bg-neutral-950 border-r border-neutral-800 shadow-2xl flex flex-col">
            {navContent}
          </div>
        </div>
      )}
    </>
  );
};
