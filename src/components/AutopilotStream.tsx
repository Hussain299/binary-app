import React from 'react';
import {
  Sparkles,
  Cpu,
  Activity,
  CheckCircle2,
  Zap,
  Target,
  FlaskConical,
  ShieldCheck,
  Radio,
} from 'lucide-react';
import { AutopilotLog } from '../types/index.js';

interface AutopilotStreamProps {
  logs: AutopilotLog[];
  activeSignalsCount: number;
}

export const AutopilotStream: React.FC<AutopilotStreamProps> = ({
  logs,
  activeSignalsCount,
}) => {
  const getRoleIcon = (role: AutopilotLog['role']) => {
    switch (role) {
      case 'MIND':
        return <Cpu className="w-3.5 h-3.5 text-emerald-400" />;
      case 'SCIENTIST':
        return <FlaskConical className="w-3.5 h-3.5 text-purple-400" />;
      case 'ENGINEER':
        return <Activity className="w-3.5 h-3.5 text-blue-400" />;
      case 'AUDITOR':
        return <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />;
      case 'EXECUTION':
        return <Target className="w-3.5 h-3.5 text-rose-400" />;
    }
  };

  const getRoleColor = (role: AutopilotLog['role']) => {
    switch (role) {
      case 'MIND':
        return 'text-emerald-400';
      case 'SCIENTIST':
        return 'text-purple-400';
      case 'ENGINEER':
        return 'text-blue-400';
      case 'AUDITOR':
        return 'text-amber-400';
      case 'EXECUTION':
        return 'text-rose-400';
    }
  };

  return (
    <div className="bg-neutral-900/80 border border-neutral-800 rounded p-4 font-mono text-xs space-y-3">
      {/* HUD Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-neutral-800">
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping absolute" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 relative" />
          </div>
          <div className="flex items-center gap-1.5 font-bold text-white tracking-tight">
            <span>AUTONOMOUS AUTOPILOT ENGINE</span>
            <span className="text-neutral-600">·</span>
            <span className="text-emerald-400 font-semibold">AGI RESEARCH PULSE ACTIVE</span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-neutral-400">
          <span>Continuous Loop: <strong>20s Pulse</strong></span>
          <span>·</span>
          <span>Sensing: <strong>8 Forex Pairs</strong></span>
          <span>·</span>
          <span>
            Active Signals:{' '}
            <strong className="text-emerald-400">{activeSignalsCount} Monitored</strong>
          </span>
        </div>
      </div>

      {/* Live Cognitive Feed Stream */}
      <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
        {logs.length === 0 ? (
          <div className="text-neutral-500 italic py-2">
            Autonomous intelligence initializing market sense stream...
          </div>
        ) : (
          logs.slice(0, 6).map(log => (
            <div
              key={log.id}
              className="flex items-start gap-2 text-[11px] text-neutral-300 leading-tight py-0.5"
            >
              <span className="text-neutral-500 shrink-0 tabular-nums">
                {log.timestamp.substring(11, 19)}
              </span>
              <div className="flex items-center gap-1 shrink-0 font-semibold">
                {getRoleIcon(log.role)}
                <span className={getRoleColor(log.role)}>
                  [{log.role}]:
                </span>
              </div>
              <span className="text-neutral-300 truncate">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
