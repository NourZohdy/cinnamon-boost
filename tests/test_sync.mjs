// Phase 1 tests for src/page/content.js sync helpers. Run: node tests/test_sync.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { untie, retie, checkShape } = require('../src/page/content.js');

// Fake of Label Studio's shared syncManager.
class FakeSM {
  constructor(targets) {
    this.syncTargets = new Map(targets.map(t => [t.name, t]));
    this.locked = null;
    this.audioTags = targets.filter(t => t.type === 'audio').length;
    this.bufferingOrigins = new Set();
  }
  isLockable(event) { return event !== 'buffering'; }
  sync(data, event, origin) {
    if (event === 'buffering') data.buffering ? this.bufferingOrigins.add(origin) : this.bufferingOrigins.delete(origin);
    if (this.isLockable(event)) {
      if (this.locked && this.locked !== origin) return false;
      this.locked = origin; // real LS clears it after 100 ms; tests reset it by hand
    }
    for (const t of this.syncTargets.values()) if (origin !== t.name) t.syncReceive(data, event);
    return true;
  }
}
const tag = (name, type) => ({ name, type, got: [], syncReceive(d, e) { this.got.push(e); } });
const make = () => {
  const video = tag('video', 'video'), audio = tag('audio', 'audio');
  return { sm: new FakeSM([video, audio]), video, audio };
};

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

test('untie removes video, keeps audio, stores state', () => {
  const { sm } = make();
  const s = untie(sm, 'audio');
  assert.ok(s);
  assert.deepEqual([...sm.syncTargets.keys()], ['audio']);
  assert.equal(sm.__cinnamonBoost, s);
  assert.equal(sm.sync.__cinnamonBoost, true);
  assert.equal(s.active, true);
});

test('audio-origin events no longer reach video; receiver and return value kept', () => {
  const { sm, video } = make();
  untie(sm, 'audio');
  assert.equal(sm.sync({}, 'seek', 'audio'), true);
  assert.deepEqual(video.got, []);
});

test('video-origin events are blocked: no delivery, no buffering origin, no lock', () => {
  const { sm, audio } = make();
  untie(sm, 'audio');
  for (const ev of ['play', 'pause', 'seek']) assert.equal(sm.sync({}, ev, 'video'), false);
  assert.equal(sm.sync({ buffering: true }, 'buffering', 'video'), false);
  assert.deepEqual(audio.got, []);
  assert.equal(sm.bufferingOrigins.has('video'), false);
  assert.notEqual(sm.locked, 'video');
});

test('untie clears only the video buffering origin and lock', () => {
  const { sm } = make();
  sm.bufferingOrigins.add('video'); sm.bufferingOrigins.add('audio'); sm.locked = 'video';
  const s = untie(sm, 'audio');
  assert.equal(s.wasBuffering, true);
  assert.deepEqual([...sm.bufferingOrigins], ['audio']);
  assert.equal(sm.locked, null);

  const b = make(); b.sm.locked = 'audio';
  const s2 = untie(b.sm, 'audio');
  assert.equal(s2.wasBuffering, false);
  assert.equal(b.sm.locked, 'audio');
});

test('double untie returns the same state', () => {
  const { sm } = make();
  const a = untie(sm, 'audio');
  assert.equal(untie(sm, 'audio'), a);
  assert.deepEqual([...sm.syncTargets.keys()], ['audio']);
});

test('invalid shape returns null and changes nothing', () => {
  const { sm } = make();
  assert.equal(untie(sm, 'nope'), null);
  assert.deepEqual([...sm.syncTargets.keys()], ['video', 'audio']);
  assert.equal(Object.hasOwn(sm, 'sync'), false);
  assert.equal(untie({ syncTargets: {}, bufferingOrigins: new Set(), sync() {} }, 'audio'), null);
  assert.equal(untie(null, 'audio'), null);
});

test('retie restores exact order, removes wrapper, events flow both ways', () => {
  const { sm, video, audio } = make();
  const s = untie(sm, 'audio');
  retie(sm, s);
  assert.deepEqual([...sm.syncTargets.keys()], ['video', 'audio']);
  assert.equal(Object.hasOwn(sm, 'sync'), false);
  assert.equal('__cinnamonBoost' in sm, false);
  assert.equal(s.active, false);
  sm.sync({}, 'seek', 'audio'); sm.locked = null;
  sm.sync({}, 'pause', 'video');
  assert.deepEqual(video.got, ['seek']);
  assert.deepEqual(audio.got, ['pause']);
});

test('retie keeps a target LS added while untied', () => {
  const { sm } = make();
  const s = untie(sm, 'audio');
  sm.syncTargets.set('paragraphs', tag('paragraphs', 'paragraphs'));
  retie(sm, s);
  assert.deepEqual([...sm.syncTargets.keys()], ['video', 'audio', 'paragraphs']);
});

test('foreign wrapper delegating to ours is kept but ours becomes passthrough', () => {
  const { sm, audio } = make();
  const s = untie(sm, 'audio');
  const ours = sm.sync;
  const foreign = function (...a) { return ours.apply(this, a); };
  sm.sync = foreign;
  retie(sm, s);
  assert.equal(sm.sync, foreign);
  assert.equal(sm.sync({}, 'pause', 'video'), true);
  assert.deepEqual(audio.got, ['pause']);
});

test('a pre-existing own sync is used while untied and restored after', () => {
  const { sm } = make();
  const calls = [];
  const prev = function (d, e, o) { calls.push(e); return FakeSM.prototype.sync.call(this, d, e, o); };
  sm.sync = prev;
  const s = untie(sm, 'audio');
  sm.sync({}, 'seek', 'audio');
  assert.deepEqual(calls, ['seek']);
  retie(sm, s);
  assert.equal(sm.sync, prev);
});

test('retie with nothing saved or a stale state is a no-op', () => {
  const { sm } = make();
  retie(sm, null);
  assert.deepEqual([...sm.syncTargets.keys()], ['video', 'audio']);
  const s = untie(sm, 'audio');
  retie(sm, { order: ['video', 'audio'], removed: new Map(), active: true });
  assert.deepEqual([...sm.syncTargets.keys()], ['audio']);
  assert.equal(sm.__cinnamonBoost, s);
});

test('checkShape accepts exactly the audio+video pair', () => {
  const { sm } = make();
  assert.equal(checkShape(sm, 'audio', 'video'), true);
  sm.syncTargets.set('extra', tag('extra', 'audio'));
  assert.equal(checkShape(sm, 'audio', 'video'), false);
  assert.equal(checkShape(make().sm, 'audio', 'missing'), false);
  assert.equal(checkShape({ syncTargets: new Map(), bufferingOrigins: [], sync() {} }, 'audio', 'video'), false);
  assert.equal(checkShape(undefined, 'audio', 'video'), false);
});

console.log(`\n${n} tests passed`);
