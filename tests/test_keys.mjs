// Keyboard shortcuts. Run: node test_keys.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { segmentShortcut, submitDecision } = require('../content.js');
const { DEFAULTS } = require('../settings.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };
const k = (code, mods = {}) => ({ code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });

test('plain keys when not typing', () => {
  assert.equal(segmentShortcut(k('KeyY'), false), 'yes');
  assert.equal(segmentShortcut(k('KeyN'), false), 'no');
  assert.equal(segmentShortcut(k('ArrowRight'), false), 'submit');
  assert.equal(segmentShortcut(k('ArrowLeft'), false), 'prevTask');
  assert.equal(segmentShortcut(k('KeyQ'), false), null);
  assert.equal(segmentShortcut(k('ArrowUp'), false), null);
});

test('nothing while typing in a text box', () => {
  for (const code of ['KeyY', 'KeyN', 'ArrowRight', 'ArrowLeft']) assert.equal(segmentShortcut(k(code), true), null);
});

test('seek bindings use Alt only in the transcription box', () => {
  for (const [code, action] of [['Digit9', 'seekBack'], ['Digit0', 'seekForward']]) {
    assert.equal(segmentShortcut(k(code), false), action);
    assert.equal(segmentShortcut(k(code, { altKey: true }), false), null);
    assert.equal(segmentShortcut(k(code, { altKey: true }), true), null);
    assert.equal(segmentShortcut(k(code), true, DEFAULTS.keys, true), null);
    assert.equal(segmentShortcut(k(code, { altKey: true }), true, DEFAULTS.keys, true), action);
    for (const mod of ['ctrlKey', 'metaKey', 'shiftKey', 'isComposing']) {
      assert.equal(segmentShortcut(k(code, { altKey: true, [mod]: true }), true, DEFAULTS.keys, true), null);
    }
  }
  const keys = { ...DEFAULTS.keys, seekBack: 'Shift+KeyB' };
  assert.equal(segmentShortcut(k('KeyB', { altKey: true, shiftKey: true }), true, keys, true), 'seekBack');
  assert.equal(segmentShortcut(k('KeyY', { altKey: true }), true, keys, true), null);
});

test('no combinations', () => {
  for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
    assert.equal(segmentShortcut(k('KeyY', { [mod]: true }), false), null);
    assert.equal(segmentShortcut(k('ArrowRight', { [mod]: true }), false), null);
  }
});

test('custom bindings match exactly, including Shift', () => {
  const keys = { ...DEFAULTS.keys, yes: 'Shift+ArrowUp', no: '', submit: 'KeyS', play: 'Shift+Space' };
  const shortcut = (code, mods, typing = false) => segmentShortcut(k(code, mods), typing, keys);
  assert.equal(shortcut('KeyY'), null);
  assert.equal(shortcut('KeyN'), null);
  assert.equal(shortcut('ArrowUp'), null);
  assert.equal(shortcut('ArrowUp', { shiftKey: true }), 'yes');
  assert.equal(shortcut('ArrowUp', { shiftKey: true, ctrlKey: true }), null);
  assert.equal(shortcut('Space', { shiftKey: true }), 'play');
  assert.equal(shortcut('KeyS'), 'submit');
  assert.equal(shortcut('KeyS', { isComposing: true }), null);
  assert.equal(shortcut('KeyS', {}, true), null);
  assert.equal(shortcut('Tab', { shiftKey: true }), 'prevSegment');
});

test('Submit key chooses Submit, dirty Update, or Next', () => {
  assert.equal(submitDecision({ submit: true, update: true, dirty: true }), 'submit');
  assert.equal(submitDecision({ update: true, dirty: true }), 'update');
  assert.equal(submitDecision({ update: true, dirty: false }), 'next');
  assert.equal(submitDecision({ dirty: true }), 'next');
});

console.log(`${n} tests passed`);
