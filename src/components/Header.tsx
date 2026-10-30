import React, { useState, useEffect } from 'react';
import {
  Globe,
  Clock,
  Play,
  RotateCw,
  Layers,
  Menu,
  X,
  Bell,
  Zap,
} from 'lucide-react';
import { soundNotificationService } from '../utils/notifications.ts';

interface HeaderProps {
  onRunCycle: () => void;
  isRunningCycle: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
  activeSignalsCount: number;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onRunCycle,
  isRunningCycle,
  onRefresh,
  isRefreshing,
  activeSignalsCount,
  onToggleSidebar,
  isSidebarOpen,
}) => {
  const [timeUtc, setTimeUtc] = useState<string>('');
  const [timeIst, setTimeIst] = useState<string>('');
  const [sessions, setSessions] = useState<{
    sydney: boolean;
    tokyo: boolean;
    london: boolean;
    newYork: boolean;
  }>({ sydney: false, tokyo: false, london: false, newYork: false });

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeUtc(now.toISOString().substring(11, 19) + ' UTC');
      setTimeIst(
        new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }).format(now).toUpperCase() + ' IST'
      );

      const utcHour = now.getUTCHours();
      setSessions({
        sydney: utcHour >= 22 || utcHour < 7,
        tokyo: utcHour >= 0 && utcHour < 9,
        london: utcHour >= 8 && utcHour < 16,
        newYork: utcHour >= 13 && utcHour < 21,
      });
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="h-14 border-b border-neutral-800 bg-neutral-950/95 backdrop-blur px-3 sm:px-4 flex items-center justify-between z-20 shrink-0 select-none">
      {/* Brand & Menu Toggle */}
      <div className="flex items-center gap-2 sm:gap-3">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            aria-label="Toggle navigation menu"
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-neutral-300 hover:text-white bg-neutral-900 border border-neutral-800 transition-colors shrink-0"
          >
            {isSidebarOpen ? (
              <X className="w-4 h-4 text-emerald-400" />
            ) : (
              <Menu className="w-4 h-4 text-emerald-400" />
            )}
            <span className="text-xs font-bold sm:hidden">Menu</span>
          </button>
        )}

        <div className="flex items-center gap-1.5 font-mono text-sm font-black tracking-tight text-white">
          <Layers className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>SIGNALFORGE</span>
        </div>

        <div className="hidden md:flex items-center gap-2 text-xs text-neutral-400 font-mono">
          <span className="text-neutral-600">/</span>
          <span className="text-emerald-400 font-bold">5M TRADING BOT</span>
          <span className="text-neutral-600">·</span>
          <span className="text-neutral-400">AUTONOMOUS</span>
        </div>
      </div>

      {/* Clocks & Controls */}
      <div className="flex items-center gap-2 sm:gap-3 text-xs">
        {/* Market Sessions (Desktop only) */}
        <div className="hidden xl:flex items-center gap-2 text-neutral-400 font-mono">
          <Globe className="w-3.5 h-3.5 text-neutral-500" />
          <span className={sessions.london ? 'text-emerald-400 font-semibold' : 'text-neutral-500'}>
            LDN
          </span>
          <span className="text-neutral-600">·</span>
          <span className={sessions.newYork ? 'text-emerald-400 font-semibold' : 'text-neutral-500'}>
            NYC
          </span>
          <span className="text-neutral-600">·</span>
          <span className={sessions.tokyo ? 'text-emerald-400 font-semibold' : 'text-neutral-500'}>
            TYO
          </span>
          <span className="text-neutral-600">·</span>
          <span className={sessions.sydney ? 'text-emerald-400 font-semibold' : 'text-neutral-500'}>
            SYD
          </span>
        </div>

        {/* Live IST Clock (Always Visible, Clear) */}
        <div className="flex items-center gap-1.5 text-neutral-200 font-mono tabular-nums bg-neutral-900 border border-neutral-800 px-2.5 py-1 rounded-lg text-xs font-bold shrink-0">
          <Clock className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-white">{timeIst}</span>
        </div>

        {/* Audio Chime Button */}
        <button
          onClick={() => {
            soundNotificationService.playSignalAlertSound();
            soundNotificationService.sendBrowserNotification(
              '⚡ Signal Alert Test',
              'Sound alert working! Signals will chime automatically.'
            );
          }}
          title="Test audio chime alert"
          className="p-1.5 sm:px-2.5 sm:py-1 rounded-lg text-xs font-medium text-amber-300 bg-amber-950/40 hover:bg-amber-900/60 border border-amber-800/80 transition-colors flex items-center gap-1"
        >
          <Bell className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden md:inline">Chime</span>
        </button>

        {/* Sync Button (Desktop) */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Sync live signals"
          className="hidden sm:flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-neutral-300 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg transition-colors disabled:opacity-50"
        >
          <RotateCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
          <span>Sync</span>
        </button>

        {/* Force Pulse Button (Desktop) */}
        <button
          onClick={onRunCycle}
          disabled={isRunningCycle}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-neutral-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors disabled:opacity-50 shadow-sm"
        >
          <Play className={`w-3 h-3 ${isRunningCycle ? 'animate-pulse' : ''}`} />
          <span>{isRunningCycle ? 'Scanning...' : 'Scan Now'}</span>
        </button>
      </div>
    </header>
  );
};
