(() => {
  const ns = window.CinnamonBoost;
  ns.createScheduler = (beforePass = () => {}) => {
    const tick = new Map(), poll = new Map(), frame = new Map();
    const register = slots => (slot, fn) => {
      if (!Number.isFinite(slot) || slots.has(slot)) throw new Error('Invalid or duplicate scheduler slot: ' + slot);
      slots.set(slot, fn);
    };
    const run = slots => { beforePass(); [...slots.entries()].sort((a, b) => a[0] - b[0]).forEach(([, fn]) => fn()); };
    let started = false;
    return { onTick: register(tick), onPoll: register(poll), onFrame: register(frame), start() {
      if (started) throw new Error('Scheduler already started');
      started = true;
      setInterval(() => run(tick), 500);
      const loop = () => { if (!document.hidden) run(frame); setTimeout(() => requestAnimationFrame(loop), 33); };
      loop(); run(poll); setInterval(() => run(poll), 1000);
    } };
  };
  ns.createContext = () => {
    let storage = null; try { storage = window.localStorage; } catch (_) {}
    let raw = null;
    try { raw = JSON.parse(storage?.getItem('cinnamonBoost.settings') || 'null'); } catch (_) {}
    const settings = ns.settings.normalizeSettings(raw);
    const mode = Object.entries(settings).every(([k,v]) => k === 'preload' || k === 'keys' || !v) ? 'off' : (settings.compact ? 'full' : 'sound');
    const editing = () => {
      const ann = window.Htx?.annotationStore?.selected;
      const ws = ann && [...ann.names.values()].find(o => o?.type === 'audio')?._ws;
      return { ann, ws: ws && typeof ws.currentTime === 'number' ? ws : null };
    };
    const currentTaskId = () => window.Htx?.task?.id;
    const ctx = { window, document: window.document, mode, settings, scheduler: null, editing, currentTaskId,
      current: { taskId: undefined, ann: undefined, ws: undefined }, changed: { task: false, annotation: false, player: false },
      ui: { bar: null, playbackButton: 'button:is([aria-label="Play"], [aria-label="Pause"])' },
      cache: null, preload: null, layout: null, sound: null, segments: null, pager: null, gestures: null, overview: null, keyboard: null };
    ctx.refreshCurrent = () => {
      const { ann, ws } = editing(), taskId = currentTaskId(), previous = ctx.current;
      ctx.changed = { task: taskId !== previous.taskId, annotation: ann !== previous.ann, player: ws !== previous.ws };
      ctx.current = { taskId, ann, ws };
    };
    ctx.scheduler = ns.createScheduler(() => ctx.refreshCurrent());
    return ctx;
  };
})();
