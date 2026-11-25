// Task pager helpers (bottom bar). Run: node tests/test_pager.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { pagerWindow, pagerStat } = createRequire(import.meta.url)('../src/page/content.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

test('pagerWindow: up to 3 before / after, nearest last / first, no wrapping', () => {
  const ids = [10, 11, 12, 13, 14, 15, 16, 17];
  assert.deepEqual(pagerWindow(ids, 13), { before: [10, 11, 12], after: [14, 15, 16], index: 3, count: 8 });
  assert.deepEqual(pagerWindow(ids, 11), { before: [10], after: [12, 13, 14], index: 1, count: 8 });
  assert.deepEqual(pagerWindow(ids, 10), { before: [], after: [11, 12, 13], index: 0, count: 8 });
  assert.deepEqual(pagerWindow(ids, 16), { before: [13, 14, 15], after: [17], index: 6, count: 8 });
  assert.deepEqual(pagerWindow(ids, 99), { before: [], after: [], index: -1, count: 8 });
  assert.deepEqual(pagerWindow([], 1), { before: [], after: [], index: -1, count: 0 });
  assert.deepEqual(pagerWindow(ids, 13, 1), { before: [12], after: [14], index: 3, count: 8 });
});

test('pagerStat: on disk / downloading / failed / not downloaded', () => {
  assert.deepEqual(pagerStat({ cached: true, duration: 119.8 }), { state: 'ready', text: '✓ 2:00', title: 'On your computer · 2:00 long' });
  assert.deepEqual(pagerStat({ cached: true, duration: 65.2 }), { state: 'ready', text: '✓ 1:05', title: 'On your computer · 1:05 long' });
  assert.deepEqual(pagerStat({ cached: true }), { state: 'ready', text: '✓', title: 'On your computer' });   // length not read yet
  assert.deepEqual(pagerStat({ progress: '34 MB' }), { state: 'loading', text: '↓ 34 MB', title: 'Downloading in the background' });
  assert.deepEqual(pagerStat({ failed: true }), { state: 'error', text: '✕', title: 'Download failed; it will load normally' });
  assert.deepEqual(pagerStat({}), { state: 'idle', text: '○', title: 'Not downloaded yet' });
  assert.deepEqual(pagerStat({ cached: true, progress: '5 MB', failed: true }).state, 'ready');            // on disk wins
});

console.log(`${n} tests passed`);
