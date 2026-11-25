import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const { window: w } = new JSDOM(read('popup.html'), { runScripts: 'outside-only' });
const storageKey = 'soundOnly.settings';
const writes = [];
w.chrome = {
  runtime: { getManifest: () => JSON.parse(read('manifest.json')) },
  storage: { onChanged: { addListener() {} }, local: {
    async get() { return { [storageKey]: {} }; },
    async set(value) { writes.push(value[storageKey]); },
  } },
};
w.eval(read('settings.js'));
w.eval(read('update.js'));
w.eval(read('popup.js'));
await setImmediate();

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

const preset = name => [...w.document.querySelectorAll('#presets button')].find(el => el.textContent === name);
preset('Off').click();
assert.equal(button('yes').disabled, true);
assert.equal(button('seekBack').disabled, true);
assert.equal(button('submit').disabled, true);
preset('Everything').click();
assert.equal(button('yes').textContent, '—');
assert.equal(button('submit').disabled, false);
w.document.getElementById('reset').click();
await setImmediate();
assert.equal(button('yes').textContent, 'Y');
assert.equal(writes.at(-1).keys.yes, 'KeyY');
w.close();
console.log('popup sections, capture, conflict, unbind, presets and reset passed');
