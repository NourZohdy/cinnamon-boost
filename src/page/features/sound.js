(() => {
  const { checkShape, mediaKey, ICON, untie, retie, clampSpeed, installSeekFilter, skipTinySeeks } = window.CinnamonBoost.helpers;
  window.CinnamonBoost.features.sound = { start(ctx) {
    const { window, document, editing } = ctx;
    const { bar } = ctx.toolbar;
    let warned = false, pending = false, stuck = false;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'so-btn so-toggle';
    button.setAttribute('aria-label', 'Speed mode');
    bar.appendChild(button);

    function findBinding() {
      const names = window.Htx?.annotationStore?.selected?.names;
      const values = names && typeof names.values === 'function' ? [...names.values()] : [];
      const audioObj = values.find(value => value?.type === 'audio');
      if (!audioObj) return { status: 'none' };
      const videoObj = values.find(value => value?.type === 'video');
      const sm = audioObj.syncManager;
      const video = document.querySelector('video');
      const audio = document.querySelector('audio');
      if (!videoObj || videoObj.syncManager !== sm || !video || !audio ||
          !checkShape(sm, audioObj.name, videoObj.name) ||
          sm.syncTargets.get(audioObj.name) !== audioObj ||
          (sm.syncTargets.get(videoObj.name) || sm.__cinnamonBoost?.removed.get(videoObj.name)) !== videoObj) {
        return { status: 'bad' };
      }
      return { status: 'ok', sm, video, audio, audioName: audioObj.name };
    }

    function render() {
      const binding = findBinding();
      button.hidden = binding.status === 'none';
      button.disabled = binding.status === 'bad' || pending;
      if (binding.status === 'bad') {
        button.innerHTML = `${ICON.flash}<span>Speed mode: n/a</span>`;
        button.dataset.label = 'n/a';         // so the label is redrawn when the page is ready again
        button.title = 'The audio and video sync setup is unavailable or unsupported.';
        button.setAttribute('aria-pressed', 'false');
        if (!warned) {
          console.warn('[Cinnamon Boost] Unsupported audio/video sync setup');
          warned = true;
        }
      } else if (binding.status === 'ok') {
        const on = !!binding.sm.__cinnamonBoost;
        const label = pending ? 'Picture catching up…' : on && stuck ? 'Picture stuck – retry' : 'Speed mode';
        if (button.dataset.label !== label) {
          button.dataset.label = label;
          button.innerHTML = `${ICON.flash}<span>${label}</span>`;
        }
        button.title = ctx.cache?.stored && binding.audio.currentSrc === ctx.cache?.stored.blobUrl &&
          binding.video.currentSrc === ctx.cache?.stored.blobUrl &&
          ctx.cache?.stored.key === mediaKey(window.Htx?.task?.dataObj?.video, window.location.href)
          ? 'File loaded locally' : '';
        button.title = 'Speed mode: detaches the video from the audio, so the wave plays without waiting for the picture.' +
          (button.title ? `\n${button.title}` : '');
        button.setAttribute('aria-pressed', String(on));
      }
    }

    function waitForPicture(video, audio) {
      return new Promise(resolve => {
        let timer;
        const finish = ok => {
          clearTimeout(timer);
          video.removeEventListener('seeked', onProgress);
          video.removeEventListener('timeupdate', onProgress);
          resolve(ok);
        };
        const onProgress = () => { if (!video.seeking) finish(true); };
        video.addEventListener('seeked', onProgress);
        video.addEventListener('timeupdate', onProgress);
        timer = setTimeout(() => finish(false), 20000);
        try { video.currentTime = audio.currentTime; } catch (_) { finish(false); }
      });
    }

    button.addEventListener('click', async () => {
      const binding = findBinding();
      if (binding.status !== 'ok' || pending) return;
      const { sm, video, audio } = binding;
      const state = sm.__cinnamonBoost;
      if (!state) {
        if (untie(sm, binding.audioName)) video.pause();
        stuck = false;
        render();
        return;
      }
      pending = true;
      stuck = false;
      render();
      let ok = true;
      for (let tries = 0; tries < 2 && Math.abs(video.currentTime - audio.currentTime) >= 0.05; tries++) {
        if (!await waitForPicture(video, audio)) { ok = false; break; }
      }
      video.playbackRate = audio.playbackRate;
      if (ok && !audio.paused) {
        try { await video.play(); } catch (_) { ok = false; }
      }
      if (ok) retie(sm, state);
      else stuck = true;
      pending = false;
      render();
    });
    // --- speed (the project hides LS's own) and next-task status ---
    const SPEED_MIN = 0.5, SPEED_MAX = 3, SPEED_STEP = 0.25;
    let speed = 1;
    try { speed = clampSpeed(+window.localStorage.getItem('cinnamonBoost.speed') || 1); } catch (_) {}
    const speedSeg = document.createElement('label');
    speedSeg.className = 'so-speed';
    speedSeg.title = 'Playback speed, same pitch. Slower: easier to hear where speech starts and ends. Double-click: back to 1×';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'so-speed-range';
    slider.min = String(SPEED_MIN); slider.max = String(SPEED_MAX); slider.step = String(SPEED_STEP);
    slider.setAttribute('aria-label', 'Playback speed');
    const speedOut = document.createElement('output');
    speedOut.className = 'so-speed-value';
    speedSeg.append(slider, speedOut);
    // LS's player rate moves the audio and the synced video together and keeps the pitch.
    // Synced with LS's own slider (gear menu): whichever was set last wins, and the choice
    // carries over to the next task. We only write the rate on a slider move or a new task.
    let speedFor = null, seenRate = null;
    const saveSpeed = () => { try { window.localStorage.setItem('cinnamonBoost.speed', String(speed)); } catch (_) {} };
    const showSpeed = rate => {
      if (document.activeElement !== slider && slider.value !== String(rate)) slider.value = String(rate);
      const text = `${+rate.toFixed(2)}×`;
      if (speedOut.textContent !== text) speedOut.textContent = text;
    };
    const applySpeed = () => {
      const { ws } = editing();
      if (!ws) { showSpeed(speed); return; }
      if (ws !== speedFor) {                 // new task / new player: carry the choice over
        speedFor = ws;
        if (ws.rate !== speed) ws.rate = speed;
      } else if (ws.rate !== seenRate && seenRate !== null) {
        speed = ws.rate;                     // changed with LS's slider: follow it
        saveSpeed();
      }
      seenRate = ws.rate;
      showSpeed(ws.rate);
    };
    const setSpeed = s => {
      speed = clampSpeed(s);
      saveSpeed();
      const { ws } = editing();
      if (ws) { ws.rate = speed; seenRate = speed; }
      showSpeed(speed);
    };
    slider.addEventListener('input', () => setSpeed(+slider.value));
    slider.addEventListener('change', () => slider.blur());   // give the keyboard back to the page
    slider.addEventListener('dblclick', () => { setSpeed(1); slider.value = '1'; slider.blur(); });
    // the bar cancels mousedown (keeps focus off it); the slider needs it to drag
    for (const event of ['pointerdown', 'mousedown']) slider.addEventListener(event, e => e.stopPropagation());

    // Loop = LS's own "Loop Regions" setting (gear menu): a selected segment replays until
    // stopped instead of playing once. LS keeps it in localStorage, so it survives reloads.
    const LS_SETTINGS = 'ls:audio-tag:settings';
    const loopBtn = document.createElement('button');
    loopBtn.type = 'button';
    loopBtn.className = 'so-btn so-toggle';
    loopBtn.setAttribute('aria-label', 'Loop');
    loopBtn.innerHTML = `${ICON.loop}<span>Loop</span>`;
    loopBtn.title = 'Loop: a selected segment replays until you stop it. Off: it plays once.';
    loopBtn.addEventListener('click', () => {
      const { ws } = editing();
      if (!ws?.settings) return;
      ws.settings.loopRegion = !ws.settings.loopRegion;
      try {
        const saved = JSON.parse(window.localStorage.getItem(LS_SETTINGS) || '{}');
        saved.loopRegion = ws.settings.loopRegion;
        window.localStorage.setItem(LS_SETTINGS, JSON.stringify(saved));
      } catch (_) {}
      syncLoop();
    });
    const syncLoop = () => {
      const settings = editing().ws?.settings;
      loopBtn.disabled = !settings;
      loopBtn.setAttribute('aria-pressed', String(!!settings?.loopRegion));
      ctx.gestures?.syncClear();
    };
    // Where each synced player is right now, for the seek-echo filter.
    const timeOf = t => t.type === 'audio' ? t._ws?.currentTime
      : t.type === 'video' ? document.querySelector('video')?.currentTime : NaN;

    ctx.scheduler.onTick(0, applySpeed);
    ctx.scheduler.onTick(1, syncLoop);
    ctx.scheduler.onPoll(1, () => { const binding = findBinding(); if (binding.status === 'ok') installSeekFilter(binding.sm, timeOf); });
    ctx.scheduler.onPoll(2, () => { skipTinySeeks(document.querySelector('audio')); });
    ctx.scheduler.onPoll(6, render);
    return { loopBtn, speedSeg, applySpeed, syncLoop, render };
  } };
})();
