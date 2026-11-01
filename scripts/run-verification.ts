import { runAllVerificationTests } from '../src/server/tests.js';
import { runLearningPlatformVerificationTests } from '../src/server/learningPlatform.js';

const startedAt = Date.now();
const baseReport = await runAllVerificationTests();
const learningResults = await runLearningPlatformVerificationTests();
const results = [...baseReport.results, ...learningResults];
const passed = results.filter(result => result.passed).length;
const failed = results.length - passed;
console.log('Verification suite: ' + passed + '/' + results.length + ' passed; ' + failed + ' failed; ' + (Date.now() - startedAt) + 'ms.');
for (const result of results) {
  const status = result.passed ? 'PASS' : 'FAIL';
  console.log('[' + status + '] ' + result.category + ': ' + result.name + (result.error ? ' — ' + result.error : ''));
}
if (failed > 0) process.exitCode = 1;