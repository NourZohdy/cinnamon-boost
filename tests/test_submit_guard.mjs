import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeLS } from './test-support/fake-ls.mjs';

const { PRESETS } = createRequire(import.meta.url)('../src/shared/settings.js');
const url = 'https://annotation.dlnlp.ai/cinnamon/projects/19/data';
const taskUrl = '/cinnamon/api/tasks/2', userUrl = '/cinnamon/api/current-user/whoami';
const patchUrl = '/cinnamon/api/annotations/12/';
const own = { id: 12, completed_by: 7, was_cancelled: false, lead_time: 20 };
const local = { pk: '12', user: { id: 7 }, skipped: false, leadTime: 20 };
const newest = { ...own, completed_by: { id: 7 }, created_at: '2026-11-23T10:00:00Z' };
const result = [{ id: 'r1', type: 'textarea', value: { text: ['current edits'] } }];
const successMessage = 'Already submitted: saved as an update to your annotation.';
const failureMessage = 'Not saved: this task was already submitted. Keep this page open and press Update.';
for (const [label, annotations, failedUrl, event = 'submitAnnotation', duplicate = false, timesOut = false, autoNext = duplicate, delayUrl] of [
  ['newest own annotation by date then ID', [
    { ...newest, id: 30, created_at: '2026-11-22T10:00:00Z' },
    { ...newest, id: 50, was_cancelled: true },
    { ...newest, id: 40, completed_by: 8 },
    { ...newest, id: 11 },
    newest,
  ], null, 'submitAnnotation', true],
  ['highest own annotation ID without timestamps', [{ ...own, id: 11 }, own], null, 'submitAnnotation', true, false, false],
  ['local own annotation skips task fetch while awaiting warm whoami', [], null, 'submitAnnotation', true, false, true, userUrl],
  ['task fetch taking 12 seconds still blocks submit', [own], null, 'submitAnnotation', true, false, true, taskUrl],
  ['PATCH returns an error status', [own], patchUrl, 'submitAnnotation', true],
  ['PATCH fails on the network', [own], patchUrl, 'submitAnnotation', true],
  ['PATCH times out', [own], patchUrl, 'submitAnnotation', true, true],
  ['no annotations', []],
  ['only another user', [{ ...own, completed_by: 8 }]],
  ['only a cancelled annotation', [{ ...own, was_cancelled: true }]],
  ['task fetch fails', [own], taskUrl],
  ['whoami fetch fails', [own], userUrl],
  ['task fetch times out', [own], taskUrl, 'submitAnnotation', false, true],
  ['update bypasses the check', [own], null, 'updateAnnotation'],
]) {
  const requests = [], saves = [];
  const timeouts = [];
  const fastPath = delayUrl === userUrl;
  const makeEvents = () => ({ invoke(name) { saves.push(name); return 'saved'; } });
  const firstEvents = makeEvents();
  const f = fakeLS({ url, settings: { ...PRESETS.off, sound: true, nextAfterSubmit: autoNext }, onEarly(w) {
    w.document.addEventListener('DOMContentLoaded', () => { w.Htx.events = firstEvents; }, { once: true, capture: true });
    w.AbortSignal.timeout = ms => {
      timeouts.push(ms);
      const controller = new w.AbortController();
      w.setTimeout(() => controller.abort(), ms);
      return controller.signal;
    };
    w.fetch = async (path, options) => {
      if (path.startsWith('/cinnamon/api/tasks?')) return { ok: false };
      requests.push({ path, options });
      if (timesOut && path === failedUrl) return new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
      if (path === failedUrl && label === 'PATCH returns an error status') return { ok: false, status: 403 };
      if (path === failedUrl) throw new Error('fetch failed');
      if (path === delayUrl) await new Promise(resolve => w.setTimeout(resolve, 12000));
      return { ok: true, json: async () => path === userUrl ? { id: 7 } : { annotations, drafts: [{ id: 4, lead_time: 5 }] } };
    };
  } });
  const { w, d, ann, calls } = f;
  d.cookie = 'other=value';
  d.cookie = 'csrftoken=test-token';
  w.Date.now = () => 100_000;
  const serializeAnnotation = () => result;
  Object.assign(ann, { loadedDate: new w.Date(90_000), draftId: 4 });
  ann.history.hasChanges = true;
  // Use the event annotation even when the editor selection has changed.
  const submitted = { ...ann, pk: '13', user: local.user, serializeAnnotation };
  w.Htx.annotationStore.annotations = [
    submitted, { ...submitted }, { ...local, pk: null }, { ...local, pk: '14', skipped: true },
    { ...local, pk: '15', user: { id: 8 } }, { ...local, pk: '16', user: null },
    ...(fastPath ? [local] : []),
  ];
  const paths = () => requests.map(({ path }) => path);
  assert.deepEqual(paths(), [userUrl], 'whoami starts before any save');
  const pager = w.CinnamonBoost.ctx.pager;
  // Call the event directly, like Label Studio's own shortcut.
  const attempt = firstEvents.invoke(event, w.Htx, submitted);
  const patchFailed = failedUrl === patchUrl;
  const settled = patchFailed ? assert.rejects(attempt, { message: failureMessage }, label) : attempt;
  assert.ok(pager.isSaving(), label);
  if (duplicate) assert.equal(await firstEvents.invoke(event, w.Htx, submitted), undefined, label);
  if (timesOut || delayUrl) {
    await f.flush();
    const timeout = 20000;
    f.advance(timesOut ? timeout - 1 : 6000);
    await f.flush();
    assert.deepEqual(saves, []);
    assert.deepEqual(calls.task, []);
    assert.deepEqual(paths(), fastPath ? [userUrl] : patchFailed ? [userUrl, taskUrl, patchUrl] : [userUrl, taskUrl], label);
    f.advance(timesOut ? 1 : 6000);
  }
  assert.equal(await settled, duplicate ? undefined : 'saved', label);
  assert.ok(!pager.isSaving(), label);
  assert.deepEqual(saves, duplicate ? [] : [event], label);
  assert.equal(d.querySelector('.so-next').textContent, duplicate ? (patchFailed ? failureMessage : successMessage) : '', label);
  const checkPaths = failedUrl === userUrl ? [userUrl, userUrl]
    : event === 'updateAnnotation' || fastPath ? [userUrl] : [userUrl, taskUrl];
  assert.deepEqual(paths(), duplicate ? [...checkPaths, patchUrl] : checkPaths, label);
  assert.deepEqual(timeouts, [...checkPaths.map(() => 20000), ...(duplicate ? [20000] : [])], label);
  assert.ok(requests.slice(0, checkPaths.length).every(({ options }) => options.cache === 'no-store'), label);
  f.advance(0);
  assert.deepEqual(calls.task, duplicate && autoNext && !patchFailed ? [3] : [], label);
  assert.ok(ann.history.hasChanges, label);
  if (duplicate) {
    const { options } = requests.at(-1);
    assert.equal(options.method, 'PATCH', label);
    assert.equal(options.credentials, 'same-origin', label);
    assert.deepEqual({ ...options.headers }, { 'Content-Type': 'application/json', 'X-CSRFToken': 'test-token' }, label);
    assert.deepEqual(JSON.parse(options.body), { result, lead_time: fastPath ? 30 : 35 }, label);
  }
  if (duplicate && !autoNext) {
    const replacement = makeEvents();
    w.Htx = { ...w.Htx, events: replacement };
    f.advance(500);
    assert.equal(w.Htx.events, replacement);
    assert.equal(await replacement.invoke(event, w.Htx, submitted), undefined);
    assert.deepEqual(paths(), [userUrl, taskUrl, patchUrl, patchUrl], 'poll wraps replacement and reuses the patched annotation ID');
    assert.deepEqual(saves, []);
  }
  w.close();
  console.log('ok -', label);
}

{
  const requests = [], saves = [];
  const { promise: post, resolve: finishPost } = Promise.withResolvers();
  let saved;
  const makeEvents = () => ({ async invoke(name, ls, annotation) {
    saves.push(name);
    await post;
    saved(ls, annotation, { id: 12, lead_time: 20, $meta: { status: 201 } });
  } });
  const f = fakeLS({ url, settings: { ...PRESETS.off, sound: true, taskKeys: true }, onEarly(w) {
    w.fetch = async (path, options) => {
      if (path.startsWith('/cinnamon/api/tasks?')) return { ok: false };
      requests.push([path, options?.method]);
      if (requests.length === 1) throw new Error('startup whoami failed');
      return { ok: true, json: async () => path === userUrl ? { id: 7 } : { annotations: [] } };
    };
  } });
  await f.flush();
  const { w, d, ann } = f;
  ann.serializeAnnotation = () => result;
  w.DM.SDK = { on(_name, callback) { saved = callback; }, off() { saved = null; } };
  w.Htx.events = makeEvents();
  const button = d.querySelector('.lsf-bottombar button');
  let clicks = 0;
  button.addEventListener('click', () => { clicks++; });
  button.click();
  await f.flush();
  f.advance(500);
  button.click();
  const key = new w.KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true, cancelable: true });
  button.dispatchEvent(key);
  assert.equal(key.defaultPrevented, true);
  assert.equal(clicks, 1, 'async click gap is still locked');
  const first = w.Htx.events.invoke('submitAnnotation', w.Htx, ann);
  await f.flush();
  w.Htx = { ...w.Htx, events: makeEvents() };
  f.advance(1000);
  await w.Htx.events.invoke('submitAnnotation', w.Htx, ann);
  assert.deepEqual(saves, ['submitAnnotation'], 'replacement editor shares the in-flight lock');
  finishPost();
  await first;
  await w.Htx.events.invoke('submitAnnotation', w.Htx, ann);
  assert.deepEqual(saves, ['submitAnnotation']);
  assert.deepEqual(requests, [[userUrl, undefined], [userUrl, undefined], [taskUrl, undefined], [patchUrl, 'PATCH']]);
  w.close();
  console.log('ok - failed startup lookup, click gap, and replacement editor share one submit');
}
