/**
 * Persistence integrity guards for research evidence.
 *
 * These IDs identify synthetic strategy rows that were inserted with
 * hard-coded backtest metrics rather than measured historical evidence.
 * They are quarantined on load so they cannot qualify a paper strategy.
 */
export const SYNTHETIC_STRATEGY_IDS = [
  'synth_gen7_fractal_wick',
  'synth_gen12_harmonic_flow',
  'synth_gen19_stochastic_drift',
  'synth_gen26_macro_resonance',
  'synth_gen33_compression_decoupling',
  'synth_EURUSD_causal_v2',
  'synth_GBPUSD_causal_v2',
  'synth_USDJPY_causal_v2',
] as const;

export const SYNTHETIC_BASELINE_BATCH_IDS = [
  'seed_batch_EURUSD_v2',
  'seed_batch_GBPUSD_v2',
  'seed_batch_USDJPY_v2',
] as const;

const syntheticStrategyIds = new Set<string>(SYNTHETIC_STRATEGY_IDS);
const syntheticBatchIds = new Set<string>(SYNTHETIC_BASELINE_BATCH_IDS);

export function filterPersistedStrategies<T extends { id: string }>(rows: T[]): T[] {
  return rows.filter(row => !syntheticStrategyIds.has(row.id));
}

export function filterPersistedGenerations<T extends { researchBatchId?: string | null }>(rows: T[]): T[] {
  return rows.filter(row => !row.researchBatchId || !syntheticBatchIds.has(row.researchBatchId));
}

export function filterPersistedResearchHoldouts<T extends { batchId?: string | null }>(rows: T[]): T[] {
  return rows.filter(row => !row.batchId || !syntheticBatchIds.has(row.batchId));
}

/**
 * Only internal test fixtures are excluded from the user-facing ledger.
 * Currency pairs and timestamps are never grounds for deleting a real record.
 */
export function filterPersistedSignals<T extends { ruleFamily?: string | null }>(rows: T[]): T[] {
  return rows.filter(row => !row.ruleFamily?.startsWith('test_'));
}
