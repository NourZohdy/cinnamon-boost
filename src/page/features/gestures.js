(() => {
  const { lengthText } = window.CinnamonBoost.helpers;
  window.CinnamonBoost.features.gestures = { start(ctx) {
    const { window, document, editing } = ctx;
    // Clear: closes the open segment (same as Esc) and removes the grey wave highlight that a drag
    // leaves when it is not made into a segment (LS keeps it as a non-region 'segment'). Never deletes a segment.
    const waveHighlight = ws => ws?.regions?.list?.some?.(r => r && !r.isRegion);
    const hasSelection = () => { const { ann, ws } = editing(); return !!ann?.regionStore?.selection?.size || !!waveHighlight(ws); };
    // keepHighlights: a click on empty space closes the segment and detaches playback but leaves the highlights;
    // only the Clear button removes them
    const clearSelection = ({ keepHighlights = false } = {}) => {
      const { ann, ws } = editing();
      ann?.unselectAll?.();
      // a highlight that was clicked stays 'selected' (darker, edge lines): unselect it so it looks like the rest
      for (const h of ws?.regions?.list || []) if (h && !h.isRegion && h.selected) { try { h.handleSelected(false); } catch (_) {} }
      if (!keepHighlights && waveHighlight(ws)) ws.regions.clearSegments();
      if (ws?.player && ws.player.loop) ws.player.loop = null;   // detach: playback leaves the segment / highlight range and goes on
      ctx.sound?.syncLoop();
    };
    // Wave gestures (LS moves the playhead in a click handler, after the mouse is released).
    // - Ruler (top strip with the times): press / drag moves the playhead like a sound editor; LS never sees it,
    //   so no highlight is drawn there. The time comes from LS's own handleSeek, fed the pointer position.
    // - Drag on the wave (new highlight, moving / resizing one): only selects. The click LS would use to jump
    //   the playhead is swallowed, so playback goes on without a hiccup.
    // - Plain click on a highlight or a segment: plays it from its start. Plain click elsewhere: LS's seek.
    // ponytail: ruler height read from LS's timeline (32 px here); if LS changes its ruler, this is the knob
    const rulerHeight = ws => ws?.timeline?.height || 32;
    let waveDown = null, scrub = null, swallowClick = false, rulerCanvas = null;
    // An explicit seek takes over from range playback while keeping the annotation open.
    const releasePlaybackRange = ws => {
      ctx.segments?.stopPlayAll(false);
      if (ws.player?.loop) ws.player.loop = null;
    };
    const onWave = t => t?.tagName === 'CANVAS' && !t.classList.contains('so-ov') && !!t.closest('.lsf-audio-tag');
    const onRuler = (e, ws) => onWave(e.target) && e.clientY - e.target.getBoundingClientRect().top < rulerHeight(ws);
    const showRulerCursor = canvas => {
      if (rulerCanvas === canvas) return;
      rulerCanvas?.classList.remove('so-scrub-cursor');
      rulerCanvas = canvas;
      canvas?.classList.add('so-scrub-cursor');
    };
    const scrubTo = gesture => {
      const { ws, canvas, x, y } = gesture;
      const b = canvas.getBoundingClientRect();
      const clientX = Math.min(b.right - 1, Math.max(b.left, x));
      if (gesture.lastX === clientX) return;
      gesture.lastX = clientX;
      ws.visualizer?.handleSeek?.({ clientX, clientY: y, target: canvas });
    };
    const stop = e => { e.stopImmediatePropagation(); e.preventDefault(); };
    window.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      swallowClick = false;
      if (!onWave(e.target)) return;
      const { ws, ann } = editing();
      if (!ws) return;
      if (onRuler(e, ws)) {
        stop(e);
        showRulerCursor(e.target);
        releasePlaybackRange(ws);
        scrub = { ws, canvas: e.target, x: e.clientX, y: e.clientY, raf: 0 };
        scrubTo(scrub);
        return;
      }
      const area = [...(ws.regions?.hoveredRegions || [])].filter(r => r.end > r.start).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0] || null;
      const region = area?.isRegion && [...(ann?.regionStore?.regions || [])].find(r => r.type === 'audioregion' && (r.id === area.id || (Math.abs(r.start - area.start) < 0.01 && Math.abs(r.end - area.end) < 0.01)));
      waveDown = {
        region: region?.selected ? region : null, ann, modifiers: e.shiftKey || e.ctrlKey || e.altKey || e.metaKey,
        x: e.clientX, y: e.clientY,
        ws, snapshot: new Map((ws.regions?.list || []).filter(Boolean).map(r => [r, [r.start, r.end]])),
        // shortest area under the pointer, so a highlight drawn over a segment wins
        area,
      };
    }, true);
    window.addEventListener('pointermove', e => {
      if (waveDown && Math.hypot(e.clientX - waveDown.x, e.clientY - waveDown.y) > 4) waveDown.dragged = true;
      if (!scrub) {
        const ws = !waveDown && onWave(e.target) && editing().ws;
        showRulerCursor(ws && onRuler(e, ws) ? e.target : null);
        return;
      }
      stop(e);
      scrub.x = e.clientX;
      scrub.y = e.clientY;
      if (!scrub.raf) scrub.raf = requestAnimationFrame(() => { scrub.raf = 0; scrubTo(scrub); });
    }, true);
    window.addEventListener('pointerout', e => { if (e.target === rulerCanvas && !scrub) showRulerCursor(null); }, true);
    const cancelWaveGesture = () => {
      if (scrub?.raf) cancelAnimationFrame(scrub.raf);
      scrub = waveDown = null;
      showRulerCursor(null);
    };
    window.addEventListener('pointercancel', cancelWaveGesture, true);
    window.addEventListener('blur', cancelWaveGesture);
    for (const type of ['mousedown', 'mousemove', 'mouseup']) window.addEventListener(type, e => { if (scrub) stop(e); }, true);
    window.addEventListener('pointerup', e => {
      if (scrub) {
        stop(e);
        cancelAnimationFrame(scrub.raf);
        scrub.x = e.clientX;
        scrub.y = e.clientY;
        scrubTo(scrub);
        showRulerCursor(onRuler(e, scrub.ws) ? e.target : null);
        scrub = null;
        swallowClick = true;
        return;
      }
      const g = waveDown; waveDown = null;
      if (!g) return;
      const { ws } = editing();
      if (ws !== g.ws) return;
      requestAnimationFrame(syncAddAll);
      if (g.dragged || Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4) { swallowClick = true; return; }
      if (g.modifiers || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (!g.area) {
        if (onWave(e.target)) releasePlaybackRange(ws);
        return;
      }
      if (g.region) swallowClick = true;
      setTimeout(() => {
        if (editing().ws !== ws) return;
        if (g.region && !g.region.selected) { keepPlaying(ws); g.ann.selectArea(g.region); }
        if (ws.playing) ws.pause();           // play(range) is ignored while playing
        ws.play(g.area.start, g.area.end);
      }, 0);
    }, true);
    window.addEventListener('click', e => { if (swallowClick && onWave(e.target)) { swallowClick = false; e.stopImmediatePropagation(); } }, true);
    // Highlights -> segments through LS's own path: the label is switched on, the audio tag's addRegion() turns a
    // highlight into a labelled segment (and switches the label off again, so it is switched on before each one).
    // open = select the first new segment afterwards.
    // ponytail: uses the first label of the Labels tag (this project has one, 'Speaker segment')
    function makeSegments(highlights, open) {
      const { ann, ws } = editing();
      const tags = ann ? [...ann.names.values()] : [];
      const tag = tags.find(o => o?.type === 'audio'), label = tags.find(o => o?.type === 'labels')?.children?.[0];
      if (!ws || !highlights.length || typeof tag?.addRegion !== 'function' || typeof label?.setSelected !== 'function') return false;
      const was = !!label.selected;
      let created = null;
      keepPlaying(ws);
      // Changing the label also acts on LS's selected wave items. Release them before arming it.
      const deselectWave = () => {
        for (const item of ws.regions?.selected || []) item.handleSelected(false);
      };
      try {
        for (const h of highlights) {
          try {
            deselectWave();
            if (!label.selected) label.setSelected(true);
            const region = tag.addRegion(h);
            created ||= region;
          } catch (err) { console.warn('[Cinnamon Boost] make segment failed', err); }
        }
      } finally {
        if (label.selected !== was) {
          deselectWave();
          label.setSelected(was);
        }
        syncAddAll();
      }
      if (open && created) setTimeout(() => {
        if (editing().ws !== ws) return;
        keepPlaying(ws);
        ann.selectArea(created);
      }, 50);
      return !!created;
    }
    // Double-click on a highlight: make it a segment and open it.
    window.addEventListener('dblclick', e => {
      const { ws } = editing();
      if (!ws || !onWave(e.target)) return;
      if (onRuler(e, ws)) { stop(e); return; }
      const highlight = [...(ws.regions?.hoveredRegions || [])].find(r => r && !r.isRegion);
      if (highlight && makeSegments([highlight], true)) { e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
    // 'Add all' beside '+ Add Segment': every highlight on the wave becomes a segment at once (none opened).
    const addAllBtn = document.createElement('button');
    addAllBtn.type = 'button';
    addAllBtn.className = 'so-addall';
    addAllBtn.title = 'Add all highlights on the wave as segments at once';
    addAllBtn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    addAllBtn.addEventListener('click', e => {
      e.stopPropagation();
      const { ws } = editing();
      makeSegments([...(ws?.regions?.list || [])].filter(r => r && !r.isRegion).sort((a, b) => a.start - b.start), false);
    });
    function syncAddAll() {
      const labels = document.body.classList.contains('so-compact') && document.querySelector('.lsf-labels[data-so="labels"]');
      if (!labels) { addAllBtn.remove(); return; }
      if (addAllBtn.parentElement !== labels || labels.lastElementChild !== addAllBtn) labels.appendChild(addAllBtn);   // inside LS's label row (its parent is display:contents)
      const n = (editing().ws?.regions?.list || []).filter(r => r && !r.isRegion).length;
      const text = n ? `Add all (${n})` : 'Add all';
      if (addAllBtn.textContent !== text) addAllBtn.textContent = text;
      addAllBtn.disabled = !n;
    }
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'so-btn so-clear';
    clearBtn.textContent = 'Clear';
    clearBtn.title = 'Clear: closes the open segment and removes the wave highlights. A click on empty space only closes the segment. Nothing is deleted.';
    clearBtn.addEventListener('click', () => { clearSelection(); syncAddAll(); });
    // A click on empty space closes the open segment and detaches playback (highlights stay: only Clear removes them).
    // Only plain clicks whose target IS one of our layout containers: never cards, controls, text, the wave or the video.
    let downAt = null;
    window.addEventListener('pointerdown', e => { downAt = e.button === 0 ? [e.clientX, e.clientY] : null; }, true);
    window.addEventListener('click', e => {
      if (!document.body.classList.contains('so-compact') || e.defaultPrevented || e.button !== 0) return;
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || !downAt) return;
      if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;           // a drag, not a click
      if (String(window.getSelection?.() || '')) return;                                  // selecting text
      const t = e.target;
      const blank = t?.matches?.('.lsf-main-view__annotation, [data-so="root"], [data-so="flat"], [data-so="vcol"], [data-so="acol"]');
      const { ann, ws } = editing();
      if (blank && (ann?.regionStore?.selection?.size || ws?.player?.loop || ws?.regions?.list?.some?.(h => h && !h.isRegion && h.selected))) clearSelection({ keepHighlights: true });
    });
    // ponytail: rewrite LS's tooltip text with the length of the area being dragged or hovered.
    let tooltip = null;
    const tooltipObserver = new MutationObserver(() => {
      const { ws } = editing();
      if (!ws || !tooltip) return;
      let area;
      if (waveDown?.dragged && waveDown.ws === ws) {
        const regions = (ws.regions?.list || []).filter(Boolean);
        area = regions.find(r => { const before = waveDown.snapshot.get(r); return before && (r.start !== before[0] || r.end !== before[1]); });
        if (!area) area = regions.filter(r => !r.isRegion).at(-1);
      } else {
        area = [...(ws.regions?.hoveredRegions || [])].filter(r => r && r.end > r.start).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
      }
      const text = area && lengthText(area.end - area.start);
      if (text && tooltip.textContent !== text) tooltip.textContent = text;
    });
    const syncTooltip = () => {
      const next = document.querySelector('body > span[id^="tooltip-"]');
      if (next === tooltip) return;
      tooltipObserver.disconnect();
      tooltip = next;
      if (tooltip) tooltipObserver.observe(tooltip, { childList: true, characterData: true, subtree: true });
    };
    // ponytail: overrides LS's 'auto-play new segments' setting on every player (the user wants drags to only select);
    // make it a toolbar switch if someone wants LS's behaviour back
    const noAutoPlay = () => { const st = editing().ws?.settings; if (st?.autoPlayNewSegments) st.autoPlayNewSegments = false; };
    // Selecting or unselecting a segment / highlight never stops playback. LS's handleSelected (run on click,
    // on the release after a resize, on unselect) calls player.pause(); while it runs, that pause is ignored.
    // The Pause button, Space and the end of the file still pause as usual.
    let selecting = false;
    const keptPlayers = new WeakSet();
    function keepPlaying(ws) {
      const player = ws?.player;
      if (player && !keptPlayers.has(player) && typeof player.pause === 'function') {
        keptPlayers.add(player);
        const pause = player.pause;
        player.pause = function (...args) { return selecting ? undefined : pause.apply(this, args); };
      }
      // handleSelected is an own (arrow-function) property of every segment and highlight, so each one is
      // wrapped once; new highlights are picked up on the next frame (this runs every 33 ms)
      for (const item of ws?.regions?.list || []) {
        if (item.soKeepPlaying || typeof item.handleSelected !== 'function') continue;
        const handleSelected = item.handleSelected;
        item.handleSelected = function (...args) { selecting = true; try { return handleSelected.apply(this, args); } finally { selecting = false; } };
        item.soKeepPlaying = true;
      }
    }
    ctx.toolbar.bar.append(clearBtn);
    ctx.scheduler.onTick(2, noAutoPlay);
    ctx.scheduler.onTick(3, syncAddAll);
    ctx.scheduler.onFrame(0, () => keepPlaying(editing().ws));
    // Backspace / Delete removes ONE highlight: the selected one, else the newest (LS's own key clears them all).
    // A selected segment is left to LS, which deletes it as before.
    const deleteHighlight = () => {
      const { ann, ws } = editing();
      const highlights = (ws?.regions?.list || []).filter(r => r && !r.isRegion);
      if (!highlights.length || ann?.regionStore?.selection?.size) return false;
      const selected = highlights.filter(h => h.selected);
      for (const h of selected.length ? selected : [highlights.at(-1)]) ws.regions.removeRegion(h.id, true);
      if (ws.player?.loop) ws.player.loop = null;   // the range being replayed may be gone
      syncAddAll();
      clearBtn.disabled = !hasSelection();
      return true;
    };
    return { deleteHighlight, clearSelection, hasSelection, syncClear: () => { clearBtn.disabled = !hasSelection(); }, syncAddAll, makeSegments, keepPlaying, noAutoPlay, releasePlaybackRange, onWave, onRuler, syncTooltip, containsTooltipTarget: target => tooltip?.contains(target) };
  } };
})();
