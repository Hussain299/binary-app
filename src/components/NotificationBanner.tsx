import React from 'react';
import { Bell, ArrowUpRight, ArrowDownRight, X, Clock, Zap } from 'lucide-react';
import { AppNotification } from '../types/index.js';

interface NotificationBannerProps {
  notification: AppNotification | null;
  onDismiss: () => void;
  onSelectSignal: (signalId: string) => void;
}

export const NotificationBanner: React.FC<NotificationBannerProps> = ({
  notification,
  onDismiss,
  onSelectSignal,
}) => {
  if (!notification) return null;

  const isBuy = notification.direction === 'BUY';

  // Calculate age string
  const diffSec = Math.max(0, Math.floor((Date.now() - Date.parse(notification.timestamp)) / 1000));
  const ageStr =
    diffSec < 60
      ? `${diffSec}s ago`
      : `${Math.floor(diffSec / 60)}m ${diffSec % 60}s ago`;

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

  return (
    <div className="fixed top-14 left-3 right-3 sm:left-auto sm:right-6 sm:w-[420px] z-50 animate-bounce-once">
      <div className="bg-neutral-900 border-2 border-emerald-500 rounded-2xl shadow-2xl p-4 flex flex-col gap-3 backdrop-blur-md">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded-full bg-amber-500/20 text-amber-400">
              <Zap className="w-4 h-4 animate-pulse" />
            </span>
            <span className="font-extrabold text-xs uppercase tracking-wider text-amber-400">
              🔔 3-Min Advance Signal Alert
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-neutral-400 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800">
              {ageStr}
            </span>
            <button
              onClick={onDismiss}
              className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800"
              aria-label="Dismiss alert"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Pair & Direction in Big Bold Style */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xl font-black text-white">
              {notification.symbol}
            </span>
            <span
              className={`px-3 py-1 rounded-xl text-xs font-black font-mono flex items-center gap-1 shadow-md ${
                isBuy ? 'bg-emerald-500 text-neutral-950' : 'bg-rose-500 text-white'
              }`}
            >
              {isBuy ? <ArrowUpRight className="w-4 h-4 stroke-[3]" /> : <ArrowDownRight className="w-4 h-4 stroke-[3]" />}
              {notification.direction} ({notification.expiryMinutes || 5}M)
            </span>
          </div>

          <div className="text-right font-mono text-xs text-neutral-400">
            <span>Trigger: </span>
            <strong className="text-white">{notification.triggerPrice}</strong>
          </div>
        </div>

        {/* Timings */}
        <div className="bg-neutral-950 p-2.5 rounded-xl border border-neutral-800/80 font-mono text-xs flex justify-between items-center">
          <div>
            <span className="text-[10px] text-emerald-400 block font-bold">5M CANDLE OPEN ENTRY</span>
            <span className="text-white font-extrabold">{notification.candleOpenTimeIst || formatIST(notification.timestamp)}</span>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-rose-400 block font-bold">EXPIRY ({notification.expiryMinutes || 5} MIN)</span>
            <span className="text-neutral-200 font-extrabold">{notification.candleCloseTimeIst || '5M Candle Close'}</span>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={() => {
            onSelectSignal(notification.signalId);
            onDismiss();
          }}
          className="w-full py-2 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold rounded-xl transition-colors text-xs text-center shadow-lg shadow-emerald-950/50"
        >
          View Signal On Board →
        </button>
      </div>
    </div>
  );
};
