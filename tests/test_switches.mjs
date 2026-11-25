import assert from 'node:assert/strict';
import { fakeLS } from './test-support/fake-ls.mjs';
import { createRequire } from 'node:module';
const { PRESETS } = createRequire(import.meta.url)('../settings.js');

for (const key of ['sound', 'cache', 'compact', 'pager', 'preview', 'gestures', 'segmentKeys', 'taskKeys', 'preload']) {
  const f = fakeLS({ settings: { [key]: key === 'preload' ? 0 : false } });
  f.advance(1500);
  await f.flush();
  assert.deepEqual(f.errors, [], key);
  const ctx = f.w.LSSoundOnly.ctx;
  if (key === 'sound') assert.equal(ctx.sound, null);
  if (key === 'cache') assert.equal(ctx.cache, null);
  if (key === 'compact') assert.equal(ctx.layout, null);
  if (key === 'pager') assert.equal(f.d.querySelector('.so-pager'), null);
  if (key === 'preview') assert.equal(f.d.querySelector('.so-ov'), null);
  if (key === 'gestures') assert.equal(ctx.gestures, null);
  assert.ok(ctx.toolbar, key);
  if (key === 'segmentKeys' || key === 'taskKeys') {
    const keys = key === 'segmentKeys' ? [' ', 'y', 'n', 'Enter', 'Tab'] : ['ArrowLeft', 'ArrowRight'];
    for (const k of keys) {
      let reached = false;
      const listener = () => { reached = true; };
      f.w.addEventListener('keydown', listener);
      const event = new f.w.KeyboardEvent('keydown', { key: k, code: k === ' ' ? 'Space' : k, bubbles: true, cancelable: true });
      f.d.body.dispatchEvent(event);
      f.w.removeEventListener('keydown', listener);
      assert.equal(reached, true, `${key}: ${k} reached LS`);
      assert.equal(event.defaultPrevented, false, `${key}: ${k} was not cancelled`);
    }
    if (key === 'taskKeys') assert.deepEqual(f.calls.task, []);
  }
  f.dom.window.close();
}
const off = fakeLS({ settings: PRESETS.off });
assert.equal(off.w.LSSoundOnly.ctx.mode, 'off');
assert.equal(off.w.LSSoundOnly.ctx.cache, null);
assert.equal(off.d.querySelector('.so-bar'), null);
assert.match(String(off.w.XMLHttpRequest.prototype.open), /this\.method/);
off.dom.window.close();
const listUrl = '/api/tasks?page=1&page_size=100&project=19';
const discovery = fakeLS({
  settings: { cache: false, preload: 0 },
  url: 'https://annotation.dlnlp.ai/projects/19/data',
  initialRoutes: [[listUrl, () => ({ ok: true, json: async () => ({ tasks: [1, 2, 3].map(id => ({ id, data: { video: `/media/${id}.mp4` } })) }) })]],
});
await discovery.flush();
assert.equal(discovery.w.LSSoundOnly.ctx.preload.tasksById.size, 3);
assert.equal(discovery.network.some(request => request.includes('/media/')), false);
discovery.dom.window.close();
const noPreload = fakeLS({ settings: { preload: 0 }, url: 'https://annotation.dlnlp.ai/projects/19/data',
  initialRoutes: [[listUrl, () => ({ ok: true, json: async () => ({ tasks: [1, 2, 3].map(id => ({ id, data: { video: `/media/${id}.mp4` } })) }) })]],
});
await noPreload.flush();
assert.equal(noPreload.w.LSSoundOnly.ctx.preload.tasksById.size, 3);
assert.equal(noPreload.network.some(request => request.includes('/media/')), false);
noPreload.dom.window.close();
console.log('switch tests passed');

