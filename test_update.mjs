import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import update from './update.js';
import { disableDevReload } from './scripts/package.mjs';
import { fakeLS } from './test-support/fake-ls.mjs';

const { UPDATE_KEY, isNewer, releaseUrl } = update;
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const current = JSON.parse(read('manifest.json')).version;
const latest = '0.33.0';
const releases = 'https://github.com/NourZohdy/ls-sound-only/releases/';
const tagged = releases + 'tag/v' + latest;
const fallback = releases + 'latest';
const hostile = 'https://github.com.evil.invalid/NourZohdy/ls-sound-only/releases/latest';
const available = { latest, newer: true, url: tagged };
const hour = 60 * 60 * 1000;

assert.equal(isNewer('0.32.0', '0.31.1'), true);
assert.equal(isNewer('0.31.10', '0.31.9'), true);
assert.equal(isNewer('0.31.9', '0.31.10'), false);
assert.equal(isNewer('0.32.0', '0.32.0'), false);
assert.equal(isNewer('0.32', '0.32.0.0'), false);
assert.equal(isNewer('0.32.0.1', '0.32'), true);
assert.equal(isNewer('9007199254740993', '9007199254740992'), true);
for (const invalid of ['garbage', '1.2.3-rc', '1..2', '1.2.3.4.5', 999, null]) {
  assert.equal(isNewer(invalid, current), false);
  assert.equal(isNewer(latest, invalid), false);
}
assert.equal(releaseUrl(tagged), tagged);
for (const invalid of [hostile, 'javascript:alert(1)', releases + '%2e%2e/issues', releases.replace('https:', 'http:'), null]) {
  assert.equal(releaseUrl(invalid), fallback);
}

function fakeWorker({ dev = false, stored } = {}) {
  const listeners = [];
  const badge = [], fetches = [], colors = [], timeouts = [];
  let now = 0, reloads = 0, installed, startup;
  let reply = { tag_name: 'v' + latest, html_url: tagged };
  const source = read('reload.js');
  const context = vm.createContext({
    importScripts: file => vm.runInContext(read(file), context),
    URL,
    Date: { now: () => now },
    AbortSignal: { timeout: ms => timeouts.push(ms) },
    async fetch(url, options) {
      fetches.push({ url, accept: options.headers.Accept });
      if (!reply) return { ok: false, status: 404 };
      return { ok: true, json: async () => reply };
    },
    chrome: {
      runtime: {
        onInstalled: { addListener: fn => installed = fn },
        onStartup: { addListener: fn => startup = fn },
        onMessage: { addListener: fn => listeners.push(fn) },
        getManifest: () => ({ version: current }),
        reload: () => reloads++,
      },
      storage: { local: {
        get: async key => ({ [key]: stored }),
        set: async data => { stored = structuredClone(data[UPDATE_KEY]); },
      } },
      action: {
        async setBadgeText({ text }) { badge.push(text); },
        async setBadgeBackgroundColor({ color }) { colors.push(color); },
      },
    },
  });
  vm.runInContext(dev ? source : disableDevReload(source), context);
  return {
    badge, colors, fetches, timeouts, installed, startup,
    advance(ms) { now += ms; },
    reply(value) { reply = value; },
    get reloads() { return reloads; },
    send(msg) {
      for (const fn of listeners) fn(msg);
    },
    check(force) {
      return new Promise(resolve => {
        assert.equal(listeners[0]({ type: 'so-check-update', force }, {}, record => resolve(structuredClone(record))), true);
      });
    },
  };
}

const worker = fakeWorker();
await setImmediate();
assert.deepEqual(worker.badge, ['']);
worker.installed();
assert.deepEqual(await worker.check(), { ...available, checkedAt: 0 });
assert.deepEqual(worker.fetches, [{
  url: 'https://api.github.com/repos/NourZohdy/ls-sound-only/releases/latest', accept: 'application/vnd.github+json',
}]);
assert.deepEqual(worker.timeouts, [15000]);
assert.equal(worker.badge.at(-1), 'NEW');
assert.match(worker.colors.at(-1), /^#[0-9a-f]{6}$/i);
worker.advance(6 * hour - 1);
worker.startup();
await worker.check();
assert.equal(worker.fetches.length, 1);
worker.advance(1);
worker.reply(null);
assert.deepEqual(await worker.check(), { ...available, checkedAt: 6 * hour, failed: true });
assert.equal(worker.badge.at(-1), 'NEW');
worker.advance(hour - 1);
assert.equal((await worker.check()).checkedAt, 6 * hour);
assert.equal(worker.fetches.length, 2);
worker.advance(1);
worker.reply({ tag_name: 'v' + current, html_url: hostile });
assert.deepEqual(await worker.check(), { checkedAt: 7 * hour, latest: current, newer: false, url: fallback });
assert.equal(worker.badge.at(-1), '');
worker.reply({ tag_name: 'garbage', html_url: null });
assert.equal((await worker.check(true)).newer, false);
assert.equal(worker.fetches.length, 4);
worker.send('so-dev-reload');
assert.equal(worker.reloads, 0);

const restarted = fakeWorker({ dev: true, stored: { ...available, checkedAt: 0 } });
await setImmediate();
assert.deepEqual(restarted.badge, ['NEW']);
assert.deepEqual(restarted.fetches, []);
restarted.send('so-dev-reload');
assert.equal(restarted.reloads, 1);
const offline = fakeWorker();
offline.reply(null);
offline.startup();
assert.deepEqual(await offline.check(), { checkedAt: 0, failed: true });
assert.equal(offline.fetches.length, 1);

for (const [layout, pagerEnabled] of [['compact', true], ['compact', false], ['original', true]]) {
  const mirrored = { ...available, current };
  const ls = fakeLS({ layout, settings: { pager: pagerEnabled }, onEarly: w => w.localStorage.setItem(UPDATE_KEY, JSON.stringify(mirrored)) });
  const pager = ls.d.querySelector('.so-pager');
  const bar = ls.d.querySelector('.so-bar');
  assert.equal(!!pager, layout === 'compact' && pagerEnabled);
  const button = ls.d.querySelector('.so-update');
  assert.equal(button.parentElement, pager ?? bar);
  assert.ok(bar.closest(layout === 'compact' ? '.lsf-audio-tag' : '.lsf-video-segmentation'));
  assert.equal(button.textContent, 'Update ' + latest);
  assert.equal(button.hidden, false);
  if (pager) {
    const row = pager.querySelector('.so-pager-row');
    button.focus();
    ls.w.Htx.task.id = 3;
    ls.advance(500);
    assert.equal(row.isConnected, false);
    assert.equal(pager.querySelector('.so-update'), button);
    assert.equal(ls.d.activeElement, button);
    const layoutButton = ls.d.querySelector('.so-lbar button[aria-label="Layout"]');
    layoutButton.click();
    assert.equal(pager.isConnected, false);
    assert.equal(button.parentElement, bar);
    layoutButton.click();
    assert.equal(pager.isConnected, true);
    assert.equal(button.parentElement, pager);
  }
  const opened = [];
  ls.w.open = (...args) => opened.push(args);
  button.click();
  ls.w.localStorage.setItem(UPDATE_KEY, JSON.stringify({ ...mirrored, url: hostile }));
  button.click();
  assert.deepEqual(opened, [[tagged, '_blank', 'noopener'], [fallback, '_blank', 'noopener']]);
  for (const data of [{ ...mirrored, latest: current }, { ...mirrored, latest: 'garbage' }, { ...mirrored, newer: false }, null]) {
    ls.w.localStorage.setItem(UPDATE_KEY, JSON.stringify(data));
    button.click();
    ls.advance(1000);
    assert.equal(button.hidden, true);
  }
  assert.equal(opened.length, 2);
  ls.w.localStorage.setItem(UPDATE_KEY, JSON.stringify(mirrored));
  ls.advance(1000);
  assert.equal(button.hidden, false);
  ls.dom.window.close();
}

const { window: popup } = new JSDOM(read('popup.html'), { runScripts: 'outside-only' });
let next, onChanged, popupReloads = 0;
popup.chrome = {
  runtime: {
    getManifest: () => ({ version: current }),
    reload: () => popupReloads++,
    async sendMessage(msg) {
      assert.deepEqual(structuredClone(msg), { type: 'so-check-update', force: true });
      return next;
    },
  },
  storage: {
    local: { get: async () => ({ [UPDATE_KEY]: available, 'soundOnly.settings': {} }) },
    onChanged: { addListener: fn => onChanged = fn },
  },
};
for (const script of popup.document.querySelectorAll('script[src]')) popup.eval(read(script.getAttribute('src')));
await setImmediate();
const byId = id => popup.document.getElementById(id);
assert.equal(byId('update-banner').hidden, false);
assert.equal(byId('update-version').textContent, `Version ${latest} is available (you have ${current}).`);
assert.equal(byId('release-link').href, tagged);
assert.equal(byId('release-link').rel, 'noopener');
byId('reload-extension').click();
assert.equal(popupReloads, 1);
assert.equal(byId('update-result').getAttribute('role'), 'status');
for (const [record, status, hidden] of [
  [{ newer: false }, 'Up to date', true],
  [{ failed: true }, 'Could not check', true],
  [{ ...available, failed: true }, 'Could not check', false],
  [{ ...available, url: hostile }, '', false],
]) {
  next = record;
  await byId('check-update').onclick();
  assert.equal(byId('update-result').textContent, status);
  assert.equal(byId('update-banner').hidden, hidden);
}
assert.equal(byId('release-link').href, fallback);
onChanged({ [UPDATE_KEY]: { newValue: { ...available, latest: current } } }, 'local');
assert.equal(byId('update-banner').hidden, true);
popup.close();
console.log('update version, worker, toolbar and popup tests passed');
