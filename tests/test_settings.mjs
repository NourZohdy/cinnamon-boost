import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DEFAULTS, PRESETS, normalizeSettings, migrateSettings, matchPreset, applyPreset } = require('../src/shared/settings.js');

assert.deepEqual(PRESETS, {
  full: {
    sound: true, cache: true, compact: true, pager: true, preview: true, gestures: true,
    segmentKeys: true, taskKeys: true, nextAfterSubmit: true, preload: 3,
  },
  loading: {
    sound: true, cache: true, compact: false, pager: false, preview: false, gestures: false,
    segmentKeys: false, taskKeys: false, nextAfterSubmit: false, preload: 3,
  },
  off: {
    sound: false, cache: false, compact: false, pager: false, preview: false, gestures: false,
    segmentKeys: false, taskKeys: false, nextAfterSubmit: false, preload: 0,
  },
});
assert.deepEqual(DEFAULTS, { ...PRESETS.full, keys: DEFAULTS.keys });
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
for (const previous of [
  { ...PRESETS.loading, nextAfterSubmit: true },
  { ...PRESETS.off, compact: true, pager: true, preview: true, gestures: true, nextAfterSubmit: true },
]) {
  const stored = { ...previous, keys: DEFAULTS.keys };
  assert.deepEqual(migrateSettings(stored), stored);
  assert.equal(matchPreset(stored), 'custom');
}
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
  const applied = applyPreset({ ...DEFAULTS, keys: customKeys }, id);
  assert.deepEqual(applied, { ...preset, keys: customKeys });
  assert.equal(matchPreset(applied), id);
}
console.log('settings tests passed');
