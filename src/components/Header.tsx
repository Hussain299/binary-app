import React, { useEffect, useState } from 'react';
import { Clock3, Layers, Menu, RefreshCw, X } from 'lucide-react';

interface HeaderProps {
  onRefresh: () => void;
  isRefreshing: boolean;
  activeSignalsCount: number;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onRefresh,
  isRefreshing,
  activeSignalsCount,
  onToggleSidebar,
  isSidebarOpen,
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
    <header className="relative z-30 flex h-[58px] shrink-0 items-center justify-between border-b border-white/[0.07] bg-[#0b1018]/95 px-3 backdrop-blur-xl sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={isSidebarOpen ? 'Close navigation' : 'Open navigation'}
            className="rounded-lg border border-white/[0.08] p-2 text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-white lg:hidden"
          >
            {isSidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        )}
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300">
            <Layers className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-bold tracking-[0.08em] text-white">SIGNALFORGE</div>
            <div className="hidden text-[10px] text-neutral-500 sm:block">Research workspace</div>
          </div>
        </div>
        <span className="hidden rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1 text-[10px] font-medium text-neutral-400 md:inline-flex">
          PAPER ONLY
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {activeSignalsCount > 0 && (
          <div className="hidden items-center gap-1.5 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.06] px-2.5 py-1.5 text-[11px] text-emerald-300 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {activeSignalsCount} active
          </div>
        )}
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.035] px-2.5 py-1.5 text-[11px] text-neutral-300 tabular-nums">
          <Clock3 className="h-3.5 w-3.5 text-neutral-500" />
          <span>{timeIst}</span>
          <span className="text-neutral-500">IST</span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh data"
          title="Refresh data"
          className="rounded-lg border border-white/[0.08] p-2 text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin text-emerald-300' : ''}`} />
        </button>
      </div>
    </header>
  );
};
