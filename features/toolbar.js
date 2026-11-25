(() => {
  window.LSSoundOnly.features.toolbar = { start(ctx) {
    const { window, document } = ctx;
    const { UPDATE_KEY, isNewer, releaseUrl } = window.LSSoundOnly.update;
    const playbackButton = ctx.ui.playbackButton;
    // --- toolbar (lives in LS's bottom bar, between its icons and Submit) ---
    // styles live in content.css (manifest). Runtime geometry measured from LS goes into one generated rule:
    const geometry = document.createElement('style'); geometry.id = 'so-geometry'; document.head.appendChild(geometry);
    const geo = {};
    const setGeometry = (vars) => {
      for (const [k, v] of Object.entries(vars)) { if (v == null) delete geo[k]; else geo[k] = Math.round(v) + 'px'; }
      const text = ':root{' + Object.entries(geo).map(([k, v]) => `--so-geo-${k}:${v}`).join(';') + '}';
      if (geometry.textContent !== text) geometry.textContent = text;
    };
    const bar = document.createElement('div');
    bar.className = 'so-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Sound tools');
    // Clicks on the bar must never reach LS (it would unselect the segment or act on the page).
    // Keys are left alone so shortcuts keep working after a click.
    for (const event of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      bar.addEventListener(event, e => e.stopPropagation());
    }
    // A mouse click must not move keyboard focus onto the bar (Tab still reaches it).
    bar.addEventListener('mousedown', e => e.preventDefault());
    const update = document.createElement('button');
    update.type = 'button';
    update.className = 'so-btn so-update';
    update.title = 'A new version of LS Sound only is available. Click to see how to update.';
    bar.append(update);
    const readUpdate = () => {
      try { return JSON.parse(window.localStorage.getItem(UPDATE_KEY)); } catch (_) { return null; }
    };
    const hasUpdate = record => record?.newer === true && isNewer(record.latest, record.current);
    const showUpdate = () => {
      const record = readUpdate();
      update.hidden = !hasUpdate(record);
      if (!update.hidden && update.textContent !== `Update ${record.latest}`) update.textContent = `Update ${record.latest}`;
    };
    update.addEventListener('mousedown', e => e.preventDefault());
    update.addEventListener('click', () => {
      const record = readUpdate();
      if (hasUpdate(record)) window.open(releaseUrl(record.url), '_blank', 'noopener');
    });
    showUpdate();
    ctx.scheduler.onPoll(8, showUpdate);
    const nextChip = document.createElement('div');
    nextChip.className = 'so-next';
    nextChip.setAttribute('role', 'status');
    let nextStatus = { state: 'idle', text: '', title: '' };
    const setNext = (state, text, title = '') => {
      nextStatus = { state, text, title };
      const warn = (!document.body.classList.contains('so-compact') || !ctx.settings.pager) && ctx.pager?.warning();
      const label = warn ? warn : text;
      nextChip.dataset.state = warn ? 'warning' : state;
      if (nextChip.textContent !== label) nextChip.textContent = label;
      nextChip.title = warn ? warn : title;
      nextChip.hidden = !label;
    };

    // Compact mode waits for the audio controls to remount during task transitions.
    // Original mode keeps the toolbar below the video timeline or beside Submit.
    const place = () => {
      bar.hidden = ![...bar.children].some(child => !child.hidden);
      if (ctx.layout?.value === 'compact') {
        const audio = document.querySelector('.lsf-audio-tag[data-so="audio"]');
        const play = audio?.querySelector(playbackButton);
        const settings = audio?.querySelector('button[aria-label="Audio settings"]');
        let row = play?.parentElement;
        while (row && row !== audio && !([...row.children].filter(el => el !== bar).length === 3 && settings && row.contains(settings))) row = row.parentElement;
        if (row && row !== audio) {
          const child = [...row.children].find(el => el.contains(play));
          if (child && bar.previousElementSibling !== child) child.after(bar);
          bar.classList.add('so-inline', 'so-player'); row.classList.add('so-aplayer'); setGeometry({'float-left': null, 'float-bottom': null}); return;
        }
        bar.remove();
        return;
      }
      bar.classList.remove('so-player');
      const seeker = document.querySelector('.lsf-seeker');
      if (seeker?.parentElement) {
        if (bar.previousElementSibling !== seeker) seeker.after(bar);
        bar.classList.add('so-inline');
        setGeometry({'float-left': null, 'float-bottom': null});
        return;
      }
      bar.classList.remove('so-inline');
      if (bar.parentElement !== document.body) document.body.appendChild(bar);
      const submit = [...document.querySelectorAll('button')].find(b => /^\s*Submit\s*$/.test(b.textContent) && !bar.contains(b));
      const bottom = submit?.closest('.lsf-bottombar') || submit?.parentElement?.parentElement;
      if (!submit || !bottom) return;
      const s = submit.getBoundingClientRect(), bb = bottom.getBoundingClientRect();
      let left = bb.left + 8;
      for (const el of bottom.querySelectorAll('button, [role="button"], svg, span, a')) {
        if (el === submit || submit.contains(el) || bar.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width && r.width < 200 && r.right < s.left - 20) left = Math.max(left, r.right + 12);   // icons, not wrappers
      }
      const width = bar.offsetWidth;
      const fits = left + width <= s.left - 8;
      setGeometry({
        'float-left': fits ? left : Math.max(8, s.left - 8 - width),
        'float-bottom': fits ? window.innerHeight - bb.bottom + (bb.height - bar.offsetHeight) / 2 : window.innerHeight - bb.top + 6,
      });
    };
    ctx.ui.bar = bar;
    ctx.scheduler.onTick(5, place);
    return { bar, update, nextChip, setGeometry, place, setNext, status: () => nextStatus };
  } };
})();
