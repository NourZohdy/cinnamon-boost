import assert from 'node:assert/strict';
import { fakeLS } from './test-support/fake-ls.mjs';

const fixture = fakeLS({ mountedAtReady: true });
assert.deepEqual(fixture.errors, []);
assert.equal(fixture.d.querySelectorAll('.so-segs').length, 1);
fixture.dom.window.close();
console.log('Startup with a mounted editor: passed');
