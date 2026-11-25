(() => {
  const { mediaKey, isMediaType } = window.CinnamonBoost.helpers;
  window.CinnamonBoost.features.preload = { start(ctx) {
    const { window, currentTaskId } = ctx;
    const tasksById = new Map(), preloads = new Map(), progressByKey = new Map(), failedKeys = new Set();
    let orderedTasks = [], taskListScope;
    // ponytail: preload three tasks ahead sequentially; six files fit the current task, three ahead and two behind.
    let preloadJob = null;
    const PRELOAD_STALL_MS = 25000;          // ponytail: no data for 25 s = stalled; the knob if the server is slower
    const isRelevantPreload = transfer => {
      const current = currentTaskId();
      return current == null || current === transfer.from || current === transfer.to;
    };
    function downloadAhead(task, key, from, onProgress) {
      const existing = preloads.get(key);
      if (existing && !existing.controller.signal.aborted) return existing;

      const controller = new AbortController();
      const transfer = { from, to: task.id, controller, result: null };
      preloads.set(key, transfer);
      failedKeys.delete(key);
      progressByKey.set(key, '0 MB');
      // A stalled download stops without aborting `controller`, so a waveform waiting on it
      // goes on to the server instead of being cancelled (that is only for leaving the task).
      const stall = new AbortController();
      let stallTimer = 0;
      const armStall = () => { clearTimeout(stallTimer); stallTimer = setTimeout(() => stall.abort(), PRELOAD_STALL_MS); };
      transfer.result = (async () => {
        try {
          armStall();
          const response = await window.fetch(new URL(task.data.video, window.location.href), { signal: AbortSignal.any([controller.signal, stall.signal]) });
          if (!response.ok || response.status === 206 || !response.body) throw new Error('HTTP ' + response.status);
          if (!isMediaType(response.headers.get('Content-Type'))) throw new Error('Not a media file: ' + response.headers.get('Content-Type'));
          const total = +response.headers.get('Content-Length') || 0;
          const reader = response.body.getReader(), parts = [];
          let loaded = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (!isRelevantPreload(transfer)) controller.abort();
            if (controller.signal.aborted) return null;
            if (done) { clearTimeout(stallTimer); break; }
            if (!value.length) continue;
            armStall();
            parts.push(value);
            loaded += value.length;
            const progress = total ? Math.floor(loaded / total * 100) + '%' : Math.round(loaded / 1048576) + ' MB';
            progressByKey.set(key, progress);
            onProgress(progress);
          }
          const blob = new Blob(parts, { type: response.headers.get('Content-Type') || 'video/mp4' });
          if (!blob.size) throw new Error('Empty download');
          await ctx.cache.saveToCache(key, blob);
          return blob;
        } catch (error) {
          if (!controller.signal.aborted) {
            failedKeys.add(key);
            console.warn('[Cinnamon Boost] preload failed', error);
          }
          return null;
        } finally {
          clearTimeout(stallTimer);
          if (preloads.get(key) === transfer) {
            preloads.delete(key);
            progressByKey.delete(key);
          }
        }
      })();
      return transfer;
    }

    async function preloadNext(taskId) {
      const job = { taskId };
      preloadJob = job;
      const live = () => preloadJob === job && currentTaskId() === taskId;
      try {
        if (ctx.settings.cache && ctx.settings.preload) await ctx.cache.ready;
        const m = window.location.pathname.match(/^(.*)\/projects\/(\d+)\//);
        if (!m || !live()) return;
        const view = new URL(window.location.href).searchParams.get('tab');
        const scope = JSON.stringify([m[1], m[2], view]);
        if (scope !== taskListScope) {
          taskListScope = scope;
          orderedTasks = [];
          tasksById.clear();
        }
        const knownIndex = orderedTasks.findIndex(t=>t.id===taskId);
        if (knownIndex < 0 || orderedTasks.length - knownIndex - 1 < ctx.settings.preload) {
          let tasks = [];
          for (let page = 1; page <= 50 && live(); page++) {
            const url = m[1]+'/api/tasks?page='+page+'&page_size=100&project='+m[2]+(view ? '&view='+view : '');
            const res = await window.fetch(url);
            if (!res.ok) break;
            const list = (await res.json()).tasks || [];
            if (!live()) return;
            tasks = tasks.concat(list);
            orderedTasks = tasks;
            if (page === 1) tasksById.clear();
            for (const task of list) tasksById.set(task.id,task);
            const index=tasks.findIndex(t=>t.id===taskId);
            if (list.length < 100 || (index >= 0 && tasks.length > index + Math.max(3, ctx.settings.preload))) break;
          }
        }
        const index=orderedTasks.findIndex(t=>t.id===taskId), next=index<0 || !ctx.settings.cache ? [] : orderedTasks.slice(index+1,index+1+ctx.settings.preload);
        if (!next.length && live()) ctx.toolbar.setNext('idle','');
        for (const [i,task] of next.entries()) {
          if (!live()) return;
          const key=mediaKey(task.data?.video,window.location.href);
          if (!key) { if (i===0) ctx.toolbar.setNext('idle',''); continue; }
          const ready=()=>{ if (live() && i===0) ctx.toolbar.setNext('ready','\u2713','Next task #'+task.id+' is ready on your computer: it opens instantly'); };
          if (ctx.cache.has(key)) { ready(); continue; }
          if (i===0) ctx.toolbar.setNext('loading','\u2193','Downloading next task #'+task.id+' in the background');
          const progress = value => {
            if (i === 0 && live()) ctx.toolbar.setNext('loading','\u2193 ' + value,'Downloading next task #' + task.id + ' in the background');
          };
          await downloadAhead(task, key, taskId, progress).result;
          if (!live()) return;
          if (ctx.cache.has(key)) ready();
          else {
            failedKeys.add(key);
            if (i === 0) ctx.toolbar.setNext('error','\u2715','Could not cache the next task; it will load normally');
          }
        }
      } catch (e) {
        console.warn('[Cinnamon Boost] preload failed',e);
        if (live()) ctx.toolbar.setNext('error','\u2715','Could not download the next task; it will load normally');
      }
    }

    ctx.scheduler.onPoll(0, () => { for (const transfer of preloads.values()) if (!isRelevantPreload(transfer)) transfer.controller.abort(); });
    ctx.scheduler.onPoll(3, () => { if (currentTaskId() !== preloadJob?.taskId) ctx.toolbar.setNext('idle', ''); });
    ctx.scheduler.onPoll(5, () => { const taskId = currentTaskId(); if (taskId && taskId !== preloadJob?.taskId && (!(ctx.settings.cache && ctx.settings.preload) || ctx.cache.localFileFor(ctx.cache.taskMediaKey()))) preloadNext(taskId); });
    return { transferFor: key => preloads.get(key), progress: key => progressByKey.get(key), failed: key => failedKeys.has(key), tasksById, get orderedTasks() { return orderedTasks; } };
  } };
})();
