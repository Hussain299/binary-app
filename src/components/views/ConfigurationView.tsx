import React, { useState, useEffect } from 'react';
import {
  Settings,
  Database,
  Cloud,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Play,
  FileCode,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { VerificationTestResult } from '../../types/index.js';

export const ConfigurationView: React.FC = () => {
  const [d1Schema, setD1Schema] = useState<string>('');
  const [wranglerToml, setWranglerToml] = useState<string>('');
  const [copiedD1, setCopiedD1] = useState(false);
  const [copiedWrangler, setCopiedWrangler] = useState(false);

  // Test Suite state
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [testResults, setTestResults] = useState<{
    summary: { total: number; passed: number; failed: number; durationMs: number };
    results: VerificationTestResult[];
  } | null>(null);

  useEffect(() => {
    fetch('/api/system/export-d1')
      .then(res => res.json())
      .then(data => {
        setD1Schema(data.schemaSql || '');
        setWranglerToml(data.wranglerToml || '');
      })
      .catch(console.error);
  }, []);

  const handleRunTests = async () => {
    setIsRunningTests(true);
    try {
      const res = await fetch('/api/test/run', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setTestResults(data);
      }
    } catch (e) {
      console.error('Failed to run verification tests:', e);
    } finally {
      setIsRunningTests(false);
    }
  };

  const copyToClipboard = (text: string, type: 'd1' | 'wrangler') => {
    navigator.clipboard.writeText(text);
    if (type === 'd1') {
      setCopiedD1(true);
      setTimeout(() => setCopiedD1(false), 2000);
    } else {
      setCopiedWrangler(true);
      setTimeout(() => setCopiedWrangler(false), 2000);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-neutral-950 p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-neutral-800">
        <div>
          <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
            <Settings className="w-4 h-4 text-emerald-400" />
            <span>Settings, Quality Assurance & Data Export</span>
          </h3>
          <p className="text-xs text-neutral-400 font-mono mt-1">
            SignalForge ML runs 100% self-contained right here. Zero Cloudflare accounts or external services are required.
          </p>
        </div>

        <button
          onClick={handleRunTests}
          disabled={isRunningTests}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-emerald-950 bg-emerald-400 hover:bg-emerald-300 rounded transition-colors disabled:opacity-50"
        >
          <Play className={`w-3.5 h-3.5 ${isRunningTests ? 'animate-spin' : ''}`} />
          <span>{isRunningTests ? 'Running Assertions...' : 'Run Automated Test Suite'}</span>
        </button>
      </div>

      {/* Zero Setup Reassurance Card */}
      <div className="bg-neutral-900/60 border border-emerald-900/40 rounded p-4 font-mono text-xs space-y-2">
        <div className="flex items-center gap-2 text-emerald-400 font-semibold">
          <CheckCircle2 className="w-4 h-4" />
          <span>Zero Setup Required — Active & Fully Operational Right Here</span>
        </div>
        <p className="text-neutral-300 leading-relaxed text-[11px]">
          You do <strong>not</strong> need to configure Cloudflare, enter API tokens, or manage any external accounts. 
          The backend runs its own self-contained database engine storing all 8 forex pairs, causal signals, and ML experiments directly on this server.
          The Cloudflare D1 exports at the bottom are purely optional for future external use.
        </p>
      </div>

      {/* Test Report Section */}
      {testResults && (
        <div className="bg-neutral-900/60 border border-neutral-800 rounded p-5 font-mono text-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h4 className="text-sm font-semibold text-white">Quality Assurance Test Report</h4>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-emerald-400 font-bold">
                {testResults.summary.passed} Passed
              </span>
              {testResults.summary.failed > 0 && (
                <span className="text-rose-400 font-bold">
                  {testResults.summary.failed} Failed
                </span>
              )}
              <span className="text-neutral-400">
                {(testResults.summary.durationMs / 1000).toFixed(2)}s duration
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {testResults.results.map((r, i) => (
              <div
                key={i}
                className="bg-neutral-950 p-3 rounded border border-neutral-800 flex items-start justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-neutral-500 font-semibold text-[10px]">[{r.category}]</span>
                    <strong className="text-white">{r.name}</strong>
                  </div>
                  <div className="text-neutral-400 text-[11px]">{r.details}</div>
                  {r.error && <div className="text-rose-400 font-semibold">{r.error}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-neutral-500 tabular-nums">{r.durationMs}ms</span>
                  {r.passed ? (
                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> PASSED
                    </span>
                  ) : (
                    <span className="text-rose-400 font-semibold flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" /> FAILED
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Optional Cloudflare D1 Export Guide (Not Required) */}
      <div className="space-y-2">
        <div className="text-[11px] font-mono text-neutral-400">
          Optional External Deployment Artifacts (Safe to ignore if running here)
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 font-mono text-xs">
          {/* D1 SQL Schema */}
          <div className="bg-neutral-900/60 border border-neutral-800 rounded p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" />
                <span>Optional D1 SQL Schema (0001_initial.sql)</span>
              </h4>
            <button
              onClick={() => copyToClipboard(d1Schema, 'd1')}
              className="flex items-center gap-1 text-[11px] text-neutral-300 hover:text-white bg-neutral-800 px-2.5 py-1 rounded transition-colors"
            >
              {copiedD1 ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedD1 ? 'Copied' : 'Copy SQL'}</span>
            </button>
          </div>

          <p className="text-neutral-400 text-[11px]">
            Ready for execution with <code className="text-neutral-300">npx wrangler d1 execute signalforge-db --file=migrations/0001_initial.sql</code>.
          </p>

          <pre className="bg-neutral-950 p-4 rounded border border-neutral-800 text-neutral-300 text-[11px] h-64 overflow-y-auto overflow-x-auto leading-relaxed">
            {d1Schema}
          </pre>
        </div>

        {/* wrangler.toml */}
        <div className="bg-neutral-900/60 border border-neutral-800 rounded p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <Cloud className="w-4 h-4 text-blue-400" />
              <span>Cloudflare Workers Config (wrangler.toml)</span>
            </h4>
            <button
              onClick={() => copyToClipboard(wranglerToml, 'wrangler')}
              className="flex items-center gap-1 text-[11px] text-neutral-300 hover:text-white bg-neutral-800 px-2.5 py-1 rounded transition-colors"
            >
              {copiedWrangler ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedWrangler ? 'Copied' : 'Copy TOML'}</span>
            </button>
          </div>

          <p className="text-neutral-400 text-[11px]">
            Configures worker name, D1 binding (<code className="text-neutral-300">DB</code>), and hourly cron trigger (<code className="text-neutral-300">0 * * * *</code>).
          </p>

          <pre className="bg-neutral-950 p-4 rounded border border-neutral-800 text-neutral-300 text-[11px] h-64 overflow-y-auto overflow-x-auto leading-relaxed">
            {wranglerToml}
          </pre>
        </div>
      </div>
    </div>
  </div>
);
};
