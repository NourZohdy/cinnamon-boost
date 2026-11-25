import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
const sources = manifest.content_scripts.filter(script => script.world === 'MAIN').flatMap(script => script.js).map(path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8'));
export const mediaUrl = '/data/local-files/?d=sample.mp4';

export function fakeLS({ settings, layout = 'compact', cacheEntries = [], holdCache = false, mountedAtReady = false, onEarly = () => {}, allowedNativeUrls = [], initialRoutes = [], url = 'https://annotation.dlnlp.ai/label' } = {}) {
  const errors = [], network = [], objects = new Map(), cache = new Map(cacheEntries);
  let releaseCache;
  const allowedNative = new Set(allowedNativeUrls);
  const cacheGate = holdCache ? new Promise(resolve => { releaseCache = resolve; }) : Promise.resolve();
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url, runScripts: 'outside-only', virtualConsole,
  });
  const w = dom.window, d = w.document;
  d.body.remove();
  if (settings !== undefined) w.localStorage.setItem('cinnamonBoost.settings', JSON.stringify(settings));
  w.localStorage.setItem('cinnamonBoost.layout', layout);
  let now = 0, nextTimer = 1;
  const timers = new Map();
  const schedule = (fn, ms, interval = 0) => { const id = nextTimer++; timers.set(id, { fn, at: now + ms, interval }); return id; };
  w.setTimeout = (fn, ms = 0) => schedule(fn, ms);
  w.clearTimeout = id => timers.delete(id);
  w.setInterval = (fn, ms = 0) => schedule(fn, ms, ms);
  w.clearInterval = w.clearTimeout;
  w.requestAnimationFrame = fn => schedule(() => fn(now), 16);
  w.cancelAnimationFrame = w.clearTimeout;
  Object.defineProperty(w.performance, 'now', { value: () => now });
  Object.defineProperty(d, 'hidden', { value: false, configurable: true, writable: true });
  const rect = { x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 100, width: 400, height: 100, toJSON() {} };
  w.HTMLElement.prototype.getBoundingClientRect = () => rect;
  w.HTMLElement.prototype.getClientRects = () => [rect];
  const canvasCalls = [];
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (_, name) => (...args) => canvasCalls.push([name, ...args]), set: () => true });
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.URL.createObjectURL = blob => { const url = `blob:fake-${objects.size + 1}`; objects.set(url, blob); return url; };
  w.URL.revokeObjectURL = url => objects.delete(url);
  w.Response = class { constructor(blob, options = {}) { this.value = blob; this.headers = new w.Headers(options.headers); } async blob() { return this.value; } };
  // jsdom does not supply Headers; Node's implementation works with these simple cache responses.
  w.Headers = globalThis.Headers;
  const disk = {
    async keys() { await cacheGate; return [...cache.keys()].map(url => ({ url })); },
    async match(req) { return cache.get(typeof req === 'string' ? req : req.url); },
    async put(req, response) { cache.set(typeof req === 'string' ? req : req.url, response); },
    async delete(req) { return cache.delete(typeof req === 'string' ? req : req.url); },
  };
  const cacheNames = new Set();
  w.caches = { async open(name) { cacheNames.add(name); return disk; } };
  const routes = new Map(initialRoutes);
  w.fetch = (url, options) => { const key = url instanceof Request ? url.url : String(url); const route = routes.get(key); if (route) return Promise.resolve(route(url, options)); const message = `Unexpected fetch: ${url}`; network.push(message); return Promise.reject(new Error(message)); };
  class FakeXHR extends w.EventTarget {
    constructor() { super(); this.readyState = 0; this.status = 0; this.responseType = ''; this.timeout = 0; this.withCredentials = false; this.sent = []; }
    open(method, url) { this.method = method; this.url = String(url); this.readyState = 1; }
    send() { this.sent.push(this.url); if (!this.url.startsWith('blob:') && !allowedNative.has(this.url)) { const message = `Unexpected XHR: ${this.url}`; network.push(message); throw new Error(message); } }
    abort() { this.aborted = true; }
    setRequestHeader() {}
    overrideMimeType() {}
    getResponseHeader() { return 'video/mp4'; }
    get response() { return this.value; }
    complete(value) { this.value = value; this.status = 200; this.readyState = 4; this.dispatchEvent(new w.Event('load')); }
  }
  w.XMLHttpRequest = FakeXHR;
  // Evaluate at document_start, before the fake editor and body exist.
  for (const source of sources) w.eval(source);
  onEarly(w);
  const body = d.createElement('body'); d.documentElement.appendChild(body);
  body.innerHTML = `<div class="lsf-topbar"></div><div class="lsf-main-view__annotation"><div><div><div><div class="lsf-video-segmentation"><video></video><div class="lsf-seeker"></div></div></div><div><div class="lsf-audio-tag"><audio></audio><div><span><button aria-label="Play">Play</button></span><span></span><span><button aria-label="Audio settings">Settings</button></span></div><div class="wave"></div></div></div></div><form><div style="border: 1px solid"><h3>Transcription (Arabic script)</h3><textarea></textarea><button type="button" data-testid="textarea-add-button">Add</button></div></form></div></div><div class="lsf-bottombar"><button>Submit</button></div>`;
  const regions = [ { id: 'b', type: 'audioregion', start: 5, end: 7, selected: false, results: [] }, { id: 'a', type: 'audioregion', start: 1, end: 3, selected: false, results: [] } ];
  const calls = { play: [], pause: 0, task: [], choices: [], playback: 0, add: 0 };
  const ws = makePlayer(calls, d.querySelector('.wave'));
  const sm = { syncTargets: new Map(), bufferingOrigins: new Set(), locked: false, sync() {} };
  const audio = { name: 'audio', type: 'audio', _ws: ws, syncManager: sm, addRegion() {} };
  const video = { name: 'video', type: 'video', syncManager: sm };
  sm.syncTargets.set('audio', audio); sm.syncTargets.set('video', video);
  const choices = ['Yes', 'No'].map(value => ({ value, sel: false, setSelected() { calls.choices.push(value); this.sel = true; } }));
  const ann = { names: new Map([['audio', audio], ['video', video], ['segment_has_code_switch', { children: choices }]]), regionStore: { regions, selection: new Set() }, history: { hasChanges: false }, selectArea(region) { regions.forEach(r => { r.selected = r === region; }); }, unselectAll() { regions.forEach(r => { r.selected = false; }); } };
  w.Htx = { task: { id: 2, dataObj: {} }, annotationStore: { selected: ann } };
  w.DM = { taskStore: { list: [1, 2, 3, 4].map(id => ({ id })), total: 4 }, setTask({ taskID }) { calls.task.push(taskID); } };
  d.querySelector('[aria-label="Play"]').addEventListener('click', () => { calls.playback++; });
  d.querySelector('[data-testid="textarea-add-button"]').addEventListener('click', () => { calls.add++; });
  // Label Studio mounts its players after DOM ready; attaching a complete compact editor
  // before startup exposes a pre-existing temporal-dead-zone error in src/page/content.js.
  const videoNode = d.querySelector('.lsf-video-segmentation');
  const videoParent = videoNode.parentElement; if (!mountedAtReady) videoNode.remove();
  d.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  if (!mountedAtReady) videoParent.appendChild(videoNode);
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      let chosen = null;
      for (const [id, timer] of timers) if (timer.at <= end && (!chosen || timer.at < chosen[1].at)) chosen = [id, timer];
      if (!chosen) break;
      const [id, timer] = chosen; now = timer.at;
      if (timer.interval) timer.at += timer.interval; else timers.delete(id);
      timer.fn();
    }
    now = end;
  }
  if (!mountedAtReady) advance(500);
  const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
  return { w, d, dom, calls, regions, ann, audio, video, sm, ws, choices, advance, flush, releaseCache, cache, cacheNames, disk, objects, network, errors, canvasCalls, allowedNative, routes };
}

export function makePlayer(calls, container) {
  return { currentTime: 0, duration: 10, rate: 1, zoom: 1, playing: false, settings: {},
    play(start, end) { calls.play.push([start, end]); this.currentTime = start; this.playing = true; },
    pause() { calls.pause++; this.playing = false; }, seek(time) { this.currentTime = time; },
    player: { pause() {}, loop: false }, regions: { list: [], hoveredRegions: new Set() },
    visualizer: { container, getScrollLeft: () => 0, setScrollLeft() {}, audio: { chunks: [] } } };
}






