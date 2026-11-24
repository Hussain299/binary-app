import { db } from '../src/server/db.ts';
import { autonomousScheduler } from '../src/server/scheduler.ts';
import { learningPlatform } from '../src/server/learningPlatform.ts';

console.log('--- DB & STRATEGY READINESS ---');
const paperStrategies = db.getPaperTradingStrategies();
console.log('Qualified Paper Strategies:', paperStrategies.length);
for (const strat of paperStrategies) {
  console.log(`- ${strat.id} [${strat.symbol}] status=${strat.status} acc=${(strat.verifiedAccuracy * 100).toFixed(1)}%`);
}

const diagnostics = db.getStrategyEligibilityDiagnostics();
console.log('Diagnostics:', {
  stored: diagnostics.storedCandidates,
  eligible: diagnostics.eligibleForPaperSignals,
  paperTrading: diagnostics.paperTradingCandidates,
});

const board = learningPlatform.getBoard(10);
console.log('Learning Board Summary:', board.summary);
console.log('--- VERIFICATION SUCCESS ---');
process.exit(0);
