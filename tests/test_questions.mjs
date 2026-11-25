// Compact layout, phase 2 helpers. Run: node test_questions.mjs (written by Claude)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { cardOf, noteReason } = createRequire(import.meta.url)('../content.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

// fake node: parentElement + getAttribute('style')
const el = (parent, style = '') => ({ parentElement: parent, getAttribute: k => (k === 'style' ? style : null) });

test('cardOf: the nearest bordered box around a header (live: gender/dialect/code headers sit inside one)', () => {
  const form = el(null);
  const box = el(form, 'border: 1px solid rgb(216, 216, 216); border-radius: 6px; padding: 8px;');
  const inner = el(box, 'display: flex;');
  const h3 = el(inner);
  assert.equal(cardOf(h3, form), box);
});

test('cardOf: border-top / border-radius alone do not count as a box border', () => {
  const form = el(null);
  const box = el(form, 'border: 1px solid #bbb; border-radius: 7px');
  const sep = el(box, 'border-top: 1px solid rgb(238, 238, 238); margin-top: 6px');   // the why-skip divider
  const h3 = el(sep);
  assert.equal(cardOf(h3, form), box);
});

test('cardOf: no bordered box -> the header parent; never the container itself or beyond', () => {
  const form = el(null, 'border: 2px solid red');
  const wrap = el(form, 'display: flex');
  const h3 = el(wrap);
  assert.equal(cardOf(h3, form), wrap);
  assert.equal(cardOf(el(form), form), null);          // header directly in the container: nothing to tag
  assert.equal(cardOf(null, form), null);
});

test('noteReason: why the transcription is missing, or nothing', () => {
  const base = { selected: true, videoSkipped: false, segSkipped: false, transVisible: true };
  assert.equal(noteReason(base), '');
  assert.equal(noteReason({ ...base, selected: false }), '');                       // no segment: no note
  assert.equal(noteReason({ ...base, transVisible: false, videoSkipped: true }), 'Video skipped: nothing to transcribe.');
  assert.equal(noteReason({ ...base, transVisible: false, segSkipped: true }), 'Segment skipped: no transcription needed.');
  assert.equal(noteReason({ ...base, transVisible: false }), 'Transcription is asked only when the dialect is Libya.');
  assert.equal(noteReason({ ...base, videoSkipped: true, transVisible: false, selected: false }), 'Video skipped: nothing to transcribe.');
});


test('sideNote: the right-column line for each left note', () => {
  const { sideNote } = createRequire(import.meta.url)('../content.js');
  assert.equal(sideNote(''), '');
  assert.equal(sideNote('Video skipped: nothing to transcribe.'), 'The wave, segments and questions are hidden while the whole video is skipped.');
  assert.equal(sideNote('Segment skipped: no transcription needed.'), 'Gender, dialect, transcription and code-switching are not asked for a skipped segment.');
  assert.equal(sideNote('Transcription is asked only when the dialect is Libya.'), 'Micro-dialect, transcription and code-switching are asked only when the dialect is Libya.');
});

test('clampSpeed: slider range 0.5-3 in 0.25 steps, bad input = 1', () => {
  const { clampSpeed } = createRequire(import.meta.url)('../content.js');
  assert.equal(clampSpeed(1.25), 1.25);
  assert.equal(clampSpeed(1.1), 1);
  assert.equal(clampSpeed(9), 3);
  assert.equal(clampSpeed(0.1), 0.5);
  assert.equal(clampSpeed(NaN), 1);
});

console.log(`${n} tests passed`);
