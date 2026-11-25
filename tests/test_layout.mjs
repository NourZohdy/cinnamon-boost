// Compact layout helpers. Run: node tests/test_layout.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { classifyHeader, flattenPath, isHotkey, readPref, writePref, fixedSlot } = createRequire(import.meta.url)('../src/page/content.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

test('classifyHeader maps the project headers, nothing else', () => {
  assert.equal(classifyHeader('Speaker Gender'), 'gender');
  assert.equal(classifyHeader('  Dialect Validation '), 'dialect');
  assert.equal(classifyHeader('Micro-dialect'), 'micro');
  assert.equal(classifyHeader('Could possibly also be'), 'alt');
  assert.equal(classifyHeader('Transcription (Arabic Script)'), 'trans');
  assert.equal(classifyHeader('Code-switching?'), 'code');
  assert.equal(classifyHeader('speaker gender'), 'gender');          // case-insensitive
  assert.equal(classifyHeader('Code-switch Language'), null);        // a sub-header inside the code card
  assert.equal(classifyHeader('Why skip this segment?'), null);
  assert.equal(classifyHeader(''), null);
  assert.equal(classifyHeader(undefined), null);
});

// tiny fake DOM: { parentElement, dataset, style: { display } }
const node = (parent, display = '', so) => ({ parentElement: parent, dataset: so ? { so } : {}, style: { display } });

test('flattenPath returns untagged visible wrappers between a node and its container', () => {
  const stop = node(null, '', 'form');
  const w1 = node(stop), w2 = node(w1), card = node(w2, '', 'gender');
  assert.deepEqual(flattenPath(card, stop), [w2, w1]);
});

test('flattenPath never returns a display:none wrapper or a tagged one', () => {
  const stop = node(null, '', 'form');
  const hidden = node(stop, 'none'), tagged = node(hidden, '', 'skip'), w = node(tagged), card = node(w, '', 'micro');
  assert.deepEqual(flattenPath(card, stop), [w]);
});

test('flattenPath is empty when the node sits right under the container, or outside it', () => {
  const stop = node(null, '', 'form');
  assert.deepEqual(flattenPath(node(stop, '', 'code'), stop), []);
  assert.deepEqual(flattenPath(node(node(null)), stop), []);       // never walks past the top
});

const key = (o = {}) => ({ code: 'KeyL', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, isComposing: false, target: { tagName: 'DIV', isContentEditable: false }, ...o });

test('isHotkey: only plain Alt+L, by physical key (Arabic layout too)', () => {
  assert.equal(isHotkey(key()), true);
  assert.equal(isHotkey(key({ code: 'KeyK' })), false);
  assert.equal(isHotkey(key({ altKey: false })), false);
  assert.equal(isHotkey(key({ ctrlKey: true })), false);
  assert.equal(isHotkey(key({ shiftKey: true })), false);
  assert.equal(isHotkey(key({ metaKey: true })), false);
  assert.equal(isHotkey(key({ repeat: true })), false);
  assert.equal(isHotkey(key({ isComposing: true })), false);
});

test('isHotkey ignores typing targets', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(isHotkey(key({ target: { tagName, isContentEditable: false } })), false);
  assert.equal(isHotkey(key({ target: { tagName: 'DIV', isContentEditable: true } })), false);
  assert.equal(isHotkey(key({ target: null })), true);
});

const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('prefs: allowed values round-trip, others fall back to the default', () => {
  const s = store();
  assert.equal(readPref(s, 'cinnamonBoost.layout', ['compact', 'original'], 'compact'), 'compact');
  writePref(s, 'cinnamonBoost.layout', 'original');
  assert.equal(readPref(s, 'cinnamonBoost.layout', ['compact', 'original'], 'compact'), 'original');
  s.setItem('cinnamonBoost.layout', 'weird');
  assert.equal(readPref(s, 'cinnamonBoost.layout', ['compact', 'original'], 'compact'), 'compact');
});

test('prefs: blocked storage never throws and keeps the choice for this page', () => {
  assert.doesNotThrow(() => writePref(broken, 'cinnamonBoost.tasks', 'hide'));
  assert.equal(readPref(broken, 'cinnamonBoost.tasks', ['show', 'hide'], 'show'), 'hide');   // in-memory fallback
  assert.equal(readPref(broken, 'cinnamonBoost.other', ['a', 'b'], 'a'), 'a');
  assert.equal(readPref(null, 'cinnamonBoost.x', ['a', 'b'], 'b'), 'b');
});

test('fixedSlot puts the bottom bar inside the top bar, right-aligned', () => {
  // live: .lsf-topbar at x 203, y 48, 1077 x 42 in a 1280 px window
  const top = { left: 203, top: 48, right: 1280, width: 1077, height: 42 };
  assert.deepEqual(fixedSlot(top, 1280, 8), { top: 48, right: 8, height: 42 });
  // scrollbar / narrower window: right edge of the top bar is not the window edge
  assert.deepEqual(fixedSlot({ ...top, right: 1260 }, 1280, 8), { top: 48, right: 28, height: 42 });
  assert.equal(fixedSlot(null, 1280, 8), null);
  assert.equal(fixedSlot({ ...top, height: 0 }, 1280, 8), null);   // top bar not laid out yet
});

console.log(`${n} tests passed`);
