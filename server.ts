/**
 * SignalForge ML — Full-Stack Server
 * Express API server with Vite dev middleware mounted in development.
 */

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './src/server/api.js';
import { autonomousScheduler } from './src/server/scheduler.js';
import { db } from './src/server/db.js';
import { learningPlatform } from './src/server/learningPlatform.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

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

  // Start background autonomous research cycle
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

  app.listen(PORT, HOST, () => {
    console.log(`[SignalForge ML] Server running at http://${HOST}:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('[SignalForge ML] Server initialization failed:', err);
  process.exit(1);
});
