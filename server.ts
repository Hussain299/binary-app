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

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  const prefix = `${flag}=`;
  const match = process.argv.find(arg => arg.startsWith(prefix));
  if (match) {
    return match.slice(prefix.length);
  }
  return undefined;
}

function resolveHost(): string {
  const cliHost = parseArg('--host');
  if (cliHost && cliHost.trim() !== '') return cliHost.trim();
  return process.env.HOST || '0.0.0.0';
}

function resolvePort(): number {
  const cliPort = parseArg('--port');
  const rawPort = cliPort ?? process.env.PORT;
  if (rawPort === undefined || rawPort.trim() === '') return 3000;

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return 3000;
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

    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      if (url.startsWith('/api')) return next();
      try {
        const fs = await import('fs/promises');
        let template = await fs.readFile(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        next(e);
      }
    });
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
  const reconciliationTimer = setInterval(reconcileLearningOutcomes, 15_000);

  const port = resolvePort();
  const host = resolveHost();
  const server = app.listen(port, host, () => {
    console.log(`[SignalForge ML] Server running at http://${host}:${port}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[SignalForge ML] Received ${signal}; stopping timers and flushing local state.`);

    clearInterval(reconciliationTimer);
    autonomousScheduler.stop();
    try {
      db.saveStateSync();
    } catch (error) {
      console.error('[SignalForge ML] Final database flush failed:', error);
      process.exitCode = 1;
    }

    const forcedExit = setTimeout(() => {
      console.error('[SignalForge ML] Graceful shutdown timed out; forcing process exit.');
      process.exit(1);
    }, 10_000);
    forcedExit.unref();

    server.close(error => {
      clearTimeout(forcedExit);
      if (error) {
        console.error('[SignalForge ML] HTTP server shutdown failed:', error);
        process.exitCode = 1;
      }
      process.exit(process.exitCode || 0);
    });
    // Do not let keep-alive sockets delay a Cloud Run termination signal.
    server.closeIdleConnections?.();
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  server.on('error', error => {
    console.error('[SignalForge ML] HTTP server failed to listen:', error);
    process.exitCode = 1;
  });
}

startServer().catch(err => {
  console.error('[SignalForge ML] Server initialization failed:', err);
  process.exit(1);
});
