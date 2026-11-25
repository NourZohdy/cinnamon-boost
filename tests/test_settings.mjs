import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DEFAULTS, PRESETS, normalizeSettings, migrateSettings, matchPreset, applyPreset } = require('../src/shared/settings.js');

assert.deepEqual(normalizeSettings(null), DEFAULTS);
assert.deepEqual(normalizeSettings({ sound: false, cache: 0, preload: 9, unknown: true }), { ...DEFAULTS, sound: false, preload: 3 });
assert.equal(normalizeSettings({ preload: -1 }).preload, 0);
assert.equal(normalizeSettings({ preload: 1.5 }).preload, 3);
assert.deepEqual(migrateSettings(null, 'off'), { ...PRESETS.off, keys: DEFAULTS.keys });
const phase2Off = { ...PRESETS.off };
delete phase2Off.nextAfterSubmit;
assert.deepEqual(migrateSettings(phase2Off), { ...PRESETS.off, keys: DEFAULTS.keys });
assert.deepEqual(migrateSettings(null, 'sound'), { ...DEFAULTS, compact: false, pager: false });
assert.deepEqual(migrateSettings(null, 'full'), DEFAULTS);
assert.deepEqual(migrateSettings(null, 'invalid'), DEFAULTS);
assert.equal(migrateSettings({ sound: false }, 'off').cache, true);
for (const [name, settings] of Object.entries(PRESETS)) assert.equal(matchPreset(settings), name);
assert.equal(matchPreset({ ...DEFAULTS, sound: false }), 'custom');
assert.deepEqual(normalizeSettings({ sound: false }).keys, DEFAULTS.keys);
assert.deepEqual(normalizeSettings({ keys: { play: 'Shift+KeyP', yes: 'Shift+KeyP', no: null,
  nextSegment: '', prevSegment: 'Ctrl+Tab', prevTask: 'Nonsense', submit: 'Enter', other: 'KeyQ' } }).keys,
{ ...DEFAULTS.keys, play: 'Shift+KeyP', yes: '', nextSegment: '' });
assert.equal(normalizeSettings({ keys: { play: 'KeyY' } }).keys.yes, '');
assert.deepEqual(migrateSettings({ keys: { play: 'KeyP' } }).keys, { ...DEFAULTS.keys, play: 'KeyP', seekBack: 'Digit9', seekForward: 'Digit0' });
assert.deepEqual(migrateSettings({ keys: { play: 'Digit9' } }).keys, { ...DEFAULTS.keys, play: 'Digit9', seekBack: '', seekForward: 'Digit0' });
assert.deepEqual(migrateSettings({ keys: { submit: 'Digit0' } }).keys, { ...DEFAULTS.keys, submit: 'Digit0', seekBack: 'Digit9', seekForward: '' });
const customKeys = { ...DEFAULTS.keys, play: 'Shift+KeyP', submit: '' };
for (const [id, preset] of Object.entries(PRESETS)) {
  assert.equal(Object.hasOwn(preset, 'keys'), false);
  assert.equal(preset.nextAfterSubmit, id !== 'off');
  const applied = applyPreset({ ...DEFAULTS, keys: customKeys }, id);
  assert.deepEqual(applied.keys, customKeys);
  assert.equal(matchPreset(applied), id);
}
console.log('settings tests passed');
