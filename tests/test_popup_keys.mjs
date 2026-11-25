import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const { window: w } = new JSDOM(read('src/popup/popup.html'), { runScripts: 'outside-only' });
const storageKey = 'soundOnly.settings';
const writes = [];
w.chrome = {
  runtime: { getManifest: () => JSON.parse(read('manifest.json')) },
  storage: { onChanged: { addListener() {} }, local: {
    async get() { return { [storageKey]: {} }; },
    async set(value) { writes.push(value[storageKey]); },
  } },
};
w.eval(read('src/shared/settings.js'));
w.eval(read('src/shared/update.js'));
w.eval(read('src/popup/popup.js'));
await setImmediate();

const modes = w.document.querySelector('#presets[role="radiogroup"][aria-label="Mode"]');
assert.ok(modes);
const cards = () => [...modes.querySelectorAll('button[role="radio"]')];
const checked = () => cards().map(card => card.getAttribute('aria-checked'));
assert.deepEqual(cards().map(card => card.querySelector('strong').textContent), ['Full', 'Loading fix only', 'Off']);
assert.deepEqual(cards().map(card => card.querySelector('.mode-tag')?.textContent), ['Recommended', undefined, undefined]);
assert.deepEqual(cards().map(card => card.tabIndex), [0, -1, -1]);
assert.deepEqual(checked(), ['true', 'false', 'false']);
for (const card of cards()) {
  assert.ok(w.document.getElementById(card.getAttribute('aria-describedby')).textContent);
}

const sections = () => [...w.document.querySelectorAll('#sections > details')];
assert.deepEqual(sections().map(section => [section.firstElementChild.textContent, section.open]), [
  ['Sound & loading', false], ['Layout', false], ['Waveform', false], ['Keyboard', false],
]);
const keyboard = sections().at(-1);
await new Promise(resolve => {
  keyboard.addEventListener('toggle', resolve, { once: true });
  keyboard.firstElementChild.click();
});

const button = action => w.document.getElementById(`key-${action}`);
assert.equal(button('seekBack').getAttribute('aria-label'), 'Back 1 s: 9');
assert.equal(button('seekForward').getAttribute('aria-label'), 'Forward 1 s: 0');
const press = (key, code = key, shiftKey = false) => button('yes').dispatchEvent(
  new w.KeyboardEvent('keydown', { key, code, shiftKey, bubbles: true, cancelable: true }),
);
button('yes').click();
press('Shift', 'ShiftLeft', true);
assert.equal(button('yes').textContent, 'Press a key…');
press('n', 'KeyN');
assert.match(button('yes').closest('.row').textContent, /Already used by Code-switching: No/);
assert.equal(writes.length, 0);
press('Escape');
assert.equal(button('yes').textContent, 'Y');
button('yes').click();
press('J', 'KeyJ', true);
await setImmediate();
assert.equal(writes.at(-1).keys.yes, 'Shift+KeyJ');
assert.equal(button('yes').textContent, 'Shift+J');
assert.notEqual(sections().at(-1), keyboard);
assert.deepEqual(sections().map(section => section.open), [false, false, false, true]);
button('yes').click();
press('Backspace');
await setImmediate();
assert.equal(button('yes').textContent, '—');
assert.equal(writes.at(-1).keys.yes, '');

function pressMode(key) {
  const event = new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  w.document.activeElement.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
}
cards()[0].focus();
pressMode('ArrowDown');
assert.deepEqual(checked(), ['false', 'true', 'false']);
assert.equal(w.document.activeElement, cards()[1]);
assert.deepEqual(cards().map(card => card.tabIndex), [-1, 0, -1]);
await setImmediate();
assert.equal(writes.at(-1).cache, true);
assert.equal(writes.at(-1).nextAfterSubmit, false);
pressMode('ArrowRight');
assert.equal(w.document.activeElement, cards()[2]);
assert.deepEqual(checked(), ['false', 'false', 'true']);
assert.equal(button('yes').disabled, true);
assert.equal(button('seekBack').disabled, true);
assert.equal(button('submit').disabled, true);
pressMode('ArrowDown');
assert.equal(w.document.activeElement, cards()[0]);
pressMode('ArrowLeft');
assert.equal(w.document.activeElement, cards()[2]);
cards()[0].click();
assert.equal(button('yes').textContent, '—');
assert.equal(button('submit').disabled, false);
const compact = w.document.querySelector('input[aria-describedby="d-compact"]');
compact.click();
assert.deepEqual(checked(), ['false', 'false', 'false']);
assert.equal(w.document.getElementById('custom').hidden, false);
assert.deepEqual(cards().map(card => card.tabIndex), [0, -1, -1]);
w.document.getElementById('reset').click();
await setImmediate();
assert.deepEqual(checked(), ['true', 'false', 'false']);
assert.equal(w.document.getElementById('custom').hidden, true);
assert.equal(button('yes').textContent, 'Y');
assert.equal(writes.at(-1).keys.yes, 'KeyY');
w.close();
console.log('popup sections, capture, conflict, unbind, presets and reset passed');
