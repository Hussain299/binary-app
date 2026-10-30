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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

app.use(express.json());

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

  app.listen(PORT, HOST, () => {
    console.log(`[SignalForge ML] Server running at http://${HOST}:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('[SignalForge ML] Server initialization failed:', err);
  process.exit(1);
});
