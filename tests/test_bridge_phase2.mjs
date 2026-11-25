import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers';
import assert from 'node:assert/strict';
import { disableDevReload } from '../scripts/package.mjs';
const source = readFileSync('src/background.js', 'utf8');
const updateKey = 'soundOnly.update';
const update = { checkedAt: 1, latest: '0.33.0', url: 'https://github.com/NourZohdy/cinnamon-boost/releases/latest', newer: true };
const current = '0.32.0';
async function run({elapsed=0, interaction=false, before=null, dev=true, changeDuringRead=false}={}) {
  let resolveRead, listener, reloads=0, now=0; const events={}; const data=new Map(); if(before!==null)data.set('soundOnly.settings',before);
  const messages = [];
  const context = {
    performance: { now: () => now },
    localStorage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) },
    chrome: {
      runtime: { async sendMessage(msg) { messages.push(msg.type); }, getManifest: () => ({ version: current }) },
      storage: { local: { get: () => new Promise(r => resolveRead = r) }, onChanged: { addListener: fn => listener = fn } },
    },
    window: { addEventListener: (name, fn) => events[name] = fn, location: { reload: () => reloads++ } },
  };
  vm.runInNewContext(dev ? source : disableDevReload(source),context);
  assert.equal(Object.hasOwn(events, 'message'), dev);
  assert.deepEqual(messages, ['so-check-update']);
  const changed = { ...update, latest: '0.34.0' };
  if (changeDuringRead) listener({ [updateKey]: { newValue: changed } }, 'local');
  if(interaction) events.pointerdown(); now=elapsed;
  resolveRead({ 'soundOnly.settings': { sound: true }, [updateKey]: update });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(JSON.parse(data.get(updateKey)), { ...(changeDuringRead ? changed : update), current });
  listener({ [updateKey]: { newValue: changed } }, 'sync');
  assert.deepEqual(JSON.parse(data.get(updateKey)), { ...(changeDuringRead ? changed : update), current });
  listener({ [updateKey]: { newValue: changed } }, 'local');
  assert.deepEqual(JSON.parse(data.get(updateKey)), { ...changed, current });
  listener({ [updateKey]: {} }, 'local');
  assert.equal(data.has(updateKey), false);
  listener({'soundOnly.settings':{newValue:{sound:false}}},'local'); assert.equal(data.get('soundOnly.settings'),'{"sound":false}'); return reloads;
}
assert.equal(await run(),1);
assert.equal(await run({elapsed:3001}),0);
assert.equal(await run({interaction:true}),0);
assert.equal(await run({before:'{"sound":true}'}),0);
assert.equal(await run({dev:false}),1);
assert.equal(await run({ before: '{"sound":true}', changeDuringRead: true }), 0);
console.log('bridge timing, settings and update mirroring tests passed');

