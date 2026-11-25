// Compact layout, phase 3 helpers (segments panel). Run: node tests/test_segments.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { shortTime, stepIndex, segmentState } = createRequire(import.meta.url)('../src/page/content.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

test('shortTime: m:ss.s, rounded to a tenth', () => {
  assert.equal(shortTime(0), '0:00.0');
  assert.equal(shortTime(24.66), '0:24.7');
  assert.equal(shortTime(57.7), '0:57.7');
  assert.equal(shortTime(63.76), '1:03.8');
  assert.equal(shortTime(59.96), '1:00.0');          // rounding carries into the minute
  assert.equal(shortTime(605.04), '10:05.0');
  assert.equal(shortTime(NaN), '');
  assert.equal(shortTime(-1), '');
});

test('stepIndex: previous / next without wrapping', () => {
  assert.equal(stepIndex(3, 1, 1), 2);
  assert.equal(stepIndex(3, 1, -1), 0);
  assert.equal(stepIndex(3, 2, 1), -1);              // already last
  assert.equal(stepIndex(3, 0, -1), -1);             // already first
  assert.equal(stepIndex(3, -1, 1), 0);              // nothing selected: next = first
  assert.equal(stepIndex(3, -1, -1), 2);             // nothing selected: previous = last
  assert.equal(stepIndex(0, -1, 1), -1);
});

// a region as LS keeps it: results with from_name.name and value.choices
const region = (...results) => ({ results: results.map(([name, choices]) => ({ from_name: { name }, value: { choices } })) });

test('segmentState: skipped wins, then the page says Complete, else to do', () => {
  assert.equal(segmentState(region(['segment_skip_toggle', ['Skip this segment']]), 'Segment 1 00:24.66–00:31.93 ✓ Complete'), 'skip');
  assert.equal(segmentState(region(['segment_gender', ['Male']]), 'Segment 2 00:57.70–01:03.76 ✓ Complete'), 'done');
  assert.equal(segmentState(region(['segment_gender', ['Male']]), 'Segment 3 01:20.10–01:27.40 ⚠ Missing: dialect'), 'todo');
  assert.equal(segmentState(region(), ''), 'todo');
  assert.equal(segmentState(region(['segment_skip_toggle', []]), 'Segment 1 ✓ Complete'), 'done');   // toggle unticked
  assert.equal(segmentState(null, 'x'), 'todo');
});

console.log(`${n} tests passed`);
