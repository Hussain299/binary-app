import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  Activity,
  Database,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RotateCw,
} from 'lucide-react';
import { SystemHealthState } from '../../types/index.js';

export const SystemHealthView: React.FC = () => {
  const [health, setHealth] = useState<SystemHealthState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchHealth = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/system/health');
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      }
    } catch (e) {
      console.error('Failed to fetch system health:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-neutral-950 p-6 space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
        <div>
          <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-emerald-400" />
            <span>System Telemetry & Provider Health</span>
          </h3>
          <p className="text-xs text-neutral-400 font-mono mt-1">
            Real-time infrastructure monitor, data feed health checks, and autonomous cron job executions.
          </p>
        </div>

        <button
          onClick={fetchHealth}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white rounded transition-colors"
        >
          <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          <span>Refresh Health</span>
        </button>
      </div>

      {health ? (
        <div className="space-y-6 font-mono text-xs">
          {/* Top Status Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
              <span className="text-neutral-500 text-[10px] uppercase block">Engine Uptime</span>
              <span className="text-xl font-bold text-white tabular-nums">
                {Math.floor(health.uptimeSeconds / 60)}m {health.uptimeSeconds % 60}s
              </span>
              <span className="text-[10px] text-emerald-400 block mt-1">Continuous Execution</span>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
              <span className="text-neutral-500 text-[10px] uppercase block">Database Storage</span>
              <span className="text-xl font-bold text-white truncate block">
                {health.dbType}
              </span>
              <span className="text-[10px] text-neutral-400 block mt-1 tabular-nums">
                {health.totalCandlesStored} candles cached
              </span>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
              <span className="text-neutral-500 text-[10px] uppercase block">Autopilot Pulse</span>
              <span className="text-xl font-bold text-emerald-400">
                {health.isCronRunning ? 'Cycle In Progress' : 'Polling every 20s'}
              </span>
              <span className="text-[10px] text-neutral-400 block mt-1">
                Signal scanning interval: 20 seconds
              </span>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4">
              <span className="text-neutral-500 text-[10px] uppercase block">Active Signals</span>
              <span className="text-xl font-bold text-white tabular-nums">
                {health.activeSignalsCount} active / {health.totalExperimentsRun} backtests
              </span>
              <span className="text-[10px] text-neutral-400 block mt-1">{health.totalForwardObservations || 0} forward paper observations</span>
            </div>
          </div>

          {/* Data Providers Health Matrix */}
          <div className="bg-neutral-900/60 border border-neutral-800 rounded p-5 space-y-3">
            <h4 className="text-sm font-semibold text-white">Public Feed Auditing & Fallback Matrix</h4>
            <div className="border border-neutral-800 rounded overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-neutral-950 border-b border-neutral-800 text-neutral-400 uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-4">Provider Feed</th>
                    <th className="py-2.5 px-4">Symbol</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Latency</th>
                    <th className="py-2.5 px-4">Last Success</th>
                    <th className="py-2.5 px-4">Failure Attribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-850 bg-neutral-950/60">
                  {health.providers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-neutral-500">
                        Providers initializing with market warmups...
                      </td>
                    </tr>
                  ) : (
                    health.providers.map((p, i) => (
                      <tr key={i} className="hover:bg-neutral-900/50">
                        <td className="py-2.5 px-4 text-white font-semibold uppercase">{p.provider}</td>
                        <td className="py-2.5 px-4 text-neutral-300">{p.symbol}</td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`font-semibold ${
                              p.status === 'ONLINE'
                                ? 'text-emerald-400'
                                : p.status === 'DEGRADED'
                                ? 'text-amber-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right text-neutral-300 tabular-nums">
                          {p.latencyMs}ms
                        </td>
                        <td className="py-2.5 px-4 text-neutral-400">
                          {p.lastSuccess.includes('T') ? p.lastSuccess.substring(11, 19) + ' UTC' : p.lastSuccess}
                        </td>
                        <td className="py-2.5 px-4 text-neutral-400 text-[11px]">
                          {p.errorMessage ? (
                            <span className="text-rose-400">{p.errorMessage}</span>
                          ) : (
                            p.attribution
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="h-64 flex items-center justify-center text-neutral-500 font-mono text-xs">
          Loading system telemetry...
        </div>
      )}
    </div>
  );
};
