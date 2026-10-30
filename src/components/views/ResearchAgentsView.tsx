import React, { useState } from 'react';
import { Users, FlaskConical, Wrench, ShieldAlert, CheckCircle, XCircle } from 'lucide-react';
import { AgentReview } from '../../types/index.js';

interface ResearchAgentsViewProps {
  reviews: AgentReview[];
}

export const ResearchAgentsView: React.FC<ResearchAgentsViewProps> = ({ reviews }) => {
  const [selectedRole, setSelectedRole] = useState<'ALL' | 'SCIENTIST' | 'ENGINEER' | 'SKEPTICAL_AUDITOR'>('ALL');

  const filtered = reviews.filter(r => selectedRole === 'ALL' || r.role === selectedRole);

  const getRoleIcon = (role: AgentReview['role']) => {
    switch (role) {
      case 'SCIENTIST':
        return <FlaskConical className="w-4 h-4 text-purple-400" />;
      case 'ENGINEER':
        return <Wrench className="w-4 h-4 text-blue-400" />;
      case 'SKEPTICAL_AUDITOR':
        return <ShieldAlert className="w-4 h-4 text-amber-400" />;
    }
  };

  const getRoleBadgeColor = (role: AgentReview['role']) => {
    switch (role) {
      case 'SCIENTIST':
        return 'text-purple-400';
      case 'ENGINEER':
        return 'text-blue-400';
      case 'SKEPTICAL_AUDITOR':
        return 'text-amber-400';
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-950">
      {/* Subheader Toolbar */}
      <div className="h-12 border-b border-neutral-800 px-6 flex items-center justify-between shrink-0 bg-neutral-900/30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-neutral-400 font-mono">
            <span className="text-white font-semibold">RESEARCH TRINITY</span>
            <span>·</span>
            <span>ROLE-SEPARATED DELIBERATION AUDIT LOG</span>
          </div>
        </div>

        {/* Filter */}
        <div className="flex items-center bg-neutral-900 p-0.5 rounded border border-neutral-800 text-xs font-mono">
          <button
            onClick={() => setSelectedRole('ALL')}
            className={`px-2.5 py-1 rounded transition-colors ${
              selectedRole === 'ALL' ? 'bg-neutral-800 text-white' : 'text-neutral-400'
            }`}
          >
            All Roles ({reviews.length})
          </button>
          <button
            onClick={() => setSelectedRole('SCIENTIST')}
            className={`px-2.5 py-1 rounded transition-colors ${
              selectedRole === 'SCIENTIST' ? 'bg-neutral-800 text-purple-400' : 'text-neutral-400'
            }`}
          >
            Scientist
          </button>
          <button
            onClick={() => setSelectedRole('ENGINEER')}
            className={`px-2.5 py-1 rounded transition-colors ${
              selectedRole === 'ENGINEER' ? 'bg-neutral-800 text-blue-400' : 'text-neutral-400'
            }`}
          >
            Engineer
          </button>
          <button
            onClick={() => setSelectedRole('SKEPTICAL_AUDITOR')}
            className={`px-2.5 py-1 rounded transition-colors ${
              selectedRole === 'SKEPTICAL_AUDITOR' ? 'bg-neutral-800 text-amber-400' : 'text-neutral-400'
            }`}
          >
            Skeptical Auditor
          </button>
        </div>
      </div>

      {/* Reviews Stream */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {filtered.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center text-neutral-500 font-mono text-xs">
            <Users className="w-8 h-8 text-neutral-600 mb-2" />
            <p className="text-neutral-400 font-medium text-sm">No Agent Deliberations Logged</p>
            <p className="mt-1">Deliberations are generated automatically during model walk-forward evaluations.</p>
          </div>
        ) : (
          filtered.map(rev => (
            <div
              key={rev.id}
              className="bg-neutral-900/60 border border-neutral-800 rounded p-5 font-mono text-xs space-y-3"
            >
              <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
                <div className="flex items-center gap-2">
                  {getRoleIcon(rev.role)}
                  <span className={`font-bold ${getRoleBadgeColor(rev.role)}`}>{rev.role}</span>
                  <span className="text-neutral-500">·</span>
                  <span className="text-white font-medium">{rev.title}</span>
                </div>

                <div className="flex items-center gap-3">
                  {rev.verdict && (
                    <span
                      className={`font-semibold ${
                        rev.verdict === 'PROCEED' ? 'text-emerald-400' : rev.verdict === 'HOLD' ? 'text-amber-400' : 'text-rose-400'
                      }`}
                    >
                      {rev.verdict}
                    </span>
                  )}

                  <span className="text-[11px] text-neutral-500">
                    {rev.timestamp.substring(11, 19)} UTC
                  </span>
                </div>
              </div>

              <div className="text-neutral-300 whitespace-pre-line leading-relaxed bg-neutral-950 p-4 rounded border border-neutral-800/80">
                {rev.content}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
