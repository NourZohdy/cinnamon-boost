// Phase 2 tests: reuse the waveform's downloaded file. Run: node tests/test_local.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mediaKey, captureBlob, hookResponse, swapWhenPaused } = require('../src/page/content.js');

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('ok -', name); };
const BASE = 'https://annotation.dlnlp.ai/cinnamon/projects/19/data';

await test('mediaKey ignores lsref and matches the task URL', () => {
  const a = mediaKey('/cinnamon/data/local-files/?d=videos%2Fx.mp4', BASE);
  const b = mediaKey('https://annotation.dlnlp.ai/cinnamon/data/local-files/?d=videos%2Fx.mp4&lsref=abc', BASE);
  assert.ok(a);
  assert.equal(a, b);
  assert.notEqual(a, mediaKey('/cinnamon/data/local-files/?d=videos%2Fy.mp4', BASE));
});

await test('mediaKey rejects non-media URLs', () => {
  assert.equal(mediaKey('/cinnamon/api/tasks/1', BASE), null);
  assert.equal(mediaKey('/cinnamon/data/local-files/', BASE), null);
  assert.equal(mediaKey('not a url at all', undefined), null);
});

await test('captureBlob accepts full arraybuffer and blob responses', async () => {
  const buf = new Uint8Array([1, 2, 3]).buffer;
  const b1 = captureBlob({ status: 200, responseType: 'arraybuffer', response: buf, getResponseHeader: () => 'video/mp4' });
  assert.ok(b1 instanceof Blob);
  assert.equal(b1.size, 3);
  assert.equal(b1.type, 'video/mp4');
  const src = new Blob([new Uint8Array(5)], { type: 'video/mp4' });
  assert.equal(captureBlob({ status: 200, responseType: 'blob', response: src, getResponseHeader: () => null }), src);
  const b3 = captureBlob({ status: 200, responseType: 'arraybuffer', response: buf, getResponseHeader: () => null });
  assert.equal(b3.type, 'video/mp4');
});

await test('captureBlob rejects partial, failed and text responses', () => {
  const buf = new Uint8Array([1]).buffer;
  const h = () => 'video/mp4';
  assert.equal(captureBlob({ status: 206, responseType: 'arraybuffer', response: buf, getResponseHeader: h }), null);
  assert.equal(captureBlob({ status: 404, responseType: 'arraybuffer', response: buf, getResponseHeader: h }), null);
  assert.equal(captureBlob({ status: 200, responseType: 'text', response: 'x', getResponseHeader: h }), null);
  assert.equal(captureBlob({ status: 200, responseType: '', response: 'x', getResponseHeader: h }), null);
  assert.equal(captureBlob({ status: 200, responseType: 'arraybuffer', response: null, getResponseHeader: h }), null);
});

await test('captureBlob rejects an emptied (detached) buffer and an empty blob', () => {
  const buf = new Uint8Array([1, 2, 3]).buffer;
  structuredClone(buf, { transfer: [buf] });          // what LS does: hand it to a worker
  assert.equal(buf.byteLength, 0);
  const h = () => 'video/mp4';
  assert.equal(captureBlob({ status: 200, responseType: 'arraybuffer', response: buf, getResponseHeader: h }), null);
  assert.equal(captureBlob({ status: 200, responseType: 'blob', response: new Blob([]), getResponseHeader: h }), null);
});

await test('hookResponse copies the data before LS empties it', () => {
  const real = new Uint8Array([9, 8, 7, 6]).buffer;
  const xhr = { readyState: 1, status: 200, responseType: 'arraybuffer', getResponseHeader: () => 'video/mp4' };
  const nativeGet = function () { return real; };
  let copy = null;
  hookResponse(xhr, nativeGet, r => { copy = captureBlob(xhr, r); });
  assert.equal(xhr.response, real);                    // read before the download ends: no copy
  assert.equal(copy, null);
  xhr.readyState = 4;
  const seenByLS = xhr.response;                       // LS's load handler reads it ...
  structuredClone(seenByLS, { transfer: [seenByLS] }); // ... and hands it to its worker
  assert.ok(copy instanceof Blob);
  assert.equal(copy.size, 4);                          // our copy survived
  xhr.response;                                        // later reads do not copy again
  assert.equal(copy.size, 4);
});

// Fake media element on node's EventTarget, behaving like a browser: setting src
// resets the internal position to 0 and the duration to NaN until 'loadedmetadata'
// (or 'error' for a URL starting with "blob:bad").
class FakeMedia extends EventTarget {
  constructor(paused) {
    super();
    this.paused = paused; this._t = 42.5; this._dur = 147.05; this.playbackRate = 1.5; this.muted = true;
    this._src = 'https://server/file.mp4'; this.dataset = {}; this.played = 0;
  }
  get currentTime() { return this._t; }
  set currentTime(v) { if (!Number.isFinite(v)) throw new TypeError('non-finite'); this._t = v; }
  get duration() { return this._dur; }
  get src() { return this._src; }
  set src(v) {
    this._src = v; this._t = 0; this._dur = NaN; this.playbackRate = 1;
    const bad = v.startsWith('blob:bad');
    setTimeout(() => {
      if (bad) { this.dispatchEvent(new Event('error')); return; }
      this._dur = 147.05; this.dispatchEvent(new Event('loadedmetadata'));
    }, 5);
  }
  get currentSrc() { return this._src; }
  play() { this.played++; return Promise.resolve(); }
}
const tick = ms => new Promise(r => setTimeout(r, ms));
// What Label Studio does on a wave click: clamp to [0, duration], then set currentTime.
const lsSeek = (el, t) => { el.currentTime = Math.min(Math.max(t, 0), el.duration); };

await test('swapWhenPaused swaps a paused element and keeps time and speed', async () => {
  const el = new FakeMedia(true);
  assert.equal(swapWhenPaused(el, 'blob:local-1', 'k1'), true);
  assert.equal(el.src, 'blob:local-1');
  await tick(20);
  assert.equal(el.currentTime, 42.5);
  assert.equal(el.duration, 147.05);
  assert.equal(el.playbackRate, 1.5);
  assert.equal(el.muted, true);
  assert.equal(el.played, 0);
  assert.equal(el.dataset.soundOnlyLocal, 'k1');
  assert.equal(Object.hasOwn(el, 'duration') || Object.hasOwn(el, 'currentTime'), false);
});

await test('during the swap LS never sees NaN and a click is kept', async () => {
  const el = new FakeMedia(true);
  swapWhenPaused(el, 'blob:local-1', 'k1');
  assert.equal(el.duration, 147.05);   // real value is NaN right now
  assert.equal(el.currentTime, 42.5);  // real value is 0 right now
  assert.doesNotThrow(() => lsSeek(el, 99.25));
  assert.equal(el.currentTime, 99.25);
  await tick(20);
  assert.equal(el.currentTime, 99.25); // the click made during the swap is applied
});

await test('a failed local copy goes back to the server file, still guarded', async () => {
  const el = new FakeMedia(true);
  assert.equal(swapWhenPaused(el, 'blob:bad-1', 'k1'), true);
  await tick(8);                        // error fired, server file reloading
  assert.equal(el.src, 'https://server/file.mp4');
  assert.equal(el.duration, 147.05);
  assert.doesNotThrow(() => lsSeek(el, 10));
  await tick(20);
  assert.equal(el.currentTime, 10);
  assert.equal(el.dataset.soundOnlyLocal, undefined);
  assert.equal(Object.hasOwn(el, 'duration'), false);
  // no retry loop for the same file (the retry loop made the video flicker)
  assert.equal(swapWhenPaused(el, 'blob:bad-1', 'k1'), false);
  assert.equal(swapWhenPaused(el, 'blob:bad-2', 'k1'), false);
  assert.equal(el.src, 'https://server/file.mp4');
});

await test('swapWhenPaused waits until the length is known', () => {
  const el = new FakeMedia(true);
  el._dur = NaN;
  assert.equal(swapWhenPaused(el, 'blob:local-1', 'k1'), false);
  assert.equal(el.src, 'https://server/file.mp4');
});

await test('swapWhenPaused leaves a playing element alone', () => {
  const el = new FakeMedia(false);
  assert.equal(swapWhenPaused(el, 'blob:local-1', 'k1'), false);
  assert.equal(el.src, 'https://server/file.mp4');
  assert.equal(el.played, 0);
});

await test('swapWhenPaused is a no-op when already on that blob', () => {
  const el = new FakeMedia(true);
  swapWhenPaused(el, 'blob:local-1', 'k1');
  let sets = 0;
  const desc = Object.getOwnPropertyDescriptor(FakeMedia.prototype, 'src');
  Object.defineProperty(el, 'src', { get: desc.get, set(v) { sets++; desc.set.call(this, v); } });
  assert.equal(swapWhenPaused(el, 'blob:local-1', 'k1'), false);
  assert.equal(sets, 0);
});

console.log(`\n${n} tests passed`);
