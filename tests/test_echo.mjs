// Seek-echo filter. Run: node test_echo.mjs (written by Claude)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { isEchoSeek, installSeekFilter, untie, retie, skipTinySeeks } = createRequire(import.meta.url)('../content.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

class FakeSM {
  constructor(targets) { this.syncTargets = new Map(targets.map(t => [t.name, t])); this.locked = null; this.bufferingOrigins = new Set(); }
  sync(data, event, origin) { for (const t of this.syncTargets.values()) if (t.name !== origin) t.syncReceive(data, event); return true; }
}
const tag = (name, type, time) => ({ name, type, time, got: [], syncReceive(d, e) { this.got.push([e, d.time]); } });
const timeOf = t => t.time;

test('the echoes seen live are dropped, real jumps pass', () => {
  const audio = tag('audio', 'audio', 57.7478), video = tag('video', 'video', 57.748);
  const T = [audio, video];
  // what LS sent at a loop restart (see journal): 1 real, 3 echoes
  assert.equal(isEchoSeek('seek', { time: 57.7478 }, 'audio', T, timeOf), true);   // video already there after it seeked itself
  video.time = 59.9;                                                                // ...but before that, video was far away:
  assert.equal(isEchoSeek('seek', { time: 57.7478 }, 'audio', T, timeOf), false);  // the real jump goes through
  video.time = 57.748; audio.time = 57.7478;
  assert.equal(isEchoSeek('seek', { time: 57.748 }, 'video', T, timeOf), true);    // echo 0.2 ms
  audio.time = 57.75;
  assert.equal(isEchoSeek('seek', { time: 57.756 }, 'video', T, timeOf), true);    // frame snap 6 ms
});

test('only seek events with a time are considered', () => {
  const T = [tag('audio', 'audio', 10), tag('video', 'video', 10)];
  assert.equal(isEchoSeek('play', { time: 10 }, 'audio', T, timeOf), false);
  assert.equal(isEchoSeek('seek', {}, 'audio', T, timeOf), false);
  assert.equal(isEchoSeek('seek', { time: 10 }, 'audio', [T[0]], timeOf), false);  // nobody else to sync
  assert.equal(isEchoSeek('seek', { time: 10.1 }, 'audio', T, timeOf), false);     // 100 ms is a real move
});

test('the filter blocks echoes, forwards the rest, and survives Sound only on/off', () => {
  const audio = tag('audio', 'audio', 57.75), video = tag('video', 'video', 57.75);
  const sm = new FakeSM([video, audio]);
  assert.equal(installSeekFilter(sm, timeOf), true);
  assert.equal(installSeekFilter(sm, timeOf), false);                               // once
  assert.equal(sm.sync({ time: 57.756 }, 'seek', 'video'), false);
  assert.deepEqual(audio.got, []);
  sm.sync({ time: 56.75 }, 'seek', 'video');
  assert.deepEqual(audio.got, [['seek', 56.75]]);
  sm.sync({}, 'play', 'video');
  assert.deepEqual(audio.got.map(g => g[0]), ['seek', 'play']);
  const filter = sm.sync;
  const s = untie(sm, 'audio');
  retie(sm, s);
  assert.equal(sm.sync, filter);                                                    // Sound only keeps the filter
  assert.equal(sm.sync({ time: 57.751 }, 'seek', 'video'), false);
});

// Fake media element: every currentTime set counts as one (expensive) seek.
class FakeMedia {
  constructor() { this._t = 0; this.seeks = 0; }
  get currentTime() { return this._t; }
  set currentTime(v) { this.seeks++; this._t = v; }
}

test('a repeated set to the same spot is skipped, real moves are not', () => {
  const el = new FakeMedia();
  assert.equal(skipTinySeeks(el), true);
  assert.equal(skipTinySeeks(el), false);                // once
  el.currentTime = 57.748;                               // LS loop restart: real jump
  el.currentTime = 57.748;                               // LS again when playback starts
  el.currentTime = 57.753;                               // ...5 ms later: still the same spot
  assert.equal(el.seeks, 1);
  el.currentTime = 57.9;                                 // 150 ms: a real move
  el.currentTime = 56.9;                                 // a one-second keyboard step
  assert.equal(el.seeks, 3);
  assert.equal(el.currentTime, 56.9);
  el.currentTime = NaN;                                  // passes through untouched (the browser decides)
  assert.equal(el.seeks, 4);
});

test('the skip filter steps aside while a swap guard owns currentTime', () => {
  const el = new FakeMedia();
  Object.defineProperty(el, 'currentTime', { configurable: true, get: () => 5, set: () => {} });
  assert.equal(skipTinySeeks(el), false);                // try again after the guard is removed
  delete el.currentTime;
  assert.equal(skipTinySeeks(el), true);
});

console.log(`\n${n} tests passed`);
