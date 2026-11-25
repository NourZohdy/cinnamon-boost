// Gentle zoom + overview helpers. Run: node test_zoom.mjs (written by Claude)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { zoomFactor, zoomAt, peaks, pageAt } = createRequire(import.meta.url)('../src/page/content.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('one mouse-wheel notch is a gentle step, not a jump', () => {
  const zin = zoomFactor(-100), zout = zoomFactor(100);
  assert.ok(zin > 1.1 && zin < 1.25, String(zin));
  assert.ok(zout < 0.9 && zout > 0.8, String(zout));
  assert.equal(zoomFactor(-10000), 1.25);                  // capped per event
  assert.ok(Math.abs(zoomFactor(-2) - 1) < 0.01);           // trackpad pinch: tiny steps
  assert.equal(zoomFactor(-3, 1), zoomFactor(-99));         // line-mode wheels
});

test('zooming keeps the time under the mouse in place', () => {
  const at = (z, s, f) => s + f / z;                          // time under frac f, as a file fraction
  for (const [z, s, f, k] of [[1, 0, 0.3, 1.16], [4, 0.25, 0.8, 1.16], [10, 0.5, 0.1, 0.86]]) {
    const r = zoomAt(z, s, k, f, 10000);
    near(at(r.zoom, r.scrollLeft, f), at(z, s, f));
  }
});

test('zoom and scroll stay inside LS limits', () => {
  assert.deepEqual(zoomAt(1, 0, 0.5, 0.5, 100), { zoom: 1, scrollLeft: 0 });
  assert.equal(zoomAt(90, 0, 2, 0.5, 100).zoom, 100);
  const r = zoomAt(4, 0.75, 1.2, 1, 100);                    // right edge
  assert.ok(r.scrollLeft <= 1 - 1 / r.zoom + 1e-12);
});

test('peaks give min/max per column', () => {
  const data = new Float32Array([0, 0.5, -0.2, 0, 0, -0.9, 0.1, 0]);
  const p = peaks(data, 2);
  near(p.max[0], 0.5, 1e-6); near(p.min[0], -0.2, 1e-6);
  near(p.max[1], 0.1, 1e-6); near(p.min[1], -0.9, 1e-6);
});

test('pageAt: next page starts just before the playhead, clamped to the file', () => {
  near(pageAt(50, 100, 4), 0.5 - 0.02 / 4);           // t at 2% of the view from the left
  near(pageAt(99, 100, 4), 0.75);                     // last page: view end = file end
  near(pageAt(0.1, 100, 4), 0);                       // never before the file start
  near(pageAt(50, 100, 1), 0);                        // not zoomed: nothing to turn
  near(pageAt(50, 0, 4), 0);
});

console.log(`\n${n} tests passed`);
