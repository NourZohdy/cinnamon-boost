import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  if (entry.isDirectory()) return ['node_modules', '.git', 'dist'].includes(entry.name) ? [] : files(join(dir, entry.name));
  return /\.(?:js|mjs)$/.test(entry.name) ? [join(dir, entry.name)] : [];
});
const checks = files('.').sort();
const suites = readdirSync('.').filter(name => /^test_.*\.mjs$/.test(name)).sort();
let failures = 0;
function run(label, args) {
  console.log(`\n> ${label}`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) { failures++; console.error(`${label}: FAILED`, result.error || result.status); }
}
for (const file of checks) run(`syntax ${file}`, ['--check', file]);
run('eslint', ['node_modules/eslint/bin/eslint.js', ...checks]);
for (const suite of suites) run(suite, [suite]);
console.log(`\nSummary: ${checks.length} syntax checks, ESLint, ${suites.length} suites; ${failures} failed.`);
if (failures) process.exitCode = 1;
