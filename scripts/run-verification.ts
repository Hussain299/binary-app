import { runAllVerificationTests } from '../src/server/tests.js';

const report = await runAllVerificationTests();
console.log(
  `Verification suite: ${report.summary.passed}/${report.summary.total} passed; ${report.summary.failed} failed; ${report.summary.durationMs}ms.`
);

for (const result of report.results) {
  const status = result.passed ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${result.category}: ${result.name}${result.error ? ` — ${result.error}` : ''}`);
}

if (report.summary.failed > 0) process.exitCode = 1;
