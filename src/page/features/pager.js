(() => {
  const { pagerWindow, pagerAnnotation, mediaKey, processedSegmentResult, pagerStat, pagerTime, submitDecision, PAGER_CACHE_ICONS } = window.LSSoundOnly.helpers;
  const { bindingLabel } = window.LSSoundOnly.settings;
  function saveButtonKind(button) {
    if (!button || button.closest('[hidden]')) return;
    const testId = button.dataset.testid;
    if (testId === 'bottombar-submit-button') return 'submit';
    if (testId === 'bottombar-update-button') return 'update';
    if (!button.closest('.lsf-bottombar')) return;
    const label = (button.getAttribute('aria-label') || button.textContent).trim().toLowerCase();
    if (label === 'submit' || label === 'update') return label;
  }
  window.LSSoundOnly.features.pager = { start(ctx) {
    const { window, document, editing, currentTaskId } = ctx;
    const tasksById = ctx.preload?.tasksById || new Map();
    const durations = ctx.cache?.durations || new Map(), readDuration = key => ctx.cache?.readDuration(key);
    const { bar, update, nextChip, setNext } = ctx.toolbar;
    const leaveMessage = 'Unsaved changes: press again to leave';
    const duplicateSaved = 'Already submitted: saved as an update to your annotation.';
    const duplicateFailed = 'Not saved: this task was already submitted. Keep this page open and press Update.';
    let leaveArmed = null;
    let leaveTimer;
    const leaveWarning = () => !!leaveArmed && leaveArmed.from === currentTaskId() && performance.now() < leaveArmed.until;
    const onCurrentTask = attempt => attempt && attempt.ls === window.Htx && attempt.taskId === currentTaskId();
    let duplicateTask;
    const warning = () => leaveWarning() ? leaveMessage : onCurrentTask(duplicateTask) ? duplicateTask.message : null;
    const pager=document.createElement('div'); pager.className='so-pager';
    const centre=document.createElement('div'); centre.className='so-pager-centre';
    pager.appendChild(centre);
    for (const event of ['pointerdown','mousedown','mouseup','click']) pager.addEventListener(event,e=>e.stopPropagation());
    const pagerDetails = new Map();
    const refresh = () => syncPager(document.body.classList.contains('so-compact'));
    let pagerKey='', lastPagerTask, pagerTaskSince, pagerDetailPending = false;
    const pagerTasks=()=>{
      const listed=Array.from(window.DM?.taskStore?.list || []), id=currentTaskId();
      const ordered=ctx.preload?.orderedTasks || [];
      const near=pagerWindow(listed.map(t=>t.id),id);
      if (near.index >= 0 && near.after.length === 3) return { tasks: listed, id, near };
      const ahead=pagerWindow(ordered.map(t=>t.id),id);
      if (near.index < 0) return { tasks: ordered, id, near: ahead };
      if (ahead.after.length > near.after.length) near.after = ahead.after;
      if (ahead.before.length > near.before.length) near.before = ahead.before;
      return { tasks: listed, id, near };
    };
    // Leaving a task with unsaved work (text typed but not added, or edits since it was opened) needs
    // a second press within a few seconds; the pager or toolbar says so.
    // canUndo matches Update after undoing back to the start, when hasChanges is still true.
    const unsavedWork=()=>[...document.querySelectorAll('[data-so="trans"] textarea')].some(box=>box.value.trim()) ||
      !!window.Htx?.annotationStore?.selected?.history?.canUndo;
    const go=(taskId, saved = false)=>{
      clearTimeout(leaveTimer);
      if (!saved && unsavedWork() && !(leaveWarning() && leaveArmed.taskId===taskId)) {
        leaveArmed={ from: currentTaskId(), taskId, until: performance.now()+4000 };
        leaveTimer=setTimeout(()=>{ leaveArmed=null; refresh(); },4000);
        refresh();
        return;
      }
      const wasArmed=!!leaveArmed;
      leaveArmed=null;
      if (wasArmed) refresh();
      try { window.DM?.setTask?.({taskID:taskId}); } catch (_) {}
    };
    function submitAction() {
      const ls = window.Htx;
      // ponytail: no Htx.hydrated check; this LS build leaves it false on loaded tasks.
      if (ls?.isLoading || isSaving()) return;
      const buttons = {};
      for (const button of document.querySelectorAll('.lsf-bottombar button, button[data-testid^="bottombar-"]')) {
        const kind = saveButtonKind(button);
        if (kind) buttons[kind] ??= button;
      }
      const ann = ls?.annotationStore?.selected;
      const dirty = ann?.history?.hasChanges || ann?.history?.canUndo || ann?.draftId || ann?.versions?.draft;
      const action = submitDecision({ ...buttons, dirty });
      if (action !== 'next') {
        const button = buttons[action];
        return () => {
          if (!button.matches(':disabled, [aria-disabled="true"]')) button.click();
        };
      }
      const taskId = pagerTasks().near.after[0];
      if (taskId != null && typeof window.DM?.setTask === 'function') return () => go(taskId);
    }
    const observedEvents = new WeakSet();
    const submittedByTask = new Map();
    const apiBase = () => window.location.pathname.match(/^(.*)\/projects\/\d+\//)?.[1];
    const startupBase = apiBase();
    let userId, userLookup;
    function currentUser(base) {
      if (userId != null) return userId;
      return userLookup ??= readJson(`${base}/api/current-user/whoami`)
        .then(user => userId = user?.id).catch(() => null).finally(() => { userLookup = null; });
    }
    if (startupBase != null) currentUser(startupBase);
    async function readJson(url) {
      const response = await window.fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Could not check for a previous submission');
      return response.json();
    }
    async function alreadySubmitted(base, taskId, submitted) {
      const saved = submittedByTask.get(taskId);
      if (saved) return { annotation: saved };
      try {
        const userId = (await userLookup) ?? await currentUser(base);
        if (userId == null) return null;
        const local = window.Htx?.annotationStore?.annotations?.find(annotation =>
          annotation !== submitted && annotation.pk != null && annotation.pk !== submitted?.pk &&
          !annotation.skipped && annotation.user?.id === userId);
        if (local) return { annotation: { id: local.pk, lead_time: local.leadTime } };
        const task = await readJson(`${base}/api/tasks/${encodeURIComponent(taskId)}`);
        const own = task.annotations?.filter(({ was_cancelled, completed_by }) =>
          was_cancelled === false && (completed_by?.id ?? completed_by) === userId);
        const byDate = own?.every(annotation => Number.isFinite(Date.parse(annotation.created_at)));
        const annotation = own?.sort((a, b) =>
          (byDate ? Date.parse(b.created_at) - Date.parse(a.created_at) : 0) || b.id - a.id)[0];
        return annotation && { annotation, drafts: task.drafts };
      } catch (_) {
        return null;
      }
    }
    async function updateExisting(base, { annotation, drafts }, editorAnnotation, draftId) {
      try {
        const result = editorAnnotation?.serializeAnnotation();
        if (annotation.id == null || !Array.isArray(result)) return false;
        const body = { result };
        // Match LSF's Update timing using the saved annotation and the editor's draft/session.
        const draft = drafts?.find(draft => draft.id === draftId);
        const sessionTime = (Date.now() - editorAnnotation.loadedDate?.getTime()) / 1000;
        const leadTime = Number(annotation.lead_time ?? 0) + Number(draft?.lead_time ?? 0) + sessionTime;
        if (Number.isFinite(leadTime)) body.lead_time = leadTime;
        const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/)?.[1] ?? '';
        const response = await window.fetch(`${base}/api/annotations/${encodeURIComponent(annotation.id)}/`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
          body: JSON.stringify(body),
          credentials: 'same-origin',
          redirect: 'error',
          signal: AbortSignal.timeout(20000),
        });
        return response.ok ? { id: annotation.id, lead_time: body.lead_time ?? annotation.lead_time } : null;
      } catch (_) {
        return false;
      }
    }
    const saving = new Map();
    const isSaving = () => window.Htx?.isSubmitting || saving.has(currentTaskId());
    window.addEventListener('click', e => {
      const button = e.target.closest?.('button');
      if (!saveButtonKind(button)) return;
      if (isSaving()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      const ls = window.Htx;
      if (!ls || button.matches(':disabled, [aria-disabled="true"]')) return;
      const taskId = currentTaskId(), attempt = {};
      saving.set(taskId, attempt);
      // A click can exit without saving (for example, when validation fails).
      attempt.timer = setTimeout(() => { if (saving.get(taskId) === attempt) saving.delete(taskId); }, 1500);
      wrapSaveEvents();
    }, true);
    function wrapSaveEvents() {
      const events = window.Htx?.events;
      if (typeof events?.invoke !== 'function' || observedEvents.has(events)) return;
      const invoke = events.invoke;
      events.invoke = function (name, ls, ...args) {
        if (name !== 'submitAnnotation' && name !== 'updateAnnotation') return invoke.apply(this, arguments);
        const from = currentTaskId();
        const pending = saving.get(from);
        if (pending?.invoked && (ls === window.Htx || ls?.task?.id === from)) return Promise.resolve();
        if (ls !== window.Htx) return invoke.apply(this, arguments);
        clearTimeout(pending?.timer);
        const dm = window.DM;
        const sdk = dm?.SDK;
        const attempt = { ls, taskId: from, invoked: true };
        saving.set(from, attempt);
        const next = ctx.settings.nextAfterSubmit && !new URLSearchParams(window.location.search).has('exitStream')
          ? pagerTasks().near.after[0] : null;
        const canConfirm = typeof sdk?.on === 'function' && typeof sdk?.off === 'function';
        // Data Manager emits this event with the server response. The editor's
        // save callback also awaits Data Manager's reload or native advance.
        let confirmed = false;
        const saved = (editor, _annotation, result) => {
          const status = result?.$meta?.status;
          if (editor !== ls || result?.error || !(status >= 200 && status < 300)) return;
          if (name === 'submitAnnotation' && from != null && result.id != null) {
            submittedByTask.set(from, { id: result.id, lead_time: result.lead_time });
          }
          if (currentTaskId() === from) confirmed = true;
        };
        return (async () => {
          let listening = false;
          try {
            const base = name === 'submitAnnotation' ? apiBase() : null;
            let duplicate;
            if (base != null && from != null) {
              const annotation = args[0] ?? ls.annotationStore?.selected;
              const draftId = annotation?.draftId;
              duplicate = await alreadySubmitted(base, from, annotation);
              if (!onCurrentTask(attempt) || events !== ls.events) return;
              if (duplicate) {
                const updated = await updateExisting(base, duplicate, annotation, draftId);
                confirmed = !!updated;
                if (updated) submittedByTask.set(from, updated);
                if (onCurrentTask(attempt)) {
                  leaveArmed = null;
                  duplicateTask = { ...attempt, message: confirmed ? duplicateSaved : duplicateFailed };
                  refresh();
                }
                // A resolved submit tells LSF to finish saving and discard its draft state.
                if (!confirmed) throw new Error(duplicateFailed);
              }
            }
            let result;
            if (!duplicate) {
              if (canConfirm) {
                sdk.on(name, saved);
                listening = true;
              }
              result = await invoke.call(this, name, ls, ...args);
            }
            if (confirmed && from != null) {
              if (!duplicate && duplicateTask?.ls === ls && duplicateTask.taskId === from) duplicateTask = null;
              const invalidate = () => { pagerDetails.delete(from); refresh(); };
              setTimeout(invalidate, 3000);
              setTimeout(() => {
                invalidate();
                if (next != null && dm === window.DM && ls === window.Htx && currentTaskId() === from && !ls.noTask && !ls.isLoading) go(next, true);
              }, 0);
            }
            return result;
          } finally {
            if (saving.get(from) === attempt) saving.delete(from);
            if (listening) sdk.off(name, saved);
          }
        })();
      };
      observedEvents.add(events);
    }
    wrapSaveEvents();
    ctx.scheduler.onPoll(7, wrapSaveEvents);
    function pagerTaskAnnotation(taskId, task) {
      const summary = pagerAnnotation(task);
      const base = apiBase();
      if (taskId == null || base == null) return summary;
      const stamp = JSON.stringify([task?.updated_at, task?.total_annotations, task?.draft_exists, task?.is_labeled]);
      let entry = pagerDetails.get(taskId);
      const now = performance.now();
      // Give Label Studio the connections first on task switches, then check one tile per request.
      const stale = entry?.stamp !== stamp || now - entry.fetchedAt >= 60000;
      if (stale && !pagerDetailPending && !document.hidden && window.Htx && !window.Htx.isLoading && now - pagerTaskSince >= 3000) {
        pagerDetailPending = true;
        entry = { stamp, fetchedAt: now, summary: entry?.summary };
        pagerDetails.set(taskId, entry);
        if (pagerDetails.size > 70) pagerDetails.delete(pagerDetails.keys().next().value);
        const request = entry;
        window.fetch(`${base}/api/tasks/${encodeURIComponent(taskId)}`, { priority: 'low', cache: 'no-store' })
          .then(response => response.ok ? response.json() : null)
          .then(detail => {
            if (!detail) return;
            const annotation = pagerAnnotation(detail);
            if (annotation.state !== 'unknown') request.summary = annotation;
          })
          .catch(() => {})
          .finally(() => { pagerDetailPending = false; });
      }
      return entry?.summary ?? (summary.state === 'unknown' ? { ...summary, state: 'checking' } : summary);
    }
    function syncPager(compact) {
      const host=document.querySelector('.lsf-main-view__annotation');
      const enabled = compact && ctx.settings.pager;
      const updateHost = enabled && host ? pager : bar;
      if (update.parentElement !== updateHost) updateHost.appendChild(update);
      if (!enabled) {
        pager.remove();
        if (nextChip.parentElement!==bar) bar.appendChild(nextChip);
        setNext(ctx.toolbar.status().state, ctx.toolbar.status().text, ctx.toolbar.status().title);
        pagerKey=''; return;
      }
      nextChip.remove();
      if (!host) { pager.remove(); pagerKey=''; return; }
      if (host.lastElementChild!==pager) host.appendChild(pager);
      const {tasks,id,near}=pagerTasks(), byId=new Map(tasks.map(t=>[t.id,t]));
      if (lastPagerTask !== id) {
        pagerDetails.delete(lastPagerTask);
        lastPagerTask = id;
        pagerTaskSince = performance.now();
      }
      const item=taskId=>{
        const task = byId.get(taskId) || tasksById.get(taskId);
        const current = taskId === id;
        const video = task?.data?.video || tasksById.get(taskId)?.data?.video || (current ? window.Htx?.task?.dataObj?.video : null);
        const key=mediaKey(video,window.location.href);
        if (key && ctx.cache?.has(key)) readDuration(key);
        const annotation = { ...pagerTaskAnnotation(taskId, task) };
        if (current && ctx.segments?.annotation()?.regionStore?.regions) {
          annotation.counts = {
            total: ctx.segments.rows().length,
            processed: ctx.segments.rows().filter(({ r }) => r.results?.some(processedSegmentResult)).length,
          };
          if (ctx.segments.rows().length && ['todo', 'unknown', 'checking'].includes(annotation.state)) annotation.state = 'working';
        }
        const live = current && window.Htx?.annotationStore?.selected;
        if (live?.pk && live.history?.hasChanges === false && annotation.state !== 'draft') {
          annotation.state = 'submitted';
          annotation.submitted = true;
        }
        const activeDuration = current ? editing().ws?.duration : null;
        const duration = activeDuration > 0 ? activeDuration : durations.get(key);
        const stat = pagerStat({ cached: !!key && (ctx.cache?.has(key) || (current && ctx.cache?.stored?.key === key)),
          progress: ctx.preload?.progress(key), failed: ctx.preload?.failed(key), duration });
        return { id:taskId, stat, annotation, duration: pagerTime(duration) };
      };
      const current=item(id), before=near.before.map(item), after=near.after.map(item);
      const warn=warning();
      const key=JSON.stringify([near,window.DM?.taskStore?.total,before,after,current,warn]);
      if (key===pagerKey) return;
      pagerKey=key;
      const nav=(label,taskId,previous)=>{
        const button=document.createElement('button'); button.type='button'; button.className='so-btn so-pager-nav';
        button.textContent = previous ? '‹ Prev' : 'Next ›';
        button.setAttribute('aria-label', label);
        const binding = ctx.settings.keys.prevTask;
        if (previous && ctx.settings.taskKeys && binding) {
          const label = bindingLabel(binding);
          button.setAttribute('aria-keyshortcuts', binding.replace(/Key([A-Z])$/, '$1').replace(/Digit([0-9])$/, '$1'));
          button.title = 'Press ' + label;
          ctx.layout?.appendShortcutHint(button, label, button.title);
        }
        button.disabled=taskId==null;
        if (taskId!=null) button.addEventListener('click',()=>go(taskId));
        return button;
      };
      const block=(item,current=false)=>{
        const el=document.createElement(current ? 'div' : 'button'); el.className='so-pager-block';
        el.dataset.state = item.stat.state;
        const { state, counts, submitted } = item.annotation;
        el.dataset.annotation = state;
        const annotationLabel = ({ submitted: 'Submitted', draft: 'Draft', working: 'In progress', todo: 'Unannotated', skipped: 'Skipped', checking: 'Checking…', unknown: 'Unknown' })[state];
        // top row: status dot + segments done; bottom row: download mark (only when there is one) + length
        const top = document.createElement('span'); top.className = 'so-pager-top';
        const dot = document.createElement('span'); dot.className = 'so-pager-dot'; dot.setAttribute('aria-hidden', 'true');
        const count = document.createElement('span'); count.className = 'so-pager-value';
        count.textContent = counts ? `${counts.processed}/${counts.total}` : '—';
        top.append(dot, count);
        const media = document.createElement('span'); media.className = 'so-pager-media';
        if (item.stat.state !== 'idle') {
          const cache = document.createElement('span'); cache.className = 'so-pager-cache';
          cache.setAttribute('aria-hidden', 'true');
          cache.innerHTML = PAGER_CACHE_ICONS[item.stat.state];
          media.append(cache);
        }
        const detail = item.stat.state === 'loading' ? item.stat.text.slice(2) : item.duration;
        if (detail) media.append(detail);
        const cacheLabel = item.stat.state === 'loading' ? `${item.stat.title} · ${item.stat.text.slice(2)}` : item.stat.title;
        const title = [item.id == null ? 'Current task' : `Task #${item.id}`, state === 'draft' && submitted ? 'Submitted with a draft' : annotationLabel,
          counts ? `${counts.processed} of ${counts.total} segments transcribed or skipped` : 'Segment count unavailable', cacheLabel].join(' · ');
        el.title = title;
        el.setAttribute('aria-label', title);
        if (current) { el.setAttribute('aria-current','page'); el.tabIndex=0; }
        else { el.type='button'; el.addEventListener('click',()=>go(item.id)); }
        el.append(top,media); return el;
      };
      const blocks=document.createElement('div'); blocks.className='so-pager-blocks';
      // position ("7 / 137") is a pop-up above the current tile: shown on hover / focus, and always while the
      // unsaved-work warning is up (it uses the same spot)
      const place = near.index<0 ? '—' : (near.index+1)+' / '+(window.DM?.taskStore?.total ?? near.count);
      const position=document.createElement('span'); position.className='so-pager-position'; position.setAttribute('role','status');
      position.textContent=warn ?? place;
      if (warn) position.classList.add('so-pager-warn');
      const currentBlock=block(current,true);
      currentBlock.setAttribute('aria-label',currentBlock.title+' · '+place); currentBlock.removeAttribute('title');   // the pop-up replaces the native tooltip
      currentBlock.appendChild(position);
      before.forEach(item=>blocks.appendChild(block(item)));
      blocks.appendChild(currentBlock);
      after.forEach(item=>blocks.appendChild(block(item)));
      const row=document.createElement('div'); row.className='so-pager-row';
      row.append(nav('Previous',near.before.at(-1),true),blocks,nav('Next',near.after[0],false));
      centre.replaceChildren(row);
    }
    return { sync: syncPager, go, pagerTasks, submitAction, isSaving, warning };
  } };
})();
