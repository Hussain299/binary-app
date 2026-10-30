/**
 * SignalForge ML — Persistent Database & D1 Exporter
 * Provides atomic file persistence for research state with instant Cloudflare D1 SQL schema export.
 */

import fs from 'fs';
import path from 'path';
import {
  Candle,
  ForexSymbol,
  ProviderHealth,
  ResearchSignal,
  ResearchExperiment,
  AgentReview,
  EvolutionGeneration,
  SignalLifecycleEvent,
  AutopilotLog,
} from '../types/index.js';

interface DatabaseSchema {
  candles: Record<string, Candle[]>;
  feedHealth: Record<string, ProviderHealth>;
  signals: ResearchSignal[];
  experiments: ResearchExperiment[];
  reviews: AgentReview[];
  generations: EvolutionGeneration[];
  autopilotLogs: AutopilotLog[];
  cronState: {
    lastRun: string | null;
    nextRun: string | null;
    isRunning: boolean;
    history: Array<{ runAt: string; durationMs: number; status: string; summary: string }>;
  };
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'signalforge.db.json');

class DatabaseService {
  private state: DatabaseSchema;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.ensureDataDir();
    this.state = this.loadState();
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadState(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed.autopilotLogs) parsed.autopilotLogs = [];
        if (Array.isArray(parsed.signals)) {
          const nowMs = Date.now();
          parsed.signals = parsed.signals.filter((s: any) => {
            if (s.symbol === 'USD/CHF' || s.symbol === 'NZD/USD') return false;
            // Purge signals older than 2 hours to eliminate stale historical records
            const sigMs = Date.parse(s.candleOpenTimeUtc || s.predictionTimeUtc || s.entryWindowStartUtc || s.createdAt);
            if (!isNaN(sigMs) && nowMs - sigMs > 2 * 60 * 60 * 1000) return false;
            if (typeof s.candleOpenTimeIst === 'string' && s.candleOpenTimeIst.includes('19:35')) return false;
            return true;
          });
        }
        if (parsed.candles) {
          delete parsed.candles['USD/CHF'];
          delete parsed.candles['NZD/USD'];
        }
        return parsed;
      }
    } catch (err) {
      console.error('[DB] Failed to parse existing database file, initializing fresh:', err);
    }

    return {
      candles: {},
      feedHealth: {},
      signals: [],
      experiments: [],
      reviews: [],
      generations: [],
      autopilotLogs: [],
      cronState: {
        lastRun: null,
        nextRun: null,
        isRunning: false,
        history: [],
      },
    };
  }

  public saveStateSync() {
    this.ensureDataDir();
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(this.state, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  }

  public scheduleSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveStateSync();
    }, 500);
  }

  // Candle Storage
  public storeCandles(symbol: ForexSymbol, newCandles: Candle[]) {
    if (!this.state.candles[symbol]) {
      this.state.candles[symbol] = [];
    }

    const existingMap = new Map<number, Candle>();
    for (const c of this.state.candles[symbol]) {
      existingMap.set(c.timestampMs, c);
    }

    for (const c of newCandles) {
      existingMap.set(c.timestampMs, c);
    }

    // Sort chronologically and keep last 2000 candles per pair
    const sorted = Array.from(existingMap.values()).sort((a, b) => a.timestampMs - b.timestampMs);
    this.state.candles[symbol] = sorted.slice(-2000);
    this.scheduleSave();
  }

  public getCandles(symbol: ForexSymbol, limit: number = 100): Candle[] {
    const list = this.state.candles[symbol] || [];
    return list.slice(-limit);
  }

  public getTotalCandlesCount(): number {
    let count = 0;
    for (const key of Object.keys(this.state.candles)) {
      count += this.state.candles[key].length;
    }
    return count;
  }

  // Provider Health
  public updateFeedHealth(health: ProviderHealth) {
    const key = `${health.provider}:${health.symbol}`;
    this.state.feedHealth[key] = health;
    this.scheduleSave();
  }

  public getFeedHealthList(): ProviderHealth[] {
    return Object.values(this.state.feedHealth);
  }

  // Signals
  public addSignal(signal: ResearchSignal) {
    // Prevent duplicate active signal for same pair, direction and setup within 30m
    const exists = this.state.signals.find(
      s =>
        s.symbol === signal.symbol &&
        s.direction === signal.direction &&
        s.ruleFamily === signal.ruleFamily &&
        ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE'].includes(s.lifecycleState)
    );
    if (exists) {
      return exists;
    }

    this.state.signals.unshift(signal);
    // Keep max 500 signals in history
    if (this.state.signals.length > 500) {
      this.state.signals = this.state.signals.slice(0, 500);
    }
    this.scheduleSave();
    return signal;
  }

  public updateSignal(signal: ResearchSignal) {
    const idx = this.state.signals.findIndex(s => s.id === signal.id);
    if (idx !== -1) {
      this.state.signals[idx] = signal;
      this.scheduleSave();
    }
  }

  public getSignals(includeTest: boolean = false): ResearchSignal[] {
    if (includeTest) return this.state.signals;
    return this.state.signals.filter(s => !s.ruleFamily?.startsWith('test_'));
  }

  public getActiveSignals(includeTest: boolean = false): ResearchSignal[] {
    const list = this.getSignals(includeTest);
    return list.filter(s =>
      ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE', 'EXIT_PENDING'].includes(s.lifecycleState)
    );
  }

  public purgeTestSignals() {
    this.state.signals = this.state.signals.filter(s => !s.ruleFamily?.startsWith('test_'));
    this.scheduleSave();
  }

  public getSignalById(id: string): ResearchSignal | undefined {
    return this.state.signals.find(s => s.id === id);
  }

  // Experiments
  public addExperiment(exp: ResearchExperiment) {
    this.state.experiments.unshift(exp);
    if (this.state.experiments.length > 300) {
      this.state.experiments = this.state.experiments.slice(0, 300);
    }
    this.scheduleSave();
  }

  public getExperiments(): ResearchExperiment[] {
    return this.state.experiments;
  }

  // Agent Reviews
  public addReview(review: AgentReview) {
    this.state.reviews.unshift(review);
    if (this.state.reviews.length > 300) {
      this.state.reviews = this.state.reviews.slice(0, 300);
    }
    this.scheduleSave();
  }

  public getReviews(): AgentReview[] {
    return this.state.reviews;
  }

  // Generations
  public addGeneration(gen: EvolutionGeneration) {
    this.state.generations.unshift(gen);
    this.scheduleSave();
  }

  public getGenerations(): EvolutionGeneration[] {
    return this.state.generations;
  }

  // Autonomous Autopilot Logs
  public addAutopilotLog(log: AutopilotLog) {
    if (!this.state.autopilotLogs) this.state.autopilotLogs = [];
    this.state.autopilotLogs.unshift(log);
    if (this.state.autopilotLogs.length > 200) {
      this.state.autopilotLogs = this.state.autopilotLogs.slice(0, 200);
    }
    this.scheduleSave();
  }

  public getAutopilotLogs(limit: number = 50): AutopilotLog[] {
    return (this.state.autopilotLogs || []).slice(0, limit);
  }

  // Cron State
  public getCronState() {
    return this.state.cronState;
  }

  public updateCronState(update: Partial<DatabaseSchema['cronState']>) {
    this.state.cronState = { ...this.state.cronState, ...update };
    this.scheduleSave();
  }

  public logCronRun(durationMs: number, status: string, summary: string) {
    this.state.cronState.lastRun = new Date().toISOString();
    this.state.cronState.isRunning = false;
    this.state.cronState.history.unshift({
      runAt: new Date().toISOString(),
      durationMs,
      status,
      summary,
    });
    if (this.state.cronState.history.length > 50) {
      this.state.cronState.history = this.state.cronState.history.slice(0, 50);
    }
    this.scheduleSave();
  }

  /**
   * Generates production-ready Cloudflare D1 SQL Schema & Migrations
   */
  public generateCloudflareD1Schema(): string {
    return `-- ============================================================
-- SignalForge ML: Cloudflare D1 Database Migration
-- Version: 0001_initial.sql
-- Compatible with Cloudflare Workers + D1 Free Tier
-- ============================================================

-- Table 1: Market Candles (UTC Normalized)
CREATE TABLE IF NOT EXISTS market_candles (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_candles_symbol_time ON market_candles(symbol, timestamp_ms);

-- Table 2: Provider Feed Health
CREATE TABLE IF NOT EXISTS feed_health (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  symbol TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  last_success TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Table 3: Research Signals (Causal Entry & Exit Lifecycle)
CREATE TABLE IF NOT EXISTS research_signals (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  prediction_time_utc TEXT NOT NULL,
  prediction_time_ist TEXT NOT NULL,
  signal_candle_time TEXT NOT NULL,
  entry_condition TEXT NOT NULL,
  entry_window_start_utc TEXT NOT NULL,
  entry_window_end_utc TEXT NOT NULL,
  trigger_price REAL NOT NULL,
  invalidation_price REAL NOT NULL,
  actual_entry_time_utc TEXT,
  actual_entry_price REAL,
  entry_source TEXT,
  expiry_minutes INTEGER NOT NULL,
  planned_exit_time_utc TEXT,
  actual_exit_time_utc TEXT,
  actual_exit_price REAL,
  confidence REAL NOT NULL,
  calibration_status TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL,
  gross_return_pips REAL,
  estimated_spread_pips REAL,
  net_return_pips REAL,
  outcome_result TEXT NOT NULL,
  rule_family TEXT NOT NULL,
  model_version TEXT NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_signals_state ON research_signals(lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON research_signals(symbol, created_at);

-- Table 4: Signal Lifecycle Transition Audit Trail
CREATE TABLE IF NOT EXISTS signal_lifecycle_events (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  timestamp_utc TEXT NOT NULL,
  price REAL,
  reason TEXT NOT NULL,
  FOREIGN KEY (signal_id) REFERENCES research_signals(id) ON DELETE CASCADE
);

-- Table 5: Research Experiments (Purged Walk-Forward Runs)
CREATE TABLE IF NOT EXISTS research_experiments (
  id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  rule_family TEXT NOT NULL,
  horizon_minutes INTEGER NOT NULL,
  parameters_json TEXT NOT NULL,
  features_json TEXT NOT NULL,
  train_accuracy REAL NOT NULL,
  val_accuracy REAL NOT NULL,
  test_accuracy REAL NOT NULL,
  balanced_accuracy REAL NOT NULL,
  f1_score REAL NOT NULL,
  brier_score REAL NOT NULL,
  win_rate REAL NOT NULL,
  profit_factor REAL NOT NULL,
  max_drawdown_pct REAL NOT NULL,
  auditor_verdict TEXT NOT NULL,
  scientist_hypothesis TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_exp_generation ON research_experiments(generation);

-- Table 6: Agent Reviews (Scientist, Engineer, Skeptical Auditor)
CREATE TABLE IF NOT EXISTS agent_reviews (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  role TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  verdict TEXT,
  score INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Table 7: Evolution Generations
CREATE TABLE IF NOT EXISTS evolution_generations (
  generation INTEGER PRIMARY KEY,
  total_experiments INTEGER NOT NULL,
  accepted_count INTEGER NOT NULL,
  rejected_count INTEGER NOT NULL,
  top_experiment_id TEXT,
  best_f1_score REAL NOT NULL,
  summary TEXT NOT NULL,
  lessons_json TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Table 8: Scheduled Cron Run History
CREATE TABLE IF NOT EXISTS cron_run_history (
  id TEXT PRIMARY KEY,
  run_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL
);
`;
  }

  public generateWranglerToml(): string {
    return `# SignalForge ML — Cloudflare Workers & Pages Deployment Config
name = "signalforge-api"
main = "src/worker.ts"
compatibility_date = "2024-10-01"

# Cloudflare D1 Database Binding
[[d1_databases]]
binding = "DB"
database_name = "signalforge-db"
database_id = "[CREATE AND RECORD AFTER D1 DATABASE CREATION]"
migrations_dir = "migrations"

# Cron Trigger for Autonomous Research Laboratory (Hourly)
[triggers]
crons = ["0 * * * *"]

[vars]
ENVIRONMENT = "production"
DEFAULT_TIMEZONE = "Asia/Kolkata"
`;
  }
}

export const db = new DatabaseService();
