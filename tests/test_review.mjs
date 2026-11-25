// 0.26.5 review fixes. Run: node test_review.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { isMediaType, captureBlob, swapWhenPaused } = createRequire(import.meta.url)('../src/page/content.js');

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('ok -', name); };

await test('sign-in and error pages are not media', () => {
  for (const t of ['text/html; charset=utf-8', 'application/json', 'application/xhtml+xml', 'text/plain', '  TEXT/HTML ']) assert.equal(isMediaType(t), false, t);
  for (const t of ['video/mp4', 'audio/mpeg', 'application/octet-stream', 'video/mp4; name="json.xml.mp4"', '', null]) assert.equal(isMediaType(t), true, String(t));
});

await test('a 200 HTML page is never captured as the media file', () => {
  const buf = new Uint8Array([60, 104, 116]).buffer;
  assert.equal(captureBlob({ status: 200, responseType: 'arraybuffer', response: buf, getResponseHeader: () => 'text/html' }), null);
  const html = new Blob(['<html>'], { type: 'text/html' });
  assert.equal(captureBlob({ status: 200, responseType: 'blob', response: html, getResponseHeader: () => 'text/html' }), null);
  assert.equal(captureBlob({ status: 200, responseType: 'blob', response: html, getResponseHeader: () => null }), null);
});

class Media extends EventTarget {
  paused = true; dataset = {}; playbackRate = 1.5; _t = 42.5; _dur = 147; _src = 'https://server/a.mp4';
  get currentTime() { return this._t; }
  set currentTime(v) { this._t = v; }
  get duration() { return this._dur; }
  get src() { return this._src; }
  set src(v) { this._src = v; this._t = 0; this._dur = NaN; this.playbackRate = 1; }
  get currentSrc() { return this._src; }
}

await test('task A position is not put on task B when LS swaps the file mid-swap', () => {
  const el = new Media();
  assert.equal(swapWhenPaused(el, 'blob:a', 'ka'), true);
  el.src = 'https://server/b.mp4';             // Label Studio loads the next task into the same element
  el._dur = 90;
  el.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(Object.hasOwn(el, 'currentTime'), false, 'guard removed');
  assert.equal(Object.hasOwn(el, 'duration'), false, 'guard removed');
  assert.equal(el.currentTime, 0, 'B keeps its own position');
  assert.equal(el.dataset.soundOnlyLocal, undefined);
  assert.equal(el.dataset.soundOnlySwap, undefined);
});

await test('a late error from task B never restores task A\'s file', () => {
  const el = new Media();
  swapWhenPaused(el, 'blob:a', 'ka');
  el.src = 'https://server/b.mp4';
  el.dispatchEvent(new Event('error'));
  assert.equal(el.src, 'https://server/b.mp4');
  assert.equal(el.dataset.soundOnlyFailed, undefined);
  assert.equal(Object.hasOwn(el, 'currentTime'), false);
});

await test('stale blob metadata does not apply the previous task position after src changes', () => {
  const el = new Media();
  swapWhenPaused(el, 'blob:a', 'ka');
  Object.defineProperty(el, 'currentSrc', { value: 'blob:a' });
  el.src = 'https://server/b.mp4';
  el._dur = 90;
  el.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(el.currentTime, 0);
  assert.equal(el.playbackRate, 1);
  assert.equal(el.dataset.soundOnlyLocal, undefined);
  assert.equal(el.dataset.soundOnlySwap, undefined);
});

await test('after a fallback, a later error does not rewind the player', () => {
  const el = new Media();
  swapWhenPaused(el, 'blob:a', 'ka');
  el.dispatchEvent(new Event('error'));        // local copy failed -> back to the server file
  assert.equal(el.src, 'https://server/a.mp4');
  el._dur = 147;
  el.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(el.currentTime, 42.5);
  el.currentTime = 100;                        // user plays on
  el.dispatchEvent(new Event('error'));        // unrelated later error
  assert.equal(el.currentTime, 100);
});

console.log(`${n} tests passed`);
