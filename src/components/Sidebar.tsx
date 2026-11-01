import React from 'react';
import {
  BarChart3,
  Brain,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Compass,
  Dna,
  History,
  Lightbulb,
  LineChart,
  Settings,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';

export type ViewTab =
  | 'terminal'
  | 'opportunities'
  | 'learning'
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
  totalExperiments: number;
  isOpen?: boolean;
  isCollapsed?: boolean;
  onClose?: () => void;
  onToggleCollapse?: () => void;
}

const groups: Array<{
  label: string;
  items: Array<{
    id: ViewTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: 'history';
  }>;
}> = [
  {
    label: 'Workspace',
    items: [
      { id: 'terminal', label: 'Daily audit', icon: Zap },
      { id: 'opportunities', label: 'Opportunities', icon: BrainCircuit },
      { id: 'explorer', label: 'Markets', icon: LineChart },
      { id: 'strategy', label: 'Strategies', icon: Lightbulb },
      { id: 'analytics', label: 'Performance', icon: BarChart3 },
      { id: 'monitor', label: 'Entry & exit', icon: Clock3 },
    ],
  },
  {
    label: 'Research',
    items: [
      { id: 'learning', label: 'Learning lab', icon: BrainCircuit },
      { id: 'evolution', label: 'Evolution', icon: Dna },
      { id: 'history', label: 'Research history', icon: History, count: 'history' },
      { id: 'agents', label: 'Research agents', icon: Brain },
      { id: 'modellab', label: 'Model lab', icon: Compass },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'health', label: 'Data health', icon: ShieldCheck },
      { id: 'config', label: 'Settings', icon: Settings },
    ],
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  totalExperiments,
  isOpen = false,
  isCollapsed = false,
  onClose,
  onToggleCollapse,
}) => {
  const handleSelect = (id: ViewTab) => {
    onTabChange(id);
    onClose?.();
  };

  const renderNavigation = (compact: boolean) => (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-3">
      {groups.map(group => (
        <section key={group.label} className="sf-nav-group mb-4 last:mb-0">
          {!compact && (
            <div className="sf-nav-group-label">
              {group.label}
            </div>
          )}
          <div className="space-y-1">
            {group.items.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              const count = item.count === 'history' ? totalExperiments : 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={compact ? item.label : undefined}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => handleSelect(item.id)}
                  className={`sf-nav-item group relative flex h-10 w-full items-center gap-3 text-left text-[13px] font-medium ${compact ? 'is-compact justify-center px-0' : ''} ${isActive ? 'is-active' : ''}`}
                >
                  <Icon className="sf-nav-icon" />
                  {!compact && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                  {!compact && count > 0 && (
                    <span className="sf-nav-count">
                      {count > 999 ? '999+' : count}
                    </span>
                  )}
                  {compact && count > 0 && (
                    <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );

  const footer = (compact: boolean) => (
    <div className="sf-sidebar-footer border-t p-3">
      {compact ? (
        <div className="flex flex-col items-center gap-2 text-[9px] font-semibold text-neutral-500">
          <span title="Three-minute advance decision">T−3</span>
          <span className="h-px w-5 bg-white/10" />
          <span title="Five to thirty minute horizons">5–30</span>
        </div>
      ) : (
        <>
          <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500">Research rules</div>
          <div className="flex flex-wrap gap-1.5">
            <span className="sf-rule-chip">3m advance</span>
            <span className="sf-rule-chip">5–30m candles</span>
            <span className="sf-rule-chip">Paper only</span>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <aside className={`sf-sidebar hidden shrink-0 flex-col transition-[width] duration-300 ease-out lg:flex
        ${isCollapsed ? 'w-[72px]' : 'w-[232px]'}`}>
        <div className={`sf-sidebar-header flex shrink-0 items-center ${isCollapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
          {!isCollapsed && <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">Workspace</span>}
          <button
            type="button"
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-label={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            className="sf-icon-button !h-8 !w-8 !rounded-lg !border-transparent !bg-transparent"
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
        {renderNavigation(isCollapsed)}
        {footer(isCollapsed)}
      </aside>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="sf-mobile-scrim absolute inset-0"
          />
          <aside className="sf-mobile-drawer relative z-10 flex h-full w-[280px] max-w-[86vw] flex-col">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] px-4">
              <span className="text-sm font-semibold text-white">Navigation</span>
              <button type="button" onClick={onClose} aria-label="Close navigation" className="sf-icon-button">
                <X className="h-4 w-4" />
              </button>
            </div>
            {renderNavigation(false)}
            {footer(false)}
          </aside>
        </div>
      )}
    </>
  );
};
