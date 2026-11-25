import assert from 'node:assert/strict';
import settingsApi from '../src/shared/settings.js';
import { fakeLS, makePlayer, mediaUrl } from './test-support/fake-ls.mjs';

const { PRESETS } = settingsApi;
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('ok -', name); }
const key = (f, code, options = {}) => {
  const event = new f.w.KeyboardEvent('keydown', { key: code === 'Space' ? ' ' : code, code, bubbles: true, cancelable: true, ...options });
  (f.d.activeElement || f.d.body).dispatchEvent(event);
  return event;
};
const healthy = f => { assert.deepEqual(f.errors, []); assert.deepEqual(f.network, []); f.dom.window.close(); };

await test('keyboard shortcuts and editing protection', async () => {
  const f = fakeLS(); await f.flush();
  assert.equal(f.d.body.classList.contains('so-compact'), true);
  key(f, 'Space'); assert.equal(f.calls.playback, 1);
  key(f, 'Space', { repeat: true }); assert.equal(f.calls.playback, 1);
  const box = f.d.querySelector('textarea'); box.value = 'hello'; box.focus();
  key(f, 'Space'); key(f, 'KeyY'); assert.equal(f.calls.playback, 1); assert.deepEqual(f.calls.choices, []);
  let deletions = 0; f.w.addEventListener('keydown', () => deletions++);
  key(f, 'Backspace'); key(f, 'Delete'); assert.equal(deletions, 0);
  key(f, 'Enter', { shiftKey: true }); assert.equal(f.calls.add, 0);
  key(f, 'Enter'); assert.equal(f.calls.add, 1);
  key(f, 'KeyY'); assert.deepEqual(f.calls.choices, []);
  f.regions[0].selected = true; key(f, 'KeyY'); key(f, 'KeyY'); key(f, 'KeyN');
  assert.deepEqual(f.calls.choices, ['Yes', 'No']);
  f.regions[0].selected = false; key(f, 'Tab');
  assert.deepEqual(f.calls.play.at(-1), [1, 3]);
  healthy(f);
});

await test('keyboard seek steps within the file and the active segment', async () => {
  const f = fakeLS(); await f.flush();
  const { ws } = f;
  const back = options => key(f, 'Digit9', { key: '9', ...options });
  const forward = options => key(f, 'Digit0', { key: '0', ...options });
  let digitHotkeys = 0;
  f.w.addEventListener('keydown', e => { if (/^Digit[09]$/.test(e.code)) digitHotkeys++; }, true);
  ws.currentTime = 0.5;
  ws.loaded = false;
  assert.equal(back().defaultPrevented, false);
  assert.equal(ws.currentTime, 0.5);
  assert.equal(digitHotkeys, 1);
  ws.loaded = true;
  assert.equal(back().defaultPrevented, true);
  assert.equal(ws.currentTime, 0);
  assert.equal(digitHotkeys, 1);
  const box = f.d.querySelector('[data-so="trans"] textarea'); box.focus();
  assert.equal(forward().defaultPrevented, false);
  assert.equal(back().defaultPrevented, false);
  assert.equal(ws.currentTime, 0);
  assert.equal(digitHotkeys, 3);
  assert.equal(forward({ altKey: true }).defaultPrevented, true);
  assert.equal(ws.currentTime, 1);
  assert.equal(digitHotkeys, 3);
  assert.equal(ws.playing, false);
  for (const tag of ['textarea', 'input', 'select', 'button']) {
    const field = f.d.body.appendChild(f.d.createElement(tag)); field.focus();
    assert.equal(forward().defaultPrevented, false);
    assert.equal(forward({ altKey: true }).defaultPrevented, false);
    assert.equal(ws.currentTime, 1);
    field.remove();
  }
  ws.currentTime = ws.duration - 0.5;
  forward(); assert.equal(ws.currentTime, ws.duration);
  key(f, 'Tab'); assert.deepEqual(f.calls.play.at(-1), [1, 3]);
  const range = ws.player.loop = { start: 1, end: 3 };
  ws.currentTime = 1.5;
  back(); assert.equal(ws.currentTime, 1);
  forward(); assert.equal(ws.currentTime, 2);
  forward({ repeat: true }); assert.ok(ws.currentTime > 2.99 && ws.currentTime < 3);
  assert.equal(ws.playing, true);
  assert.equal(ws.player.loop, range);
  assert.equal(f.calls.play.length, 1);
  assert.equal(f.calls.pause, 0);
  healthy(f);
});

await test('seek keys are inactive when segment keys are disabled', async () => {
  const f = fakeLS({ settings: { segmentKeys: false } }); await f.flush();
  assert.equal(key(f, 'Digit0', { key: '0' }).defaultPrevented, false);
  f.d.querySelector('[data-so="trans"] textarea').focus();
  assert.equal(key(f, 'Digit0', { key: '0', altKey: true }).defaultPrevented, false);
  assert.equal(f.ws.currentTime, 0);
  healthy(f);
});

await test('pager order and leave confirmation', async () => {
  const f = fakeLS(); await f.flush();
  const position = () => f.d.querySelector('.so-pager-position').textContent;
  assert.equal(position(), '2 / 4');
  const nav = name => f.d.querySelector(`.so-pager button[aria-label="${name}"]`).click();
  f.ann.history.hasChanges = true;
  f.ann.history.canUndo = true;
  nav('Next'); assert.match(position(), /Unsaved/); assert.deepEqual(f.calls.task, []);
  nav('Previous'); assert.deepEqual(f.calls.task, []); nav('Previous'); assert.deepEqual(f.calls.task, [1]);
  nav('Next'); f.advance(4001); nav('Next'); assert.deepEqual(f.calls.task, [1]);
  f.w.Htx.task.id = 3; f.advance(500); nav('Next'); assert.deepEqual(f.calls.task, [1]); nav('Next'); assert.deepEqual(f.calls.task, [1, 4]);
  f.w.Htx.task.id = 1; f.advance(500); assert.equal(f.d.querySelector('.so-pager button[aria-label="Previous"]').disabled, true);
  f.w.Htx.task.id = 4; f.advance(500); assert.equal(f.d.querySelector('.so-pager button[aria-label="Next"]').disabled, true);
  assert.equal(f.d.querySelector('.so-pager-blocks').children.length, 4);
  f.ann.history.canUndo = false;
  nav('Previous');
  assert.deepEqual(f.calls.task, [1, 4, 3]);
  f.ann.history.canUndo = true;
  f.d.querySelector('[aria-label="Layout"]').click(); f.w.Htx.task.id = 2; key(f, 'ArrowLeft');
  assert.match(f.d.querySelector('.so-next').textContent, /Unsaved/);
  healthy(f);
});

await test('Submit and Update advance only after server confirmation and native navigation', async () => {
  for (const scenario of [
    { key: true, status: 201, destination: [3] },
    { update: true, status: 200, destination: [3] },
    { status: 400, destination: [] },
    { reject: true, destination: [] },
    { status: 201, native: true, destination: [] },
    { status: 201, disabled: true, destination: [] },
    { status: 201, left: true, destination: [] },
  ]) {
    const f = fakeLS({ settings: { nextAfterSubmit: !scenario.disabled,
      keys: { submit: 'Shift+KeyS' } } });
    await f.flush();
    const { w, d, ann } = f;
    const button = d.querySelector('.lsf-bottombar button');
    const kind = scenario.update ? 'update' : 'submit';
    const eventName = kind + 'Annotation';
    button.dataset.testid = `bottombar-${kind}-button`;
    ann.history.hasChanges = true;
    const callbacks = new Map();
    w.DM.SDK = {
      on(name, callback) { callbacks.set(name, callback); },
      off(name, callback) { assert.equal(callbacks.get(name), callback); callbacks.delete(name); },
    };
    let confirm, finish, pending, clicks = 0;
    w.Htx.events = { async invoke(name, ls) {
      assert.equal(name, eventName);
      await new Promise((resolve, reject) => { confirm = scenario.reject ? () => reject(new Error('save failed')) : resolve; });
      callbacks.get(name)?.(ls, ann, { $meta: { status: scenario.status } });
      await new Promise(resolve => { finish = resolve; });
      if (scenario.native) ls.task.id = 4;
    } };
    button.addEventListener('click', () => { clicks++; pending = w.Htx.events.invoke(eventName, w.Htx, ann); });
    if (scenario.key) {
      key(f, 'KeyS');
      key(f, 'KeyS', { shiftKey: true, repeat: true });
      const box = d.querySelector('textarea');
      box.focus();
      key(f, 'KeyS', { shiftKey: true });
      box.blur();
      assert.equal(clicks, 0);
      key(f, 'KeyS', { shiftKey: true });
    } else button.click();
    assert.equal(clicks, 1);
    await f.flush();
    assert.equal(button.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })), false);
    assert.equal(key(f, 'KeyS', { shiftKey: true }).defaultPrevented, true);
    assert.equal(clicks, 1);
    assert.deepEqual(f.calls.task, []);
    w.DM.taskStore.list = [2, 4, 3, 1].map(id => ({ id }));
    if (scenario.left) w.Htx.task.id = 1;
    confirm();
    if (scenario.reject) {
      await assert.rejects(pending, /save failed/);
      button.click();
      assert.equal(clicks, 2);
      confirm();
      await assert.rejects(pending, /save failed/);
    }
    else {
      await f.flush();
      assert.deepEqual(f.calls.task, []);
      finish();
      await pending;
      f.advance(0);
    }
    assert.deepEqual(f.calls.task, scenario.destination);
    assert.equal(callbacks.size, 0);
    healthy(f);
  }
});

await test('pager refreshes task details after expiry and save, and shows live submitted status', async () => {
  let requests = 0, detail = { annotations: [], drafts: [] };
  const initialRoutes = [1, 2, 3, 4].map(id => [`/api/tasks/${id}`, () => {
    if (id === 2) requests++;
    return { ok: true, json: async () => detail };
  }]);
  initialRoutes.push(['/api/tasks?page=1&page_size=100&project=7', () => ({ ok: false })]);
  initialRoutes.push(['/api/current-user/whoami', () => ({ ok: true, json: async () => ({ id: 1 }) })]);
  const f = fakeLS({ url: 'https://annotation.dlnlp.ai/projects/7/data', initialRoutes,
    settings: { nextAfterSubmit: false } });
  const { w, d, ann } = f;
  w.DM.taskStore.list = [{ id: 2 }];
  const state = () => d.querySelector('.so-pager-block[aria-current="page"]').dataset.annotation;
  await f.flush();
  f.advance(3000);
  assert.equal(requests, 1);
  assert.equal(state(), 'working');
  await f.flush();
  ann.pk = 42;
  f.advance(500);
  assert.equal(state(), 'submitted');
  ann.history.hasChanges = true;
  f.advance(500);
  assert.equal(state(), 'working');

  f.advance(19000);
  assert.equal(requests, 1);
  f.advance(40000);
  assert.equal(requests, 2);
  await f.flush();
  let saved, pending;
  w.DM.SDK = { on(_name, callback) { saved = callback; }, off() { saved = null; } };
  w.Htx.events = { async invoke(_name, ls) { saved(ls, ann, { $meta: { status: 200 } }); } };
  const button = d.querySelector('.lsf-bottombar button');
  button.textContent = 'Update';
  button.addEventListener('click', () => { pending = w.Htx.events.invoke('updateAnnotation', w.Htx, ann); });
  button.click();
  await pending;
  f.advance(0);
  assert.equal(requests, 3);
  await f.flush();
  detail = { annotations: [{ result: [] }], drafts: [] };
  f.advance(3000);
  assert.equal(requests, 4);
  await f.flush();
  f.advance(500);
  assert.equal(state(), 'submitted');
  assert.deepEqual(f.calls.task, []);
  healthy(f);
});

await test('pager waits for a visible, loaded tab and checks one tile at a time while preload reuses task order', async () => {
  let lists = 0;
  const details = [];
  const tasks = [1, 2, 3, 4, 5].map(id => ({ id }));
  const f = fakeLS({ url: 'https://annotation.dlnlp.ai/projects/7/data', settings: { cache: false, preload: 2 },
    initialRoutes: [
      ['/api/current-user/whoami', () => ({ ok: false })],
      ['/api/tasks?page=1&page_size=100&project=7', () => {
        lists++;
        return { ok: true, json: async () => ({ tasks }) };
      }],
      ...tasks.map(({ id }) => [`/api/tasks/${id}`, () => new Promise(resolve => details.push([id, resolve]))]),
    ],
  });
  await f.flush();
  f.w.Htx.task.id = 3;
  f.advance(500);
  assert.equal(details.length, 0);
  f.w.Htx.isLoading = true;
  f.advance(4000);
  await f.flush();
  assert.equal(lists, 1);
  assert.equal(details.length, 0);
  f.w.Htx.isLoading = false;
  f.d.hidden = true;
  f.advance(1500);
  assert.equal(details.length, 0);
  f.d.hidden = false;
  f.advance(500);
  assert.deepEqual(details.map(([id]) => id), [3]);
  details[0][1]({ ok: true, json: async () => ({ annotations: [], drafts: [] }) });
  await f.flush();
  f.advance(500);
  assert.deepEqual(details.map(([id]) => id), [3, 1]);
  healthy(f);
});

await test('pager Next and nextAfterSubmit cross the last loaded Data Manager row', async () => {
  const f = fakeLS({ url: 'https://annotation.dlnlp.ai/projects/7/data', settings: { cache: false, preload: 0 },
    initialRoutes: [
      ['/api/current-user/whoami', () => ({ ok: false })],
      ['/api/tasks?page=1&page_size=100&project=7', () => ({ ok: true,
        json: async () => ({ tasks: [2, 3, 4, 5].map(id => ({ id })) }),
      })],
    ],
  });
  const { w, d, ann, calls } = f;
  await f.flush();
  w.DM.taskStore.list = [{ id: 1 }, { id: 2 }];
  let saved;
  w.DM.SDK = { on(_name, callback) { saved = callback; }, off() { saved = null; } };
  w.Htx.events = { invoke(name, ls) { saved(ls, ann, { id: 12, $meta: { status: 200 } }); } };
  f.advance(500);
  const next = d.querySelector('.so-pager button[aria-label="Next"]');
  assert.equal(next.disabled, false);
  assert.deepEqual([...w.CinnamonBoost.ctx.pager.pagerTasks().near.before], [1]);
  next.click();
  await w.Htx.events.invoke('updateAnnotation', w.Htx, ann);
  f.advance(0);
  assert.deepEqual(calls.task, [3, 3]);
  healthy(f);
});

await test('Submit key updates dirty annotations and goes next for clean ones', async () => {
  const f = fakeLS();
  await f.flush();
  const button = f.d.querySelector('.lsf-bottombar button');
  button.textContent = 'Update';
  let updates = 0;
  button.addEventListener('click', () => { updates++; });
  f.ann.history.hasChanges = true;
  key(f, 'ArrowRight');
  assert.equal(updates, 1);
  assert.deepEqual(f.calls.task, []);
  await f.flush();
  f.ann.history.hasChanges = false;
  f.advance(1500);
  key(f, 'ArrowRight');
  assert.equal(updates, 1);
  assert.deepEqual(f.calls.task, [3]);
  healthy(f);
});

await test('custom segment keys and the Speed mode control', async () => {
  const f = fakeLS({ settings: { keys: { play: 'KeyP', yes: 'Shift+KeyJ', no: '', nextSegment: 'KeyG' } } });
  await f.flush();
  key(f, 'Space');
  key(f, 'KeyP');
  assert.equal(f.calls.playback, 1);
  key(f, 'KeyG');
  assert.deepEqual(f.calls.play.at(-1), [1, 3]);
  f.regions[1].selected = true;
  key(f, 'KeyJ');
  key(f, 'KeyJ', { shiftKey: true });
  key(f, 'KeyN');
  assert.deepEqual(f.calls.choices, ['Yes']);
  const speed = f.d.querySelector('[aria-label="Speed mode"]');
  assert.equal(speed.textContent, 'Speed mode: n/a');
  f.sm.syncTargets = new f.w.Map(f.sm.syncTargets);
  f.sm.bufferingOrigins = new f.w.Set();
  f.advance(500);
  assert.equal(speed.textContent, 'Speed mode');
  assert.match(speed.title, /detaches the video from the audio/);
  assert.equal(speed.getAttribute('aria-pressed'), 'false');
  speed.click();
  assert.equal(speed.getAttribute('aria-pressed'), 'true');
  healthy(f);
});

await test('play all sorts, skips gaps, settles and stops', async () => {
  const f = fakeLS(); await f.flush();
  const start = () => { f.advance(500); f.d.querySelector('.so-segs-playall').click(); };
  start(); assert.deepEqual(f.calls.play.at(-1), [1, 3]);
  f.ws.currentTime = 1.5;
  key(f, 'Digit9', { key: '9' }); assert.equal(f.ws.currentTime, 1);
  f.ws.currentTime = 2.87; f.advance(50); assert.equal(f.calls.play.length, 1);
  key(f, 'Digit0', { key: '0' }); assert.ok(f.ws.currentTime > 2.99 && f.ws.currentTime < 3);
  f.advance(50); assert.deepEqual(f.calls.play.at(-1), [5, 7]);
  f.ws.currentTime = 6.88; f.advance(50); assert.equal(f.ws.playing, false);
  start(); f.ws.playing = false; f.advance(200); f.ws.playing = true; f.ws.currentTime = 2.88; f.advance(50); assert.deepEqual(f.calls.play.at(-1), [5, 7]);
  f.ws.playing = false; f.advance(450); f.advance(500); assert.notEqual(f.d.querySelector('.so-segs-playall').getAttribute('aria-pressed'), 'true');
  start(); f.advance(450); f.ws.currentTime = 0; f.advance(50); f.advance(500); assert.notEqual(f.d.querySelector('.so-segs-playall').getAttribute('aria-pressed'), 'true');
  start(); f.advance(500); f.d.querySelectorAll('.so-segs-row')[1].click(); f.advance(500); assert.notEqual(f.d.querySelector('.so-segs-playall').getAttribute('aria-pressed'), 'true');
  healthy(f);
});

await test('task and player replacement leaves new player safe and refreshes UI', async () => {
  const f = fakeLS(); await f.flush();
  const slider = f.d.querySelector('.so-speed-range'); slider.value = '1.75'; slider.dispatchEvent(new f.w.Event('input', { bubbles: true }));
  f.d.querySelector('.so-segs-playall').click();
  const replacementCalls = { play: [], pause: 0 };
  const replacement = makePlayer(replacementCalls, f.d.querySelector('.wave'));
  f.audio._ws = replacement; f.w.Htx.task.id = 3;
  f.regions.push({ id: 'c', type: 'audioregion', start: 8, end: 9, results: [] });
  f.advance(1500);
  assert.equal(replacementCalls.pause, 0); assert.deepEqual(replacementCalls.play, []); assert.equal(replacement.rate, 1.75);
  assert.equal(f.d.querySelectorAll('.so-segs').length, 1); assert.equal(f.d.querySelectorAll('.so-pager').length, 1);
  assert.equal(f.d.querySelectorAll('.so-segs-row').length, 3);
  assert.equal(f.d.querySelector('.so-pager-block[aria-current="page"] .so-pager-value').textContent, '0/3');
  f.w.Htx.annotationStore.selected = { ...f.ann, regionStore: { regions: [f.regions[0]], selection: new Set() } };
  f.advance(500);
  assert.equal(f.d.querySelectorAll('.so-segs-row').length, 1);
  assert.equal(f.d.querySelector('.so-pager-block[aria-current="page"] .so-pager-value').textContent, '0/1');
  healthy(f);
});

await test('early XHR cache hydration and native fallback across modes', async () => {
  for (const settings of Object.values(PRESETS)) {
    let xhr;
    const f = fakeLS({ settings, holdCache: true, allowedNativeUrls: [mediaUrl], onEarly(w) {
      assert.equal(w.document.body, null);
      assert.equal(w.Htx, undefined);
      xhr = new w.XMLHttpRequest(); xhr.open('GET', mediaUrl); xhr.responseType = 'arraybuffer'; xhr.send();
    } });
    const keyUrl = new f.w.URL(mediaUrl, f.w.location.href).href;
    const cacheUrl = `${f.w.location.origin}/__cinnamon-boost-cache__/?k=${encodeURIComponent(keyUrl)}`;
    f.cache.set(cacheUrl, new f.w.Response(new f.w.Blob(['cached'], { type: 'video/mp4' }), { headers: { 'Content-Type': 'video/mp4' } }));
    if (!settings.cache) { assert.deepEqual(xhr.sent, [mediaUrl]); }
    else assert.deepEqual(xhr.sent, []);
    f.releaseCache(); await f.flush();
    if (settings.cache) { assert.match(xhr.sent[0], /^blob:fake-/); }
    f.allowedNative.add('/data/local-files/?d=other.mp4');
    const fallback = new f.w.XMLHttpRequest(); fallback.open('GET', '/data/local-files/?d=other.mp4'); fallback.responseType = 'arraybuffer'; fallback.send();
    assert.deepEqual(fallback.sent, ['/data/local-files/?d=other.mp4']);
    if (settings.cache) {
      const bytes = new f.w.Uint8Array([11, 22, 33]);
      fallback.addEventListener('load', () => { const response = fallback.response; structuredClone(response, { transfer: [response] }); });
      fallback.complete(bytes.buffer);
      assert.equal(bytes.byteLength, 0);
      const saved = [...f.objects.values()].find(blob => blob.size === 3);
      assert.ok(saved, 'response copied before the waveform consumer detached it');
    }
    healthy(f);
  }
  for (const settings of [PRESETS.loading, PRESETS.full]) {
    const initialRoutes = [1, 2, 3, 4].map(id => [`/api/tasks/${id}`, () => ({ ok: false })]);
    initialRoutes.push(['/api/current-user/whoami', () => ({ ok: true, json: async () => ({ id: 1 }) })]);
    const f = fakeLS({ settings, url: 'https://annotation.dlnlp.ai/projects/7/data', allowedNativeUrls: [mediaUrl], initialRoutes });
    await f.flush();
    let finishDownload;
    const download = new Promise(resolve => { finishDownload = resolve; });
    const nextUrl = '/data/local-files/?d=next.mp4';
    f.routes.set('/api/tasks?page=1&page_size=100&project=7', () => ({ ok: true, json: async () => ({ tasks: [
      { id: 2, data: { video: mediaUrl } }, { id: 3, data: { video: nextUrl } },
    ] }) }));
    let read = 0;
    f.routes.set(new f.w.URL(nextUrl, f.w.location.href).href, () => ({ ok: true, status: 200,
      headers: new Headers({ 'Content-Type': 'video/mp4' }), body: { getReader: () => ({ async read() {
        if (read++) return { done: true };
        await download; return { done: false, value: new Uint8Array([4, 5, 6]) };
      } }) } }));
    f.w.Htx.task.dataObj.video = mediaUrl;
    const current = new f.w.XMLHttpRequest(); current.open('GET', mediaUrl); current.responseType = 'arraybuffer'; current.send();
    current.complete(new f.w.Uint8Array([1, 2, 3]).buffer); await f.flush();
    f.advance(1000); await f.flush();
    const waiting = new f.w.XMLHttpRequest(); waiting.open('GET', nextUrl); waiting.responseType = 'arraybuffer'; waiting.send();
    assert.deepEqual(waiting.sent, []);
    finishDownload(); await f.flush();
    assert.match(waiting.sent[0], /^blob:fake-/);
    healthy(f);
  }
});
console.log(`${count} tests passed`);

