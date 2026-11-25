/* global require */
(() => {
const { DEFAULTS, eventBinding } = typeof module !== 'undefined' && module.exports
  ? require('./settings.js') : window.LSSoundOnly.settings;
function segmentShortcut(e, typing, keys = DEFAULTS.keys, inTranscription = false) {
  if (typing && !inTranscription) return null;
  const binding = eventBinding(e, typing);
  if (!binding) return null;
  const actions = typing ? ['seekBack', 'seekForward'] : Object.keys(keys);
  return actions.find(action => keys[action] === binding) || null;
}

function submitDecision({ submit, update, dirty }) {
  if (submit) return 'submit';
  if (update && dirty) return 'update';
  return 'next';
}

function mediaKey(url, base) {
  try {
    const parsed = new URL(url, base);
    if (!parsed.pathname.includes('/data/local-files/') || !parsed.searchParams.has('d')) return null;
    return `${parsed.origin}${parsed.pathname}?d=${encodeURIComponent(parsed.searchParams.get('d'))}`;
  } catch (_) {
    return null;
  }
}

// --- gentle zoom + overview ---
// LS zooms by zoom*(1 - 0.1*deltaY): one mouse-wheel notch (deltaY ~100) slams to the limit.
// We use ~15% per notch instead; trackpad pinches (small deltas) stay smooth.
function zoomFactor(deltaY, deltaMode = 0) {
  const px = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.min(1.25, Math.max(0.8, Math.exp(-px * 0.0015)));
}

// LS view: scrollLeft = fraction of the file at the left edge (max 1 - 1/zoom); visible = duration/zoom.
// New zoom and scrollLeft that keep the time under the mouse (frac 0..1 across the wave) in place.
function zoomAt(zoom, scrollLeft, factor, frac, maxZoom) {
  const z2 = Math.min(maxZoom, Math.max(1, zoom * factor));
  const t = scrollLeft + frac / zoom;                 // as a fraction of the file
  const s2 = Math.min(1 - 1 / z2, Math.max(0, t - frac / z2));
  return { zoom: z2, scrollLeft: s2 };
}

// Page turn for a zoomed wave: scrollLeft (fraction of the file) that puts time t just after the left edge.
// lead = share of the view kept before t, so the playhead is not glued to the edge.
function pageAt(t, duration, zoom, lead = 0.02) {
  if (!(duration > 0) || !(zoom > 1)) return 0;
  return Math.min(1 - 1 / zoom, Math.max(0, t / duration - lead / zoom));
}

// Min/max per column, for drawing the whole file in a small strip.
function peaks(data, columns) {
  const min = new Float32Array(columns), max = new Float32Array(columns);
  const per = data.length / columns;
  for (let c = 0; c < columns; c++) {
    let lo = 0, hi = 0;
    const end = Math.min(data.length, Math.floor((c + 1) * per));
    const stepSize = Math.max(1, Math.floor((end - Math.floor(c * per)) / 2000)); // ponytail: sampled, not every sample; exact enough for a 40 px strip
    for (let i = Math.floor(c * per); i < end; i += stepSize) {
      const v = data[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[c] = lo; max[c] = hi;
  }
  return { min, max };
}

const svg = d =>`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  loop: svg('<path d="M3 7.5V7a3 3 0 0 1 3-3h6.5M10.5 2l2 2-2 2"/><path d="M13 8.5V9a3 3 0 0 1-3 3H3.5M5.5 14l-2-2 2-2"/>'),
  flash: svg('<path d="M9 2 3.5 9H7l-0.5 5L12.5 7H9z"/>')
};

const PAGER_CACHE_ICONS = {
  ready: svg('<path d="M3 9v3h10V9M5.5 6.5l1.7 1.8L11 4.5"/>'),
  idle: svg('<path d="M5 11.5H4a2.3 2.3 0 0 1-.2-4.6 3.5 3.5 0 0 1 6.8-.8 2.7 2.7 0 0 1 1.3 5.1h-.7M8 8v5m-2-2 2 2 2-2"/>'),
  loading: svg('<path d="M8 2.5v7m-3-3 3 3 3-3M3 10v3h10v-3"/>'),
  error: svg('<circle cx="8" cy="8" r="5.5"/><path d="m6 6 4 4m0-4-4 4"/>'),
};

const CACHE_NAME = 'sound-only-v1';
const CACHE_MAX_FILES = 6;  // ponytail: count limit, not bytes; ~6 x 80 MB here. Switch to a byte budget if files get big.

function cacheRequestUrl(key, origin) {
  return `${origin}/__sound-only-cache__/?k=${encodeURIComponent(key)}`;
}

// Cache keys come back oldest first; drop the oldest beyond max.
function keysToEvict(urls, max) {
  return urls.slice(0, Math.max(0, urls.length - max));
}

// The task after currentId in the user's list, or null (not found yet / last one).
function pickNextTask(tasks, currentId) {
  const i = tasks.findIndex(t => t.id === currentId);
  return i >= 0 && i + 1 < tasks.length ? tasks[i + 1] : null;
}

// A sign-in or error page can come back as a 200; it must never be cached as the media file.
function isMediaType(type) {
  const mime = (type || '').split(';', 1)[0].trim();
  return !/^text\/|[+/](?:json|xml)$/i.test(mime);
}

function captureBlob(xhr, response = xhr.response) {
  if (xhr.status < 200 || xhr.status >= 300 || xhr.status === 206) return null;
  const type = xhr.getResponseHeader('Content-Type');
  if (!isMediaType(type)) return null;
  if (xhr.responseType === 'blob') return response instanceof Blob && response.size > 0 && isMediaType(response.type) ? response : null;
  if (xhr.responseType !== 'arraybuffer' || !(response instanceof ArrayBuffer) || response.byteLength === 0) return null;
  // new Blob() copies the bytes, so the copy survives LS detaching the buffer later.
  return new Blob([response], { type: type || 'video/mp4' });
}

// Shadow xhr.response on this one request: the first read after the download
// finished (readyState 4) passes the response to onFull before the caller gets it.
function hookResponse(xhr, nativeGet, onFull) {
  let done = false;
  Object.defineProperty(xhr, 'response', {
    configurable: true,
    get() {
      const response = nativeGet.call(xhr);
      if (!done && xhr.readyState === 4) {
        done = true;
        try { onFull(response); } catch (e) { console.warn('[sound-only] capture failed', e); }
      }
      return response;
    }
  });
}

// The waveform uses a GET XHR. Wait for a matching background download, then let
// the native XHR read the Blob so Label Studio still gets its normal load events.
function reusePreloadedWaveform(xhr, { result, controller }, openLocal) {
  const methods = ['send', 'abort', 'setRequestHeader', 'overrideMimeType'];
  if (methods.some(name => Object.hasOwn(xhr, name))) return;
  const { send, abort, setRequestHeader, overrideMimeType } = xhr;
  let waiting = false, active = true, customRequest = false;
  const restore = () => {
    if (!active) return;
    active = false;
    for (const name of methods) delete xhr[name];
  };
  xhr.setRequestHeader = function (name, value) {
    setRequestHeader.call(this, name, value);
    if (String(name).toLowerCase() !== 'accept') customRequest = true;
  };
  xhr.overrideMimeType = function (type) {
    overrideMimeType.call(this, type);
    customRequest = true;
  };
  xhr.abort = function () {
    restore();
    abort.call(this);
    if (waiting) {
      this.dispatchEvent(new ProgressEvent('abort'));
      this.dispatchEvent(new ProgressEvent('loadend'));
    }
  };
  xhr.send = function (body) {
    if (waiting) throw new DOMException('The waveform request has already been sent.', 'InvalidStateError');
    const { responseType, timeout, withCredentials } = this;
    if (customRequest || body != null || timeout || withCredentials || !['arraybuffer', 'blob'].includes(responseType)) {
      restore();
      return send.apply(this, arguments);
    }
    waiting = true;
    result.then(blob => {
      if (!active) return;
      if (controller.signal.aborted) { this.abort(); return; }
      restore();
      if (blob) {
        openLocal(blob);
        this.responseType = responseType;
      }
      send.call(this);
    });
  };
  return restore;
}

// Point a paused media element at the local copy without Label Studio noticing.
// While the element reloads, its real duration is NaN and currentTime is 0; LS clamps
// seeks to [0, duration], so a NaN duration crashes it. Until the new file's metadata
// is ready, the element reports the old (identical) duration and position instead.
function swapWhenPaused(el, blobUrl, key) {
  if (!el.paused || el.dataset.soundOnlySwap || el.currentSrc === blobUrl ||
      el.dataset.soundOnlyFailed === key) return false;
  const duration = el.duration;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const oldSrc = el.currentSrc;
  const rate = el.playbackRate;
  let time = el.currentTime;
  Object.defineProperty(el, 'duration', { configurable: true, get: () => duration });
  Object.defineProperty(el, 'currentTime', {
    configurable: true,
    get: () => time,
    set: v => { if (Number.isFinite(v)) time = Math.min(Math.max(v, 0), duration); }
  });
  el.dataset.soundOnlySwap = '1';
  let released = false;
  // restore = put the old position back; only when the element still plays this file
  // (Label Studio may have loaded another task's file into it meanwhile).
  const release = restore => {
    if (released) return;
    released = true;
    for (const fn of [onReady, onError, onFallback]) {
      el.removeEventListener('loadedmetadata', fn);
      el.removeEventListener('error', fn);
    }
    delete el.duration;
    delete el.currentTime;
    delete el.dataset.soundOnlySwap;
    if (!restore) return;
    el.currentTime = time;
    el.playbackRate = rate;
  };
  const onReady = () => {
    if (el.src !== blobUrl || el.currentSrc !== blobUrl) { release(false); return; }
    release(true);
    if (Math.abs(el.duration - duration) > 0.5) console.warn('[sound-only] local copy length differs', el.duration, duration);
    el.dataset.soundOnlyLocal = key;
  };
  const onFallback = () => release(el.src === oldSrc);
  const onError = () => {
    if (el.src !== blobUrl) { release(false); return; }
    // Local copy failed: go back to the server file, still guarded until it is ready,
    // and never retry this file on this element (a retry loop makes the video flicker).
    el.dataset.soundOnlyFailed = key;
    console.warn('[sound-only] local copy failed to load; staying on the server file');
    el.removeEventListener('error', onError);
    el.removeEventListener('loadedmetadata', onReady);
    el.addEventListener('loadedmetadata', onFallback);
    el.addEventListener('error', onFallback);
    el.src = oldSrc;
  };
  el.addEventListener('loadedmetadata', onReady);
  el.addEventListener('error', onError);
  el.src = blobUrl;
  return true;
}

function preferLocalMedia(el, blobUrl, key, base) {
  if (!el?.paused || el.dataset.soundOnlySwap || el.dataset.soundOnlyFailed === key ||
      el.src === blobUrl || el.currentSrc === blobUrl) return false;
  const serverSrc = el.src || el.currentSrc;
  if (mediaKey(serverSrc, base) !== key) return false;
  if (el.readyState > 0) {
    // Label Studio can replace the source before the player releases the previous file.
    if (mediaKey(el.currentSrc, base) !== key) return false;
    return swapWhenPaused(el, blobUrl, key);
  }

  // The player has just opened. Reuse the cache before waiting for server metadata.
  const setSource = url => {
    const { currentTime, playbackRate } = el;
    el.src = url;
    if (currentTime > 0 && Number.isFinite(currentTime)) el.currentTime = currentTime;
    el.playbackRate = playbackRate;
  };
  const cleanup = () => {
    el.removeEventListener('loadedmetadata', cleanup);
    el.removeEventListener('error', onError);
  };
  const onError = () => {
    cleanup();
    if (el.src !== blobUrl) return;
    el.dataset.soundOnlyFailed = key;
    setSource(serverSrc);
  };
  el.addEventListener('loadedmetadata', cleanup);
  el.addEventListener('error', onError);
  setSource(blobUrl);
  return true;
}

// LS echoes every seek between the synced players: audio seeks -> video seeks -> video reports
// its time (snapped to a frame, a few ms off) -> audio seeks again ... Each extra seek stalls
// the sound for ~0.2 s, so playback stutters at its start. Drop a seek when every other player
// is already within `tol` seconds of the target. Real jumps (larger moves) still go through.
const SEEK_TOLERANCE = 0.06;   // under two video frames at 25 fps
function isEchoSeek(event, data, origin, targets, timeOf, tol = SEEK_TOLERANCE) {
  if (event !== 'seek' || !data || !Number.isFinite(data.time)) return false;
  let others = 0;
  for (const t of targets) {
    if (t.name === origin) continue;
    const now = timeOf(t);
    if (!Number.isFinite(now) || Math.abs(now - data.time) > tol) return false;
    others++;
  }
  return others > 0;
}

// LS sets <audio>.currentTime again right after playback starts (play() -> playAudio), to the
// spot it is already at. Every set is a full ~0.2 s seek on this file, heard as a stutter.
// Skip sets that would move the sound by less than `tol` seconds.
function skipTinySeeks(el, tol = 0.03) {
  if (!el || Object.getOwnPropertyDescriptor(el, 'currentTime')?.set?.__soSkip) return false;
  if (Object.hasOwn(el, 'currentTime')) return false;    // a swap guard is active; try again later
  const proto = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'currentTime')
    || Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
  const set = function (v) {
    const now = proto.get.call(this);
    if (Number.isFinite(v) && Number.isFinite(now) && Math.abs(v - now) < tol) return;
    proto.set.call(this, v);
  };
  set.__soSkip = true;
  Object.defineProperty(el, 'currentTime', { configurable: true, get() { return proto.get.call(this); }, set });
  return true;
}

// Install the echo filter as an own-property wrapper (untie/retie keep and restore it).
function installSeekFilter(sm, timeOf) {
  if (!sm || typeof sm.sync !== 'function' || sm.sync.__soEchoFilter || sm.__soundOnly) return false;
  const inner = sm.sync;
  const filter = function (data, event, origin) {
    if (isEchoSeek(event, data, origin, this.syncTargets.values(), timeOf)) return false;
    return inner.call(this, data, event, origin);
  };
  filter.__soEchoFilter = true;
  sm.sync = filter;
  return true;
}

function untie(sm, audioName) {
  if (!sm) return null;
  if (sm.__soundOnly) return sm.__soundOnly;
  if (!(sm.syncTargets instanceof Map) || !(sm.bufferingOrigins instanceof Set) ||
      typeof sm.sync !== 'function' || !sm.syncTargets.has(audioName)) return null;

  const order = [...sm.syncTargets.keys()];
  const removed = new Map([...sm.syncTargets].filter(([name]) => name !== audioName));
  const hadOwn = Object.prototype.hasOwnProperty.call(sm, 'sync');
  const prevOwn = hadOwn ? Object.getOwnPropertyDescriptor(sm, 'sync') : null;
  const previousSync = sm.sync;
  const state = { order, removed, active: true, wasBuffering: false, hadOwn, prevOwn };
  const wrapper = function (data, event, origin) {
    if (state.active && state.removed.has(origin)) return false;
    return previousSync.call(this, data, event, origin);
  };
  wrapper.__soundOnly = true;
  state.wrapper = wrapper;
  sm.sync = wrapper;
  for (const name of removed.keys()) {
    sm.syncTargets.delete(name);
    if (sm.bufferingOrigins.delete(name)) state.wasBuffering = true;
    if (sm.locked === name) sm.locked = null;
  }
  sm.__soundOnly = state;
  return state;
}

function retie(sm, state) {
  if (!sm || !state || sm.__soundOnly !== state) return;
  state.active = false;
  if (Object.prototype.hasOwnProperty.call(sm, 'sync') && sm.sync === state.wrapper) {
    if (state.hadOwn) Object.defineProperty(sm, 'sync', state.prevOwn);
    else delete sm.sync;
  }
  const current = new Map(sm.syncTargets);
  sm.syncTargets.clear();
  for (const name of state.order) {
    if (current.has(name)) sm.syncTargets.set(name, current.get(name));
    else if (state.removed.has(name)) sm.syncTargets.set(name, state.removed.get(name));
  }
  for (const [name, target] of current) {
    if (!sm.syncTargets.has(name)) sm.syncTargets.set(name, target);
  }
  delete sm.__soundOnly;
}

function checkShape(sm, audioName, videoName) {
  if (!sm || !(sm.syncTargets instanceof Map) || !(sm.bufferingOrigins instanceof Set) ||
      typeof sm.sync !== 'function' || audioName === videoName) return false;
  const targets = new Map(sm.syncTargets);
  if (sm.__soundOnly && sm.__soundOnly.active) {
    for (const [name, target] of sm.__soundOnly.removed) {
      if (!targets.has(name)) targets.set(name, target);
    }
  }
  const audio = targets.get(audioName);
  const video = targets.get(videoName);
  return targets.size === 2 && !!audio && !!video &&
    audio.name === audioName && audio.type === 'audio' &&
    video.name === videoName && video.type === 'video';
}

const prefMemory = new Map();
function classifyHeader(text) { return ({'speaker gender':'gender','dialect validation':'dialect','micro-dialect':'micro','could possibly also be':'alt','transcription (arabic script)':'trans','code-switching?':'code'})[String(text || '').trim().toLowerCase()] || null; }
function flattenPath(node, stop) { const result=[]; let p=node?.parentElement; for (; p && p!==stop; p=p.parentElement) if (!p.dataset?.so && p.style?.display !== 'none') result.push(p); return p===stop ? result : []; }
function cardOf(h3, stop) {
  if (!h3 || !stop || h3.parentElement === stop) return null;
  for (let p=h3.parentElement; p && p!==stop; p=p.parentElement) if (/(?:^|;)\s*border\s*:/i.test(p.getAttribute('style') || '')) return p;
  return h3.parentElement;
}
function noteReason({selected, videoSkipped, segSkipped, transVisible}) {
  if (videoSkipped) return 'Video skipped: nothing to transcribe.';
  if (!selected || transVisible) return '';
  return segSkipped ? 'Segment skipped: no transcription needed.' : 'Transcription is asked only when the dialect is Libya.';
}
const SIDE_NOTES = {
  'Video skipped: nothing to transcribe.': 'The wave, segments and questions are hidden while the whole video is skipped.',
  'Segment skipped: no transcription needed.': 'Gender, dialect, transcription and code-switching are not asked for a skipped segment.',
  'Transcription is asked only when the dialect is Libya.': 'Micro-dialect, transcription and code-switching are asked only when the dialect is Libya.',
};
function sideNote(message) { return SIDE_NOTES[message] || ''; }
function clampSpeed(v) { return Number.isFinite(v) ? Math.min(3, Math.max(0.5, Math.round(v * 4) / 4)) : 1; }
function isEditingField(el) { return /^(INPUT|TEXTAREA|SELECT)$/i.test(el?.tagName || '') || !!el?.isContentEditable; }
function isHotkey(e) { return e.code==='KeyL' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat && !e.isComposing && !isEditingField(e.target); }
function readPref(storage,key,allowed,fallback) { let v; try { v=storage ? storage.getItem(key) : prefMemory.get(key); } catch (_) { v=prefMemory.get(key); } return allowed.includes(v) ? v : fallback; }
function writePref(storage,key,value) { prefMemory.set(key,String(value)); try { storage?.setItem(key,value); } catch (_) {} }
function fixedSlot(rect,innerWidth,gutter) { return !rect || !rect.height ? null : {top:rect.top,right:innerWidth-rect.right+gutter,height:rect.height}; }

function shortTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '';
  const n = Math.round(sec * 10);
  return `${Math.floor(n / 600)}:${String(Math.floor(n / 10) % 60).padStart(2, '0')}.${n % 10}`;
}
function lengthText(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '';
  return sec < 60 ? `${sec.toFixed(1)} s` : shortTime(sec);
}
function stepIndex(count, current, dir) {
  if (count <= 0) return -1;
  if (current < 0) return dir > 0 ? 0 : count - 1;
  const next = current + dir;
  return next >= 0 && next < count ? next : -1;
}
function pagerWindow(ids, currentId, n = 3) {
  const index = ids.indexOf(currentId);
  return { before: index < 0 ? [] : ids.slice(Math.max(0, index - n), index), after: index < 0 ? [] : ids.slice(index + 1, index + 1 + n), index, count: ids.length };
}
function pagerTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '';
  const n = Math.round(sec);
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
}
function pagerStat({ cached, progress, failed, duration }) {
  const time = pagerTime(duration);
  if (cached) return { state: 'ready', text: time ? '\u2713 ' + time : '\u2713', title: time ? 'On your computer \u00b7 ' + time + ' long' : 'On your computer' };
  if (progress) return { state: 'loading', text: '\u2193 ' + progress, title: 'Downloading in the background' };
  if (failed) return { state: 'error', text: '\u2715', title: 'Download failed; it will load normally' };
  return { state: 'idle', text: '\u25cb', title: 'Not downloaded yet' };
}
function processedSegmentResult(result) {
  const name = result?.from_name?.name ?? result?.from_name;
  if (name === 'segment_skip_toggle') return !!result.value?.choices?.includes('Skip this segment');
  if (name !== 'segment_transcription') return false;
  const text = result.value?.text;
  return (Array.isArray(text) ? text : [text]).some(value => typeof value === 'string' && value.trim());
}
function pagerAnnotation(task) {
  const records = Array.isArray(task?.annotations) ? task.annotations.filter(Boolean) : null;
  const annotations = records?.filter(annotation => !annotation.was_cancelled);
  const skipped = !!records?.length && !annotations.length;
  const submitted = !skipped && !!(annotations?.length || task?.is_labeled === true || task?.total_annotations > 0);
  const draft = Array.isArray(task?.drafts) ? task.drafts.at(-1) : null;
  const result = draft ? draft.result : annotations?.at(-1)?.result;
  const hasDraft = !!draft || task?.draft_exists === true;
  const state = hasDraft ? 'draft' : submitted ? 'submitted' : skipped ? 'skipped'
    : (annotations || task?.total_annotations === 0) && (Array.isArray(task?.drafts) || task?.draft_exists === false) ? 'todo' : 'unknown';
  let counts = null;
  if (Array.isArray(result) && (!hasDraft || draft)) {
    const segments = new Set(result.filter(r => r?.from_name === 'speaker_segments' && r.id != null).map(r => r.id));
    const processed = new Set(result.filter(r => segments.has(r?.id) && processedSegmentResult(r)).map(r => r.id));
    counts = { processed: processed.size, total: segments.size };
  } else if (state === 'todo' || state === 'skipped') {
    counts = { processed: 0, total: 0 };
  }
  return { state, counts, submitted };
}
function segmentState(region, pageText) {
  if (region?.results?.some(r => r.from_name?.name === 'segment_skip_toggle' && r.value?.choices?.includes('Skip this segment'))) return 'skip';
  return /Complete/i.test(pageText || '') ? 'done' : 'todo';
}
function pageTime(sec) {
  const n = Math.round(sec * 100);
  return `${String(Math.floor(n / 6000)).padStart(2, '0')}:${String(Math.floor(n / 100) % 60).padStart(2, '0')}.${String(n % 100).padStart(2, '0')}`;
}

const helpers = { segmentShortcut, submitDecision, pageAt, isEchoSeek, installSeekFilter, skipTinySeeks, untie, retie, checkShape, mediaKey, isMediaType, captureBlob, hookResponse, reusePreloadedWaveform, swapWhenPaused, preferLocalMedia, cacheRequestUrl, keysToEvict, pickNextTask, zoomFactor, zoomAt, peaks, classifyHeader, flattenPath, isHotkey, readPref, writePref, fixedSlot, cardOf, noteReason, sideNote, clampSpeed, shortTime, lengthText, stepIndex, segmentState, pagerWindow, pagerStat, pagerAnnotation };
if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
else Object.assign(window.LSSoundOnly ||= {}, { helpers: { ...helpers, svg, ICON, PAGER_CACHE_ICONS, CACHE_NAME, CACHE_MAX_FILES, isEditingField, pagerTime, processedSegmentResult, pageTime }, features: {} });
})();
