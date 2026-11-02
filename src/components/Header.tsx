import React, { useEffect, useState } from 'react';
import { Clock3, Layers, Menu, RefreshCw, X } from 'lucide-react';

interface HeaderProps {
  onRefresh: () => void;
  isRefreshing: boolean;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
  autopilotStatus?: { schedulerStarted?: boolean; cycleRunning?: boolean } | null;
  isAutopilotChanging?: boolean;
  onToggleAutopilot?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onRefresh,
  isRefreshing,
  onToggleSidebar,
  isSidebarOpen,
  autopilotStatus,
  isAutopilotChanging = false,
  onToggleAutopilot,
}) => {
  const [timeIst, setTimeIst] = useState('');

  useEffect(() => {
    const updateClock = () => {
      setTimeIst(new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(new Date()));
    };
    updateClock();
    const interval = setInterval(updateClock, 15_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="sf-topbar relative z-30 flex shrink-0 items-center justify-between px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={isSidebarOpen ? 'Close navigation' : 'Open navigation'}
            className="sf-icon-button lg:hidden"
          >
            {isSidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        )}
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="sf-brand-mark">
            <Layers className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="sf-brand-name truncate">SIGNALFORGE</div>
            <div className="sf-brand-caption hidden sm:block">Autonomous research intelligence</div>
          </div>
        </div>
        <span className="sf-status-pill hidden md:inline-flex">
          PAPER ONLY
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div className="sf-clock tabular-nums">
          <Clock3 className="h-3.5 w-3.5 text-neutral-500" />
          <span>{timeIst}</span>
          <span className="text-neutral-500">IST</span>
        </div>
        {onToggleAutopilot && (
          <button
            type="button"
            onClick={onToggleAutopilot}
            disabled={!autopilotStatus || isAutopilotChanging}
            aria-label={autopilotStatus?.schedulerStarted ? 'Stop paper bot' : 'Start paper bot'}
            title={autopilotStatus?.schedulerStarted ? 'Pause future market and research cycles; an active cycle may finish' : 'Start market sensing and autonomous research'}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-bold tracking-wide transition disabled:cursor-not-allowed disabled:opacity-50 ${autopilotStatus?.schedulerStarted ? 'border-rose-400/25 bg-rose-400/10 text-rose-200 hover:bg-rose-400/15' : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15'}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${autopilotStatus?.schedulerStarted ? 'bg-rose-300' : 'bg-emerald-300'}`} />
            {autopilotStatus?.schedulerStarted ? 'STOP BOT' : 'START BOT'}
          </button>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh data"
          title="Refresh data"
          className="sf-icon-button disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin text-emerald-300' : ''}`} />
        </button>
      </div>
    </header>
  );
};
