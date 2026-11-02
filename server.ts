/**
 * SignalForge ML — Full-Stack Server
 * Express API server with Vite dev middleware mounted in development.
 */

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './src/server/api.ts';
import { autonomousScheduler } from './src/server/scheduler.ts';
import { db } from './src/server/db.ts';
import { learningPlatform } from './src/server/learningPlatform.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const HOST = '0.0.0.0';

function resolvePort(): number {
  const rawPort = process.env.PORT;
  if (rawPort === undefined || rawPort.trim() === '') return 3000;

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT environment value: ${rawPort}`);
  }
  return port;
}

// Historical OHLC imports can be several megabytes; keep an explicit bounded limit.
app.use(express.json({ limit: '100mb' }));

// API Routes
app.use('/api', apiRouter);

async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start the always-on background service before accepting dashboard requests.
  // True 24/5 uptime requires an always-running Node host with CPU available between requests.
  autonomousScheduler.start();

  // Reconcile due, human-approved paper predictions independently of UI polling.
  const reconcileLearningOutcomes = () => {
    try {
      const result = learningPlatform.reconcileDuePredictions(
        symbol => db.getCandles(symbol, 5000),
        Date.now(),
      );
      if (result.resolved || result.invalidated) {
        console.info('[Learning] Resolved ' + result.resolved + '; quarantined ' + result.invalidated + ' invalid outcomes.');
      }
    } catch (error) {
      console.error('[Learning] Outcome reconciliation failed:', error);
    }
  };
  reconcileLearningOutcomes();
  setInterval(reconcileLearningOutcomes, 15_000);

  const port = resolvePort();
  const server = app.listen(port, HOST, () => {
    console.log(`[SignalForge ML] Server running at http://${HOST}:${port}`);
  });

  server.on('error', error => {
    console.error('[SignalForge ML] HTTP server failed to listen:', error);
    process.exitCode = 1;
  });
}

startServer().catch(err => {
  console.error('[SignalForge ML] Server initialization failed:', err);
  process.exit(1);
});
