(() => {
  const { mediaKey, isMediaType, cacheRequestUrl, keysToEvict, CACHE_NAME, CACHE_MAX_FILES, reusePreloadedWaveform, captureBlob, hookResponse, preferLocalMedia } = window.LSSoundOnly.helpers;
  window.LSSoundOnly.features.cache = { start(ctx) {
    const { window, document } = ctx;
    let stored = null;                       // { key, blobUrl } of the current task's file
    const cached = new Map();                // key -> blob URL of a file saved on disk
    const blobs = new Map();
    function rememberBlob(key, blob) {
      cached.set(key, window.URL.createObjectURL(blob));
      blobs.set(key, blob);
    }
    const durations = new Map(), durationReads = new Set();
    function readDuration(key) {
      if (!cached.has(key) || durationReads.has(key)) return;
      durationReads.add(key);
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.addEventListener('loadedmetadata', () => { if (Number.isFinite(audio.duration)) durations.set(key, audio.duration); audio.removeAttribute('src'); audio.load(); }, { once: true });
      audio.addEventListener('error', () => { audio.removeAttribute('src'); audio.load(); }, { once: true });
      audio.src = cached.get(key);
    }
    const useStored = (key, blobUrl) => {
      if (stored?.key === key && stored.blobUrl === blobUrl) return;
      if (stored && stored.blobUrl !== blobUrl && ![...cached.values()].includes(stored.blobUrl)) {
        window.URL.revokeObjectURL(stored.blobUrl);
      }
      stored = { key, blobUrl };
    };
    const diskCache = () => window.caches.open(CACHE_NAME);
    let cacheReady = false;
    const loadCache = (async () => {         // disk-backed blobs: cheap to keep open
      try {
        const cache = await diskCache();
        for (const req of await cache.keys()) {
          const key = new URL(req.url).searchParams.get('k');
          const res = await cache.match(req);
          if (res && !isMediaType(res.headers.get('Content-Type'))) { await cache.delete(req); continue; }   // saved by an older build
          if (key && res) rememberBlob(key, await res.blob());
        }
      } catch (e) { console.warn('[sound-only] cache unavailable', e); }
      cacheReady = true;
    })();
    async function saveToCache(key, blob) {
      if (cached.has(key)) return;
      try {
        const cache = await diskCache();
        const req = cacheRequestUrl(key, window.location.origin);
        await cache.put(req, new Response(blob, { headers: { 'Content-Type': blob.type || 'video/mp4' } }));
        const res = await cache.match(req);
        if (res) rememberBlob(key, await res.blob());
        for (const old of keysToEvict((await cache.keys()).map(r => r.url), CACHE_MAX_FILES)) {
          await cache.delete(old);
          const oldKey = new URL(old).searchParams.get('k');
          if (cached.has(oldKey)) {
            if (oldKey !== stored?.key) window.URL.revokeObjectURL(cached.get(oldKey));
            cached.delete(oldKey);
            blobs.delete(oldKey);
          }
        }
      } catch (e) { console.warn('[sound-only] could not save to cache', e); }
    }
    const fetch = window.fetch;
    function cachedResponse(blob, range) {
      let body = blob;
      const type = blob.type || 'video/mp4';
      const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes' };
      if (range) {
        const { start, end } = range;
        if (start >= blob.size) return;
        const last = Math.min(end ?? blob.size - 1, blob.size - 1);
        body = blob.slice(start, last + 1, type);
        headers['Content-Range'] = `bytes ${start}-${last}/${blob.size}`;
      }
      headers['Content-Length'] = String(body.size);
      return new Response(body, { status: range ? 206 : 200, headers });
    }
    window.fetch = function (...args) {
      const [input, options] = args;
      const request = typeof window.Request === 'function' && input instanceof window.Request ? input : null;
      const method = options?.method ?? request?.method ?? 'GET';
      if (String(method).toUpperCase() !== 'GET' || request?.body != null || options?.body != null) return fetch.apply(this, args);
      const blob = blobs.get(mediaKey(request?.url ?? input, window.location.href));
      if (!blob) return fetch.apply(this, args);
      let header;
      try {
        header = options?.headers === undefined ? request?.headers.get('Range') : new Headers(options.headers).get('Range');
      } catch (_) {
        return fetch.apply(this, args);
      }
      let range;
      if (header != null) {
        const match = /^bytes=(\d+)-(\d*)$/i.exec(header);
        if (!match) return fetch.apply(this, args);
        const start = Number(match[1]), end = match[2] ? Number(match[2]) : null;
        if (!Number.isSafeInteger(start) || (end != null && (!Number.isSafeInteger(end) || end < start))) return fetch.apply(this, args);
        range = { start, end };
      }
      const signal = options?.signal === undefined ? request?.signal : options.signal;
      if (!signal?.aborted) {
        try {
          const response = cachedResponse(blob, range);
          if (response) return Promise.resolve(response);
        } catch (_) {}
      }
      return fetch.apply(this, args);
    };
    const open = window.XMLHttpRequest.prototype.open;
    const responseGetter = Object.getOwnPropertyDescriptor(window.XMLHttpRequest.prototype, 'response').get;
    const listeners = new WeakMap();
    const deferred = new WeakMap();
    const neverAborted = new AbortController();
    window.XMLHttpRequest.prototype.open = function (...args) {
      deferred.get(this)?.();
      deferred.delete(this);
      const previous = listeners.get(this);
      if (previous) {
        this.removeEventListener('load', previous.onLoad);
        if (previous.get && previous.get === Object.getOwnPropertyDescriptor(this, 'response')?.get) delete this.response;
        listeners.delete(this);
      }
      const key = mediaKey(args[1], window.location.href);
      if (key && cached.has(key)) {
        // Already on disk: LS's waveform download reads the local copy instead of the server.
        args[1] = cached.get(key);
        useStored(key, args[1]);
        return open.apply(this, args);
      }
      const result = open.apply(this, args);
      if (!key) return result;
      // Wait for a background download of this file, or (on a fresh page) for the disk cache
      // to finish listing: the file may already be there. found = the Blob, or true when on disk.
      const transfer = ctx.preload?.transferFor(key) ||
        (!cacheReady && { result: loadCache.then(() => cached.has(key)), controller: neverAborted });
      if (transfer && !transfer.controller.signal.aborted && String(args[0]).toUpperCase() === 'GET' && args[2] !== false && args[3] == null && args[4] == null) {
        const restore = reusePreloadedWaveform(this, transfer, found => {
          const url = cached.get(key) || (found instanceof Blob ? window.URL.createObjectURL(found) : null);
          if (!url) return;  // The cache entry can be evicted before the waiting request resumes.
          open.call(this, 'GET', url);
          useStored(key, url);
        });
        if (restore) deferred.set(this, restore);
      }
      const keep = response => {
        if (stored?.key === key) return;
        const blob = captureBlob(this, response);
        if (!blob) return;
        useStored(key, window.URL.createObjectURL(blob));
        saveToCache(key, blob);
      };
      // LS hands the downloaded buffer to a worker inside its own load handler,
      // which empties it. Copy it the first time LS reads xhr.response instead.
      let get;
      if (!Object.hasOwn(this, 'response')) {
        hookResponse(this, responseGetter, keep);
        get = Object.getOwnPropertyDescriptor(this, 'response').get;
      }
      const onLoad = () => keep(responseGetter.call(this));
      listeners.set(this, { onLoad, get });
      this.addEventListener('load', onLoad);
      return result;
    };
    const taskMediaKey = () => mediaKey(window.Htx?.task?.dataObj?.video, window.location.href);
    const localFileFor = key => stored?.key === key ? stored.blobUrl : cached.get(key);
    document.addEventListener('loadstart', ({ target }) => {
      if (!(target instanceof window.HTMLMediaElement)) return;
      const key = taskMediaKey();
      const blobUrl = localFileFor(key);
      if (blobUrl && preferLocalMedia(target, blobUrl, key, window.location.href)) useStored(key, blobUrl);
    }, true);
    const applyLocalMedia = (key, audio) => {
      const blobUrl = localFileFor(key);
      if (!blobUrl) return false;
      const video = document.querySelector('video');
      useStored(key, blobUrl);
      preferLocalMedia(audio, blobUrl, key, window.location.href);
      preferLocalMedia(video, blobUrl, key, window.location.href);
      return true;
    };
    ctx.scheduler.onPoll(4, () => applyLocalMedia(taskMediaKey(), document.querySelector('audio')));
    return { applyLocalMedia, ready: loadCache, saveToCache, has: key => cached.has(key), get: key => cached.get(key), readDuration, localFileFor, useStored, taskMediaKey, get stored() { return stored; }, durations };
  } };
})();
