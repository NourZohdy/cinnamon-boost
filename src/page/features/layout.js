(() => {
  const { svg, readPref, writePref, classifyHeader, cardOf, noteReason, sideNote, fixedSlot } = window.CinnamonBoost.helpers;
  const { bindingLabel } = window.CinnamonBoost.settings;
  window.CinnamonBoost.features.layout = { start(ctx) {
    const { window, document } = ctx;
    const MODE = ctx.mode;
    const { place, setGeometry } = ctx.toolbar;
    // --- compact layout ---
    let storage; try { storage = window.localStorage; } catch (_) { storage = null; }
    const layoutOn = MODE === 'full';        // 'sound' mode: LS's own layout, no layout buttons, no Alt+L
    let layout = layoutOn ? readPref(storage, 'soundOnly.layout', ['compact', 'original'], 'compact') : 'original';
    let tasks = layoutOn ? readPref(storage, 'soundOnly.tasks', ['show', 'hide'], 'show') : 'show';
    let structureWarned = false;
    const lbar = document.createElement('div'); lbar.className = 'so-lbar';
    for (const event of ['pointerdown', 'mousedown', 'mouseup', 'click']) lbar.addEventListener(event, e => e.stopPropagation());
    lbar.addEventListener('mousedown', e => e.preventDefault());
    const toggle = (name, icon, action) => { const b = document.createElement('button'); b.type='button'; b.className='so-btn'; b.title=name; b.setAttribute('aria-label',name); b.innerHTML=svg(icon); b.addEventListener('click',action); lbar.appendChild(b); return b; };
    const changeTasks = () => { tasks=tasks==='show'?'hide':'show'; writePref(storage,'soundOnly.tasks',tasks); syncLayout(); };
    const tasksBtn = toggle('Task list','<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10"/>',changeTasks);
    const layoutBtn = toggle('Layout','<rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/>',() => { layout=layout==='compact'?'original':'compact'; writePref(storage,'soundOnly.layout',layout); syncLayout(); place(); });
    const setAttr = (el, name, value) => { if (el.getAttribute(name) !== value) el.setAttribute(name,value); };
    function appendShortcutHint(host, key, title) {
      if (!host || !key || host.querySelector('.so-hint')) return;
      const hint = document.createElement('sup');
      hint.className = 'lsf-hint so-hint';
      const wide = key.length > 1;
      hint.textContent = wide ? key.toLowerCase() : `[${key.toLowerCase()}]`;
      if (wide) hint.classList.add('so-hint-wide');
      hint.title = title;
      host.appendChild(hint);
    }

    // Plain segment shortcuts apply wherever the segment panel is available.
    const note=document.createElement('div'); note.className='so-note';
    const note2=document.createElement('div'); note2.className='so-note2';
    const infos=new Map();
    function info(key, host, value, popHost=host) {
      if (!host || !value) return;
      let pair=infos.get(key);
      if (!pair) {
        const button=document.createElement('button'), pop=document.createElement('div');
        button.type='button'; button.className='so-info'; button.textContent='ⓘ';
        pop.id='so-info-'+key; pop.className='so-popover'; pop.setAttribute('popover',''); button.setAttribute('popovertarget',pop.id);
        for (const event of ['pointerdown','mousedown','mouseup','click']) button.addEventListener(event,e=>e.stopPropagation());
        button.addEventListener('mousedown',e=>e.preventDefault());
        pair={button,pop}; infos.set(key,pair);
      }
      if (pair.button.parentElement!==host) host.appendChild(pair.button);
      if (pair.pop.parentElement!==popHost) popHost.appendChild(pair.pop);   // never inside a <label>: a click there would pick the option
      if (pair.pop.textContent!==value) pair.pop.textContent=value;
      pair.button.title=value; setAttr(pair.button,'aria-label',value);
    }
    function syncLayout() {
      const top=document.querySelector('.lsf-topbar'), bottom=document.querySelector('.lsf-bottombar');
      if (layoutOn && top && top.firstElementChild !== lbar) top.prepend(lbar);
      document.body.classList.toggle('so-notasks',tasks==='hide'); setAttr(tasksBtn,'aria-pressed',String(tasks==='show'));
      const root=document.querySelector('.lsf-main-view__annotation > div:first-child');
      const audio=root?.querySelector('.lsf-audio-tag'), video=root?.querySelector('.lsf-video-segmentation');
      let vcol=video; while (vcol && vcol!==root && !vcol.parentElement?.contains(audio)) vcol=vcol.parentElement;
      const row=vcol && vcol!==root ? vcol.parentElement : null;
      const acol=row && audio ? [...row.children].find(el => el!==vcol && el.contains(audio)) : null;
      const valid=!!(root && audio && row && vcol && acol);
      // The editor mounts and unmounts its players during startup and task changes.
      if (layout === 'compact' && audio && video && !valid && !structureWarned) {
        console.warn('[Cinnamon Boost] compact layout: unknown page structure');
        structureWarned = true;
      }
      const compact=layout==='compact' && valid, tags=new Map();
      if (valid) {
        tags.set(root,'root'); tags.set(row,'flat'); tags.set(vcol,'vcol'); tags.set(acol,'acol');
        const children=[...root.children];
        const links=children.find(el => el!==row && !el.contains(audio) && /Tutorial|Guidelines/i.test(el.textContent));
        if (links) tags.set(links,'links');
        const form=children.find(el => el!==row && el!==links && el!==ctx.segments.element() && el!==note && el!==note2 && el.style.display!=='none'); if (form) tags.set(form,'form');
        const skipall=acol.firstElementChild, instr=acol.querySelector('.lsf-object'), labels=acol.querySelector('.lsf-labels');
        if (skipall) tags.set(skipall,'skipall'); if (instr) tags.set(instr,'instr'); if (labels) tags.set(labels,'labels');
        tags.set(audio,'audio');
        for (const el of [instr,labels,audio]) if (el) {
          for (let p=el.parentElement;p && p!==acol;p=p.parentElement) if (!tags.has(p) && p.style.display!=='none') tags.set(p,'flat');
        }
        if (form) {
          const headers=[...form.querySelectorAll('h3')];
          const title=headers.find(h=>/^Segment\s+\d+\s+of\s+\d+/i.test(h.textContent.trim()));
          if (title) { tags.set(title,'title'); if (title.nextElementSibling) tags.set(title.nextElementSibling,'status'); }
          const pagesegs=[...form.querySelectorAll('div')].find(el=>!el.children.length && /^Segments:\s*\d+$/i.test(el.textContent.trim()))?.parentElement;   // the label div itself, then its list (not the wrapper around every question)
          if (pagesegs) tags.set(pagesegs,'pagesegs');
          const why=headers.find(h=>/^Why skip this segment\?/i.test(h.textContent.trim()));
          const choices=[...form.querySelectorAll('.lsf-choices')].find(el=>/Skip this segment/i.test(el.textContent));
          const skip=choices && cardOf(choices,form); if (skip) tags.set(skip,'skip');
          if (why && skip) { const view=[...skip.children].find(c=>c.contains(why)); if (view) tags.set(view,'why'); }   // the part LS hides (visibleWhen), a direct child of the skip box
          for (const h of headers) {
            const key=classifyHeader([...h.childNodes].filter(n=>!n.classList?.contains('so-info') && !n.classList?.contains('so-popover') && !n.classList?.contains('so-hint')).map(n=>n.textContent).join('')); if (!key) continue;   // our ⓘ lives inside the header
            let hidden=false; for (let p=h.parentElement;p && p!==form;p=p.parentElement) if (p.style.display==='none') hidden=true;
            if (hidden) continue;
            const card=cardOf(h,form); if (card && !tags.has(card)) tags.set(card,key);
          }
          const micro=[...tags].find(([,tag])=>tag==='micro')?.[0], def=micro?.querySelector('.lsf-object'); if (def) tags.set(def,'def');
          for (const [el] of [...tags]) if (el!==form && form.contains(el)) {
            for (let p=el.parentElement;p && p!==form;p=p.parentElement) if (!tags.has(p) && p.style.display!=='none') tags.set(p,'flat');
          }
        }
        if (compact) {
          const code=[...tags].find(([,tag])=>tag==='code')?.[0];
          for (const label of code?.querySelectorAll('label') || []) {
            const text=ctx.keyboard.hintlessText(label);
            const host=[...label.querySelectorAll('span')].find(el=>[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE && n.textContent.trim()===text));
            if (ctx.settings.segmentKeys && (text==='Yes' || text==='No')) {
              const label = bindingLabel(ctx.settings.keys[text.toLowerCase()]);
              appendShortcutHint(host, label, 'Press ' + label);
            }
          }
          if (ctx.settings.segmentKeys) appendShortcutHint([...tags].find(([,tag])=>tag==='trans')?.[0]?.querySelector('h3'),'Ctrl','Press Ctrl to type here');
          ctx.segments.sync(root,audio,[...tags].find(([,tag])=>tag==='pagesegs')?.[0]);
          info('instruction',labels,instr?.textContent.trim());
          const micro=[...tags].find(([,tag])=>tag==='micro')?.[0], def=micro?.querySelector('.lsf-object');
          // the definition is about one option, so its ⓘ sits on that pill (White dialect), else on the title
          const white=[...(micro?.querySelectorAll('label') || [])].find(l=>/white dialect/i.test(l.textContent));
          info('definition',white || micro?.querySelector('h3'),def?.textContent.trim(),micro);
          // skip controls: hook classes so the stylesheet needs no :has() chains
          const skipEl=[...tags].find(([,tag])=>tag==='skip')?.[0], whyEl=[...tags].find(([,tag])=>tag==='why')?.[0];
          const skipToggle=skipall?.querySelector('label'), skipChip=[...(skipEl?.querySelectorAll('label') || [])].find(l=>!whyEl?.contains(l));
          for (const el of document.querySelectorAll('.so-skipall-toggle,.so-skip-chip')) if (el!==skipToggle && el!==skipChip) el.classList.remove('so-skipall-toggle','so-skip-chip');
          skipToggle?.classList.add('so-skipall-toggle'); skipChip?.classList.add('so-skip-chip');
          skipall?.classList.toggle('so-open',!!skipToggle?.querySelector('input:checked'));
          skipEl?.classList.toggle('so-open',!!whyEl && whyEl.style.display!=='none');
          if (note.parentElement!==root) root.appendChild(note);
          if (note2.parentElement!==root) root.appendChild(note2);
          const trans=[...tags].find(([,tag])=>tag==='trans')?.[0];
          const message=noteReason({selected:(window.Htx?.annotationStore?.selected?.regionStore?.selection?.size || 0) > 0,videoSkipped:!!skipall?.querySelector('input:checked'),segSkipped:!!([...tags].find(([,tag])=>tag==='skip')?.[0]?.querySelector('input:checked')),transVisible:!!trans && trans.getClientRects().length>0});
          if (note.textContent!==message) note.textContent=message; note.hidden=!message;
          const side=sideNote(message); if (note2.textContent!==side) note2.textContent=side; note2.hidden=!side;
        } else { note.remove(); note2.remove(); for (const pair of infos.values()) { pair.button.remove(); pair.pop.remove(); } }
      }
      if (!compact) ctx.segments.element().remove();
      for (const el of document.querySelectorAll('[data-so]')) if (!tags.has(el)) el.removeAttribute('data-so');
      for (const [el,tag] of tags) if (el.dataset.so!==tag) el.dataset.so=tag;
      document.body.classList.toggle('so-compact-preferred',layout==='compact');
      document.body.classList.toggle('so-compact',compact); setAttr(layoutBtn,'aria-pressed',String(compact));
      const slot=compact && top && bottom ? fixedSlot(top.getBoundingClientRect(),window.innerWidth,8) : null;
      const width=slot ? bottom.getBoundingClientRect().width : 0;
      setGeometry(slot ? {'slot-top':slot.top,'slot-right':slot.right,'slot-height':slot.height,'bar-width':width}
                       : {'slot-top':null,'slot-right':null,'slot-height':null,'bar-width':null});
      ctx.pager?.sync(compact);
      // LS fits the picture to its box only once, at load. When our layout changes the box, refit -
      // but leave a zoom the user chose (picture bigger than the old fit) alone.
      const player=window.Htx?.annotationStore?.selected?.names?.get?.('video')?.ref?.current;
      const fit=player?.videoDimensions?.ratio;
      if (fit && typeof player.setZoom === 'function') {
        if (player.zoom < fit - 1e-3 || (lastFit && Math.abs(player.zoom - lastFit) < 1e-3 && Math.abs(fit - lastFit) > 1e-3)) { player.setZoom(fit); player.setPan?.(0, 0); }
        lastFit = fit;
      }
    }
    let lastFit = 0;
    let layoutFrame = 0;
    new MutationObserver(records => {
      if (layoutFrame || records.every(({ target }) => ctx.gestures?.containsTooltipTarget(target))) return;
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = 0;
        ctx.gestures?.syncTooltip();
        syncLayout();
        place();
      });
    }).observe(document.body, { childList: true, subtree: true });
    ctx.scheduler.onTick(4, syncLayout);
    return { layout: () => layout, get value() { return layout; }, layoutOn, compact: () => document.body.classList.contains('so-compact'), changeTasks, syncLayout, appendShortcutHint };
  } };
})();
