import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

async function getAvailablePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  if (!address || typeof address === 'string') {
    probe.close();
    throw new Error('Could not allocate a local test port.');
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    probe.close(error => error ? reject(error) : resolve());
  });
  return port;
}

const port = await getAvailablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    DISABLE_HMR: 'true',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });

try {
  let started = false;
  let lastError = 'Development server did not become ready.';
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const pageResponse = await fetch(baseUrl, { signal: AbortSignal.timeout(1500) });
      assert.equal(pageResponse.status, 200, 'Development preview root should return HTTP 200.');
      const html = await pageResponse.text();
      assert.ok(html.includes('<div id="root"></div>'), 'Development preview should render the React root.');

      const entryResponse = await fetch(`${baseUrl}/src/main.tsx`, {
        signal: AbortSignal.timeout(1500),
      });
      assert.equal(entryResponse.status, 200, 'Vite must transform and serve the React entry module.');
      const entry = await entryResponse.text();
      assert.match(entry, /createRoot|react-dom/, 'React entry module should be transformed and served.');

      const healthResponse = await fetch(`${baseUrl}/api/_healthcheck`, {
        signal: AbortSignal.timeout(1500),
      });
      assert.equal(healthResponse.status, 200, 'Development API health endpoint should return HTTP 200.');
      const health = await healthResponse.json() as { status?: string };
      assert.equal(health.status, 'ok', 'Development API health endpoint should report status=ok.');

      started = true;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await delay(250);
    }
  }

  if (!started) {
    throw new Error(
      `Development preview startup failed. Last probe: ${lastError}\\n` +
      `Exit code: ${child.exitCode}\\nSTDOUT:\\n${stdout}\\nSTDERR:\\n${stderr}`
    );
  }

  console.log(`Development preview smoke test passed on PORT=${port}: React page, Vite entry module and API health endpoint responded.`);
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const stopped = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await Promise.race([stopped, delay(3000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await Promise.race([stopped, delay(1000)]);
    }
  }
}
