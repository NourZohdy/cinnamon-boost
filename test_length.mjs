import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { lengthText } = createRequire(import.meta.url)('./content.js');

for (const [seconds, expected] of [[18.67, '18.7 s'], [0.04, '0.0 s'], [59.94, '59.9 s'], [65.2, '1:05.2'], [NaN, ''], [-1, '']]) {
  assert.equal(lengthText(seconds), expected);
  console.log('ok - lengthText', seconds);
}
