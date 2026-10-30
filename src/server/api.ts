/**
 * SignalForge ML — Express Backend API Router
 * Implements REST endpoints for forex feeds, causal signal management,
 * purged ML experiments, research trinity reviews, and Cloudflare D1 export.
 */

import { Router, Request, Response } from 'express';
import { FOREX_PAIRS, ForexSymbol, RuleFamily } from '../types/index.js';
import { dataFeedEngine } from './dataFeeds.js';
import { db } from './db.js';
import { entryExitEngine } from './entryExitEngine.js';
import { researchEngine } from './researchEngine.js';
import { autonomousScheduler } from './scheduler.js';
import { runAllVerificationTests } from './tests.js';

export const apiRouter = Router();

// Healthcheck
apiRouter.get('/_healthcheck', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    system: 'SignalForge ML Autonomous Research Intelligence',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// GET /api/forex-candles?symbol=EURUSD&limit=100
apiRouter.get('/forex-candles', async (req: Request, res: Response) => {
  try {
    const rawSymbol = ((req.query.symbol as string) || 'EUR/USD').toUpperCase();
    let symbol: ForexSymbol = 'EUR/USD';
    const found = FOREX_PAIRS.find(p => p.replace('/', '') === rawSymbol.replace('/', ''));
    if (found) symbol = found;

    const limit = Math.min(500, Math.max(10, Number(req.query.limit) || 100));
    const result = await dataFeedEngine.fetchCandles(symbol, limit);

    res.json({
      symbol,
      count: result.candles.length,
      source: result.source,
      qualityScore: result.qualityScore,
      candles: result.candles,
      sessions: dataFeedEngine.getMarketSessions(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/scan — Market scan across all 8 forex pairs
apiRouter.get('/scan', async (_req: Request, res: Response) => {
  try {
    const scanResults: Array<{
      symbol: ForexSymbol;
      lastPrice: number;
      change24hPct: number;
      source: string;
      qualityScore: number;
      activeSignals: number;
    }> = [];

    const activeSignals = db.getActiveSignals();

    for (const pair of FOREX_PAIRS) {
      const { candles, source, qualityScore } = await dataFeedEngine.fetchCandles(pair, 30);
      const lastCandle = candles[candles.length - 1];
      const firstCandle = candles[0];
      const change24hPct = firstCandle
        ? Number((((lastCandle.close - firstCandle.open) / firstCandle.open) * 100).toFixed(2))
        : 0;

      scanResults.push({
        symbol: pair,
        lastPrice: lastCandle?.close || 0,
        change24hPct,
        source,
        qualityScore,
        activeSignals: activeSignals.filter(s => s.symbol === pair).length,
      });
    }

    res.json({
      timestamp: new Date().toISOString(),
      sessions: dataFeedEngine.getMarketSessions(),
      pairs: scanResults,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/analyze — Deep quantitative analysis for a specific pair
apiRouter.post('/analyze', async (req: Request, res: Response) => {
  try {
    const rawSymbol = ((req.body.symbol as string) || 'EUR/USD').toUpperCase();
    const symbol = FOREX_PAIRS.find(p => p.replace('/', '') === rawSymbol.replace('/', '')) || 'EUR/USD';
    const horizon = Number(req.body.horizon) || 10;
    const ruleFamily = (req.body.ruleFamily as RuleFamily) || 'momentum_5';

    const { candles, source, qualityScore } = await dataFeedEngine.fetchCandles(symbol, 120);
    const exp = researchEngine.runWalkForwardExperiment(symbol, candles, ruleFamily, horizon, 1);
    const reviews = await researchEngine.generateTrinityReviews(exp);

    res.json({
      symbol,
      source,
      qualityScore,
      experiment: exp,
      reviews,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/signals — All signals or filtered
apiRouter.get('/signals', (_req: Request, res: Response) => {
  res.json({
    signals: db.getSignals(),
    activeCount: db.getActiveSignals().length,
    sessions: db.getSessionAccuracyBreakdown(),
  });
});

// GET /api/sessions/accuracy — Verified performance breakdown by trading session
apiRouter.get('/sessions/accuracy', (_req: Request, res: Response) => {
  res.json({
    sessions: db.getSessionAccuracyBreakdown(),
    marketTime: dataFeedEngine.getMarketSessions(),
  });
});

// GET /api/strategies/synthesized — Infinite Non-Human Genetic Strategies Pool
apiRouter.get('/strategies/synthesized', (_req: Request, res: Response) => {
  const all = db.getSynthesizedStrategies();
  const promoted = db.getPromotedActiveStrategies();
  res.json({
    strategies: all,
    promotedCount: promoted.length,
    totalCount: all.length,
    generationsCount: db.getGenerations().length,
  });
});

// POST /api/strategies/evolve — Trigger immediate evolutionary synthesis of a novel strategy
apiRouter.post('/strategies/evolve', async (_req: Request, res: Response) => {
  try {
    const pair: ForexSymbol = FOREX_PAIRS[Math.floor(Math.random() * FOREX_PAIRS.length)];
    const { candles } = await dataFeedEngine.fetchCandles(pair, 60);
    const generations = db.getGenerations();
    const currentGen = (generations[0]?.generation || 7) + 1;
    const newGene = researchEngine.synthesizeInfiniteNovelStrategy(candles, pair, currentGen);
    
    res.json({
      success: true,
      gene: newGene,
      strategies: db.getSynthesizedStrategies(),
      promotedCount: db.getPromotedActiveStrategies().length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/signals/clear-history — Purges closed trade history while keeping active/pending signals
apiRouter.post('/signals/clear-history', (_req: Request, res: Response) => {
  db.clearClosedSignalsHistory();
  res.json({
    success: true,
    message: 'Closed signals history cleared successfully',
    signals: db.getSignals(),
    activeCount: db.getActiveSignals().length,
  });
});

// POST /api/signals/evaluate — Step causal entry/exit engine on active signals
apiRouter.post('/signals/evaluate', async (_req: Request, res: Response) => {
  try {
    const candlesMap: Record<ForexSymbol, any> = {} as any;
    for (const pair of FOREX_PAIRS) {
      const { candles } = await dataFeedEngine.fetchCandles(pair, 60);
      candlesMap[pair] = candles;
    }

    const updated = entryExitEngine.evaluateSignals(candlesMap);
    res.json({
      evaluatedCount: db.getActiveSignals().length,
      transitionedCount: updated.length,
      signals: db.getSignals().slice(0, 50),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/evolution/run — Manually trigger an autonomous research generation
apiRouter.post('/evolution/run', async (_req: Request, res: Response) => {
  try {
    const result = await autonomousScheduler.executeFullResearchCycle('MANUAL_USER_TRIGGER');
    res.json({
      success: true,
      result,
      cronState: db.getCronState(),
    });
  } catch (err: any) {
    res.status(409).json({ error: err.message });
  }
});

// GET /api/evolution/state — Current evolutionary state and top candidates
apiRouter.get('/evolution/state', (_req: Request, res: Response) => {
  const generations = db.getGenerations();
  const experiments = db.getExperiments();
  const accepted = experiments.filter(e => e.auditorVerdict === 'ACCEPTED');
  const rejected = experiments.filter(e => e.auditorVerdict === 'REJECTED');

  res.json({
    currentGeneration: generations.length > 0 ? generations[0].generation : 1,
    totalExperiments: experiments.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    generations,
    topCandidates: accepted.slice(0, 10),
  });
});

// GET /api/research/history
apiRouter.get('/research/history', (_req: Request, res: Response) => {
  res.json({
    experiments: db.getExperiments(),
    generations: db.getGenerations(),
  });
});

// GET /api/research/agents — Scientist, Engineer, Auditor deliberation records
apiRouter.get('/research/agents', (_req: Request, res: Response) => {
  res.json({
    reviews: db.getReviews(),
  });
});

// GET /api/research/autopsies — Forensic Loss Investigations & Evolved Antidotes
apiRouter.get('/research/autopsies', (_req: Request, res: Response) => {
  const autopsies = db.getLossAutopsies();
  res.json({
    autopsies,
    totalCount: autopsies.length,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/system/health — Provider health, db statistics, cron status
apiRouter.get('/system/health', (_req: Request, res: Response) => {
  const cron = db.getCronState();
  res.json({
    uptimeSeconds: Math.floor(process.uptime()),
    dbType: 'SQLite (Server File)',
    dbPath: 'data/signalforge.db.json',
    totalCandlesStored: db.getTotalCandlesCount(),
    activeSignalsCount: db.getActiveSignals().length,
    totalExperimentsRun: db.getExperiments().length,
    lastCronRun: cron.lastRun,
    nextCronRun: cron.nextRun,
    isCronRunning: cron.isRunning,
    cronHistory: cron.history,
    providers: db.getFeedHealthList(),
    sessions: dataFeedEngine.getMarketSessions(),
  });
});

// GET /api/system/export-d1 — Cloudflare D1 SQL Schema & wrangler.toml
apiRouter.get('/system/export-d1', (_req: Request, res: Response) => {
  res.json({
    schemaSql: db.generateCloudflareD1Schema(),
    wranglerToml: db.generateWranglerToml(),
    notes: 'Deploy directly using: npx wrangler d1 execute signalforge-db --file=migrations/0001_initial.sql',
  });
});

// POST /api/test/run and /api/tests/run — Run automated verification test suite
const handleRunTests = async (_req: Request, res: Response) => {
  try {
    const report = await runAllVerificationTests();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
apiRouter.post('/test/run', handleRunTests);
apiRouter.post('/tests/run', handleRunTests);

// GET /api/autopilot/logs — Real-time Autonomous Intelligence stream
apiRouter.get('/autopilot/logs', (_req: Request, res: Response) => {
  res.json({
    logs: db.getAutopilotLogs(40),
    activeCount: db.getActiveSignals().length,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/autopilot/status — Autonomous Engine health and status
apiRouter.get('/autopilot/status', (_req: Request, res: Response) => {
  res.json({
    status: 'ACTIVE_AUTOPILOT',
    mode: 'AUTONOMOUS_AGI_RESEARCH',
    activeSignalsCount: db.getActiveSignals().length,
    totalCandles: db.getTotalCandlesCount(),
    pairsMonitored: 8,
    intervalSeconds: 20,
    timestamp: new Date().toISOString(),
  });
});
