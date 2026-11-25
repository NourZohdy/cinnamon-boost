// Backspace/Delete removes one wave highlight; the overview strip moves only when dragged. Run: node test_highlights.mjs (written by Claude)
import assert from 'node:assert/strict';
import { fakeLS } from './test-support/fake-ls.mjs';

let count = 0;
async function test(name, fn) { await fn(); count++; console.log('ok -', name); }
const key = (f, k) => { const e = new f.w.KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true }); f.d.body.dispatchEvent(e); return e; };
const highlights = (f, ...spans) => {
  const list = spans.map(([start, end], i) => ({ id: 'h' + i, isRegion: false, start, end, selected: false }));
  f.ws.regions = { list, hoveredRegions: new Set(), removeRegion(id) { list.splice(list.findIndex(r => r.id === id), 1); }, clearSegments() { list.length = 0; } };
  return list;
};

await test('Backspace removes only the selected highlight', async () => {
  const f = fakeLS(); await f.flush();
  const list = highlights(f, [1, 2], [3, 4], [5, 6]);
  list[1].selected = true;
  let reachedLS = 0; f.w.addEventListener('keydown', () => reachedLS++);
  assert.equal(key(f, 'Backspace').defaultPrevented, true);
  assert.deepEqual(list.map(h => h.id), ['h0', 'h2']);
  assert.equal(reachedLS, 0, 'LS never sees the key, so it cannot clear the others');
  f.dom.window.close();
});

await test('with none selected, Delete removes the newest highlight only', async () => {
  const f = fakeLS(); await f.flush();
  const list = highlights(f, [1, 2], [3, 4]);
  key(f, 'Delete');
  assert.deepEqual(list.map(h => h.id), ['h0']);
  f.dom.window.close();
});

await test('a selected segment is left to Label Studio', async () => {
  const f = fakeLS(); await f.flush();
  const list = highlights(f, [1, 2]);
  f.ann.regionStore.selection.add(f.regions[0]);
  assert.equal(key(f, 'Backspace').defaultPrevented, false);
  assert.equal(list.length, 1);
  f.dom.window.close();
});

await test('overview: a press keeps the view, a drag moves it by the drag distance', async () => {
  const f = fakeLS(); await f.flush();
  let left = 0.2; const sets = [];
  Object.assign(f.ws, { zoom: 4, duration: 100 });
  Object.assign(f.ws.visualizer, { getScrollLeft: () => left, setScrollLeft: v => { left = v; sets.push(v); }, audio: { chunks: [[new Float32Array(1000)]] } });
  f.advance(100);
  const ov = f.d.querySelector('canvas.so-ov');
  assert.ok(ov, 'overview drawn');
  ov.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 40, right: 400, bottom: 40 });
  ov.dispatchEvent(new f.w.MouseEvent('pointerdown', { button: 0, clientX: 300, bubbles: true }));
  assert.deepEqual(sets, [], 'no jump on press');
  f.w.dispatchEvent(new f.w.MouseEvent('pointermove', { clientX: 340 }));
  assert.equal(left, 0.2 + 40 / 400);
  f.w.dispatchEvent(new f.w.MouseEvent('pointerup', {}));
  f.w.dispatchEvent(new f.w.MouseEvent('pointermove', { clientX: 10 }));
  assert.equal(left, 0.2 + 40 / 400, 'released: no more moves');
  f.dom.window.close();
});

console.log(`${count} tests passed`);
