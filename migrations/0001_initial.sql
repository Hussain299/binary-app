-- ============================================================
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
