import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { pagerAnnotation } = createRequire(import.meta.url)('../src/page/content.js');

const result = [
  { id: 'a', from_name: 'speaker_segments' },
  { id: 'a', from_name: 'speaker_segments' },
  { id: 'b', from_name: 'speaker_segments' },
  { id: 'c', from_name: 'speaker_segments' },
  { id: 'a', from_name: 'segment_transcription', value: { text: ['نص'] } },
  { id: 'b', from_name: 'segment_skip_toggle', value: { choices: ['Skip this segment'] } },
  { id: 'c', from_name: 'segment_transcription', value: { text: ['  '] } },
  { id: 'other', from_name: 'segment_transcription', value: { text: ['Unrelated'] } },
];

assert.deepEqual(pagerAnnotation({ annotations: [{ result }], drafts: [] }), {
  state: 'submitted', counts: { processed: 2, total: 3 }, submitted: true,
});
assert.deepEqual(pagerAnnotation({ annotations: [{ result }], drafts: [{ result: result.slice(0, 1) }] }), {
  state: 'draft', counts: { processed: 0, total: 1 }, submitted: true,
});
assert.deepEqual(pagerAnnotation({ annotations: [], drafts: [], predictions: [{ result }] }), {
  state: 'todo', counts: { processed: 0, total: 0 }, submitted: false,
});
assert.deepEqual(pagerAnnotation({ annotations: [{ was_cancelled: true, result }], total_annotations: 1 }), {
  state: 'skipped', counts: { processed: 0, total: 0 }, submitted: false,
});
assert.deepEqual(pagerAnnotation({ annotations: [], total_annotations: 1, draft_exists: false }), {
  state: 'submitted', counts: null, submitted: true,
});
assert.deepEqual(pagerAnnotation({ annotations: [{ result }], draft_exists: true }), {
  state: 'draft', counts: null, submitted: true,
});
assert.deepEqual(pagerAnnotation({ total_annotations: 0 }), {
  state: 'unknown', counts: null, submitted: false,
});

console.log('7 pager status tests passed');
