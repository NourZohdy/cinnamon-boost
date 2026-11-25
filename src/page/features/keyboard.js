(() => {
  const { isHotkey, isEditingField, segmentShortcut, classifyHeader, cardOf, stepIndex } = window.CinnamonBoost.helpers;
  const { keyGroup } = window.CinnamonBoost.settings;
  window.CinnamonBoost.features.keyboard = { start(ctx) {
    const { window, document, editing } = ctx;
    const playbackButton = ctx.ui.playbackButton;
    const hintlessText = el => { const copy = el.cloneNode(true); copy.querySelectorAll('.so-hint').forEach(h => h.remove()); return copy.textContent.trim(); };
    window.addEventListener('keydown', e => { if (ctx.layout?.layoutOn && isHotkey(e)) { e.preventDefault(); ctx.layout.changeTasks(); } }, true);
    const heldKeys=new Set();
    let controlArmed=false;
    const editingFieldHasFocus = e => isEditingField(e.target) || isEditingField(document.activeElement);
    const button = 'button, select, summary, [role="button"]';
    window.addEventListener('keydown', e => {
      const el = document.activeElement;
      const typing = editingFieldHasFocus(e);
      const shortcut = segmentShortcut(e, typing, ctx.settings.keys, el?.matches('[data-so="trans"] textarea'));
      if (typing && !shortcut) {
        controlArmed = false;
        if (!ctx.settings.segmentKeys) return;
        // Keep the browser's edit action and stop Label Studio's global region deletion.
        if (e.key === 'Backspace' || e.key === 'Delete') e.stopImmediatePropagation();
        if (e.key === 'Enter' && !e.repeat && !e.isComposing && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey &&
            el?.tagName === 'TEXTAREA' && el.value.trim() && el.closest('[data-so="trans"]') &&
            document.body.classList.contains('so-compact')) {
          const add = el.closest('form')?.querySelector('[data-testid="textarea-add-button"]');
          if (add && !add.disabled) {
            e.preventDefault();
            e.stopImmediatePropagation();
            add.click();
            el.blur();
          }
        }
        return;
      }
      if (ctx.settings.segmentKeys && (e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && ctx.gestures?.deleteHighlight()) {
        e.preventDefault(); e.stopImmediatePropagation(); return;
      }
      if (e.key==='Control') {
        if (!e.repeat) controlArmed=heldKeys.size===0 && !e.altKey && !e.metaKey && !e.shiftKey;
      } else controlArmed=false;
      heldKeys.add(e.code || e.key);
      if (!shortcut || !ctx.settings[keyGroup(shortcut)]) return;
      if (shortcut === 'seekBack' || shortcut === 'seekForward') {
        if (el?.closest(button) || e.target?.closest?.(button)) return;
        const { ws } = editing();
        if (typeof ws?.seek !== 'function' || ws.loaded === false || !Number.isFinite(ws.duration) || ws.duration <= 0 || !Number.isFinite(ws.currentTime)) return;
        const { currentTime, duration } = ws;
        const range = ws.playing && (ws.player?.loop || ctx.segments?.playAllRange(ws));
        const start = Math.min(duration, Math.max(0, range?.start ?? 0));
        // Leave a little room for Label Studio to handle the range end during playback.
        const end = range ? Math.max(start, Math.min(duration, range.end - 0.001)) : duration;
        const time = Math.min(end, Math.max(start, currentTime + (shortcut === 'seekBack' ? -1 : 1)));
        e.preventDefault();
        e.stopImmediatePropagation();
        if (time !== currentTime) ws.seek(time);
        return;
      }
      if (shortcut === 'play') {
        const playback = document.querySelector(`.lsf-audio-tag ${playbackButton}`);
        if (!playback || playback.disabled || (el !== playback && el?.closest(button))) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) {
          if (playback.getAttribute('aria-label') === 'Pause') ctx.segments?.stopPlayAll(false);
          playback.click();
        }
        return;
      }
      if (shortcut === 'submit' || shortcut === 'prevTask') {
        if (shortcut === 'submit') {
          if (ctx.pager?.isSaving()) {
            e.preventDefault(); e.stopImmediatePropagation(); return;
          }
          const action = ctx.pager?.submitAction();
          if (!action) return;
          e.preventDefault(); e.stopImmediatePropagation();
          if (!e.repeat) action();
          return;
        }
        if (typeof window.DM?.setTask!=='function') return;
        const taskId = ctx.pager.pagerTasks().near.before.at(-1);
        if (taskId==null) return;
        e.preventDefault(); e.stopImmediatePropagation();
        if (!e.repeat) ctx.pager.go(taskId);
        return;
      }
      if (shortcut !== 'yes' && shortcut !== 'no') return;
      const answer=shortcut==='yes' ? 'Yes' : 'No';
      const ann=window.Htx?.annotationStore?.selected;
      const selected=[...(ann?.regionStore?.regions || [])].some(r=>r.type==='audioregion' && r.selected);
      const tag=ann?.names?.get?.('segment_has_code_switch');
      if (!selected || !tag) return;
      const choice=tag.children?.find?.(child=>child.value===answer);
      if (choice?.sel) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      let action=null;
      if (typeof choice?.onHotKey==='function') action=()=>choice.onHotKey();
      else if (typeof choice?.toggleSelected==='function') action=()=>choice.toggleSelected();
      else if (typeof choice?.setSelected==='function') action=()=>choice.setSelected(true);
      else {
        const root=document.querySelector('.lsf-main-view__annotation');
        const heading=[...(root?.querySelectorAll('h3') || [])].find(h=>classifyHeader(h.textContent)==='code');
        const card=heading && cardOf(heading,root);
        const label=[...(card?.querySelectorAll('label') || [])].find(el=>hintlessText(el)===answer);
        const input=label?.querySelector('input');
        if (input) action=()=>{ if (!input.checked) input.click(); };
      }
      if (!action) return;
      e.preventDefault(); e.stopImmediatePropagation();
      try { action(); } catch (err) { console.warn('[Cinnamon Boost] code switching choice failed',err); }
    }, true);
    window.addEventListener('keyup', e => {
      if (!ctx.settings.segmentKeys) return;
      heldKeys.delete(e.code || e.key);
      if (editingFieldHasFocus(e)) {
        controlArmed = false;
        if (e.key === 'Backspace' || e.key === 'Delete') e.stopImmediatePropagation();
        return;
      }
      if (e.key!=='Control') return;
      const armed=controlArmed; controlArmed=false;
      const ann=window.Htx?.annotationStore?.selected;
      if (!armed || ![...(ann?.regionStore?.regions || [])].some(r=>r.type==='audioregion' && r.selected)) return;
      const box=document.querySelector('[data-so="trans"] textarea');
      if (box) { box.focus({preventScroll:true}); box.setSelectionRange(box.value.length,box.value.length); }
    }, true);
    window.addEventListener('mousedown',()=>{ controlArmed=false; },true);
    window.addEventListener('blur',()=>{ controlArmed=false; heldKeys.clear(); });
    // Buttons and fields, and movement past the last segment, keep native key behavior.
    window.addEventListener('keydown', e => {
      if (!ctx.settings.segmentKeys || !ctx.segments || !document.body.classList.contains('so-compact')) return;
      const shortcut = segmentShortcut(e, editingFieldHasFocus(e), ctx.settings.keys);
      if (shortcut !== 'nextSegment' && shortcut !== 'prevSegment') return;
      const el=document.activeElement;
      const segRows = ctx.segments.rows();
      if (!segRows.length || !(!el || el===document.body || ctx.gestures?.onWave(el) || el.closest?.('.so-segs-row'))) return;
      const i=stepIndex(segRows.length, segRows.findIndex(row=>row.r.selected), shortcut === 'prevSegment' ? -1 : 1);
      if (i<0) return;
      e.preventDefault(); e.stopImmediatePropagation();
      ctx.segments.openAndPlay(i);
    }, true);
    return { hintlessText };
  } };
})();
