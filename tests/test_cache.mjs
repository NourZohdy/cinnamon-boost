// Phase: cache + preload helpers. Run: node test_cache.mjs (written by Claude)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeLS } from './test-support/fake-ls.mjs';
const { cacheRequestUrl, keysToEvict, pickNextTask, mediaKey, reusePreloadedWaveform, preferLocalMedia } = createRequire(import.meta.url)('../src/page/content.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };
const O = 'https://annotation.dlnlp.ai';

test('cache URL is same-origin and round-trips the key', () => {
  const key = mediaKey('/cinnamon/data/local-files/?d=videos%2Fa%20b.mp4&lsref=x', O + '/cinnamon/projects/19/data');
  const u = new URL(cacheRequestUrl(key, O));
  assert.equal(u.origin, O);
  assert.equal(u.searchParams.get('k'), key);
});

test('evict the oldest beyond the limit', () => {
  assert.deepEqual(keysToEvict(['a', 'b', 'c'], 6), []);
  assert.deepEqual(keysToEvict(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 6), ['a', 'b']);
  assert.deepEqual(keysToEvict([], 6), []);
});

test('next task is the one after the current in the list', () => {
  const tasks = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.equal(pickNextTask(tasks, 1).id, 2);
  assert.equal(pickNextTask(tasks, 3), null);   // last on this page: fetch more
  assert.equal(pickNextTask(tasks, 9), null);   // not found yet
  assert.equal(pickNextTask([], 1), null);
});

class WaveformRequest extends EventTarget {
  responseType = 'arraybuffer';
  sends = [];
  source = 'remote';
  send() { this.sends.push([this.source, this.responseType]); }
  abort() { this.aborted = true; }
  setRequestHeader() {}
  overrideMimeType() {}
}

// Node lacks the XHR progress event class.
globalThis.ProgressEvent ??= Event;

function waveformHandoff() {
  const xhr = new WaveformRequest();
  const controller = new AbortController();
  const { promise: result, resolve } = Promise.withResolvers();
  const restore = reusePreloadedWaveform(xhr, { result, controller }, blob => {
    xhr.source = blob;
    xhr.responseType = ''; // Native open can reset request properties.
  });
  return { xhr, controller, result, resolve, restore };
}

{
  const { xhr, resolve, result } = waveformHandoff();
  const blob = new Blob(['media']);
  xhr.setRequestHeader('Accept', '*/*');
  xhr.send(null);
  assert.deepEqual(xhr.sends, []);
  resolve(blob);
  await result;
  test('opening the next task shares its in-progress download', () => {
    assert.deepEqual(xhr.sends, [[blob, 'arraybuffer']]);
    assert.equal(Object.hasOwn(xhr, 'send'), false);
  });
}

{
  const { xhr, resolve, result } = waveformHandoff();
  xhr.send();
  resolve(null);
  await result;
  test('a failed preload falls back to the original waveform request', () => {
    assert.deepEqual(xhr.sends, [['remote', 'arraybuffer']]);
  });
}

{
  const { xhr, controller, resolve, result } = waveformHandoff();
  let aborted = false;
  xhr.addEventListener('abort', () => { aborted = true; });
  xhr.send();
  controller.abort();
  resolve(null);
  await result;
  test('leaving for an unrelated task cancels the old request without a new download', () => {
    assert.ok(xhr.aborted && aborted);
    assert.deepEqual(xhr.sends, []);
  });
}

{
  const { xhr, resolve, result, restore } = waveformHandoff();
  xhr.send();
  restore();
  xhr.source = 'different request';
  xhr.send();
  resolve(new Blob(['previous task']));
  await result;
  test('a reopened XHR is left alone when the old preload finishes', () => {
    assert.deepEqual(xhr.sends, [['different request', 'arraybuffer']]);
  });
}

test('a partial waveform request keeps its native network behavior', () => {
  const { xhr } = waveformHandoff();
  xhr.setRequestHeader('Range', 'bytes=0-9');
  xhr.send();
  assert.deepEqual(xhr.sends, [['remote', 'arraybuffer']]);
});

const serverSrc = O + '/cinnamon/data/local-files/?d=videos%2Fcached.mp4&lsref=test';
const cachedSrc = 'blob:local-copy';
const playerKey = mediaKey(serverSrc, O);

class StartingPlayer extends EventTarget {
  dataset = {};
  currentSrc = '';
  readyState = 0;
  paused = true;
  duration = NaN;
  #src = serverSrc;
  playbackRate = 1.5;
  currentTime = 12;
  get src() { return this.#src; }
  set src(src) {
    this.#src = src;
    this.playbackRate = 1;
    this.currentTime = 0;
  }
}

test('a cached task uses the local player source before server metadata arrives', () => {
  const player = new StartingPlayer();
  assert.equal(preferLocalMedia(player, cachedSrc, playerKey, O), true);
  assert.equal(player.src, cachedSrc);
  assert.equal(player.currentTime, 12);
  assert.equal(player.playbackRate, 1.5);
  assert.equal(preferLocalMedia(player, cachedSrc, playerKey, O), false);
});

test('unreadable cached media falls back to the original URL once', () => {
  const player = new StartingPlayer();
  preferLocalMedia(player, cachedSrc, playerKey, O);
  player.dispatchEvent(new Event('error'));
  assert.equal(player.src, serverSrc);
  assert.equal(player.currentTime, 12);
  assert.equal(player.playbackRate, 1.5);
  assert.equal(preferLocalMedia(player, cachedSrc, playerKey, O), false);
});

test('cached routing leaves other tasks, stale metadata, and active playback alone', () => {
  const player = new StartingPlayer();
  assert.equal(preferLocalMedia(player, cachedSrc, playerKey + '-other', O), false);
  player.readyState = 1;
  player.currentSrc = O + '/cinnamon/data/local-files/?d=previous.mp4';
  assert.equal(preferLocalMedia(player, cachedSrc, playerKey, O), false);
  player.currentSrc = serverSrc;
  player.paused = false;
  assert.equal(preferLocalMedia(player, cachedSrc, playerKey, O), false);
  assert.equal(player.src, serverSrc);
});

test('a stale cache error cannot replace the newly selected task source', () => {
  const player = new StartingPlayer();
  const next = O + '/cinnamon/data/local-files/?d=next.mp4';
  preferLocalMedia(player, cachedSrc, playerKey, O);
  player.src = next;
  player.dispatchEvent(new Event('error'));
  assert.equal(player.src, next);
  assert.equal(player.dataset.soundOnlyFailed, undefined);
});

{
  const blob = new Blob(['media'], { type: 'video/mp4' });
  const requests = [], nextSrc = serverSrc.replace('cached.mp4', 'next.mp4');
  const nativeMedia = (url, options) => { requests.push([url, options]); return new Response(blob); };
  const f = fakeLS({ url: O + '/cinnamon/projects/19/data', settings: { pager: false, preload: 1 },
    cacheEntries: [[cacheRequestUrl(playerKey, O), new Response(blob)]],
    initialRoutes: [
      ['/cinnamon/api/current-user/whoami', () => Response.json({ id: 7 })],
      ['/cinnamon/api/tasks?page=1&page_size=100&project=19', () => Response.json({ tasks: [
        { id: 2 }, { id: 3, data: { video: nextSrc } },
      ] })],
      [serverSrc, nativeMedia],
      [nextSrc, nativeMedia],
    ],
    onEarly(w) {
      w.Blob = Blob;
      w.Response = Response;
      w.Request = Request;
    },
  });
  const { w } = f;
  await w.LSSoundOnly.ctx.cache.ready;
  const options = { headers: { Range: 'bytes=0-0' } };
  const probe = await w.fetch(serverSrc, options);
  assert.equal(probe.status, 206);
  assert.equal(await probe.text(), 'm');
  assert.equal(probe.headers.get('Content-Range'), 'bytes 0-0/5');
  assert.equal(probe.headers.get('Content-Length'), '1');
  assert.equal(probe.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(probe.headers.get('Content-Type'), 'video/mp4');
  assert.equal(await (await w.fetch(new Request(serverSrc, { headers: { Range: 'bytes=2-' } }))).text(), 'dia');
  const full = await w.fetch(serverSrc);
  assert.equal(full.status, 200);
  assert.equal(await full.text(), 'media');
  await w.fetch(nextSrc, options);
  assert.deepEqual(requests, [[nextSrc, options]]);
  const multi = { headers: { Range: 'bytes=0-0,2-2' } };
  const post = new Request(serverSrc, { method: 'POST', body: 'data' });
  await w.fetch(serverSrc, multi);
  await w.fetch(post);
  assert.deepEqual(requests.splice(0), [[nextSrc, options], [serverSrc, multi], [post, undefined]]);
  w.Htx.task.dataObj.video = serverSrc;
  f.advance(500);
  await f.flush();
  assert.equal(requests.length, 1);
  assert.equal(String(requests[0][0]), nextSrc);
  assert.equal(requests[0][1].signal.aborted, false);
  await w.LSSoundOnly.ctx.preload.transferFor(mediaKey(nextSrc, O))?.result;
  assert.ok(w.LSSoundOnly.ctx.cache.has(mediaKey(nextSrc, O)), 'uncached preload downloads from the network');
  const preloadedProbe = await w.fetch(nextSrc, options);
  assert.equal(preloadedProbe.status, 206);
  assert.equal(await preloadedProbe.text(), 'm');
  assert.equal(requests.length, 1);
  assert.deepEqual(f.network, []);
  w.close();
  console.log('ok - cached fetch serves media probes and leaves uncached preload on the network');
  n++;
}

console.log(`\n${n} tests passed`);
