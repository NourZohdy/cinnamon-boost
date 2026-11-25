(() => {
  const { svg, shortTime, segmentState, pageTime } = window.CinnamonBoost.helpers;
  window.CinnamonBoost.features.segments = { start(ctx) {
    const { window, document, editing, currentTaskId } = ctx;
    let playAll = null;
    const segs=document.createElement('div'); segs.className='so-segs';
    for (const event of ['pointerdown','mousedown','mouseup','click']) segs.addEventListener(event,e=>e.stopPropagation());
    segs.addEventListener('mousedown',e=>{ if (e.target.closest('button')) e.preventDefault(); });
    let segmentKey='', segmentAnnotation=null, pageButtons=[], confirmId=null, segRows=[], shownSelectedId=null;   // confirmId: segment asking 'Delete?'
    const segmentTexts=new Map();
    // open segment i of the panel (LS's own page button when it matches, else selectArea) and play it;
    // opening never pauses (see keepPlaying)
    function openAndPlay(i) {
      const row=segRows[i]; if (!row) return;
      stopPlayAll(false);
      if (!row.r.selected) {
        const button=pageButtons[i];
        if (button?.textContent?.includes(pageTime(row.r.start))) button.click(); else window.Htx?.annotationStore?.selected?.selectArea?.(row.r);
      }
      const { ws }=editing(); if (!ws) return;
      if (ws.playing) ws.pause();
      ws.play(row.r.start,row.r.end);
    }
    function syncSegments(root, audio, pagesegs) {
      const ann=window.Htx?.annotationStore?.selected;
      if (ann!==segmentAnnotation) { segmentTexts.clear(); segmentAnnotation=ann; segmentKey=''; shownSelectedId=null; }
      const regions=[...(ann?.regionStore?.regions || [])].filter(r=>r.type==='audioregion').sort((a,b)=>a.start-b.start);
      pageButtons=pagesegs ? [...pagesegs.querySelectorAll('button')] : [];
      regions.forEach((r,i)=>{ const text=pageButtons[i]?.textContent?.trim(); if (text?.includes(pageTime(r.start))) segmentTexts.set(r.id,text); });
      const rows=regions.map(r=>{ const text=segmentTexts.get(r.id); const state=segmentState(r,text)==='skip' ? 'skip' : text ? segmentState(r,text) : 'unknown'; return {r,text,state}; });
      segRows=rows;
      if (confirmId && !rows.some(row=>row.r.id===confirmId)) confirmId=null;
      const duration=editing().ws?.duration || 0;
      const key=JSON.stringify([confirmId,!!playAll,Math.round(duration),rows.map(({r,text,state})=>[r.id,r.start,r.end,!!r.selected,state,text])]);
      if (segs.parentElement!==root) root.appendChild(segs);
      segs.hidden=!rows.length || !audio.getClientRects().length;
      if (key===segmentKey) return;
      segmentKey=key;
      const head=document.createElement('div'); head.className='so-segs-head';
      const title=document.createElement('span'); title.textContent='SEGMENTS'; head.appendChild(title);
      const count=document.createElement('span'); count.className='so-segs-count';
      const done=rows.filter(row=>row.state==='done').length, skipped=rows.filter(row=>row.state==='skip').length, todo=rows.filter(row=>row.state==='todo').length;
      count.textContent=`${done}/${rows.length} done`; count.title=`${done} done · ${skipped} skipped · ${todo} to do`; head.appendChild(count);
      const all=document.createElement('button'); all.type='button'; all.className='so-segs-nav so-segs-playall';
      all.textContent=playAll ? '■ Stop' : '▶ Play all'; all.title=playAll ? 'Stop playing the segments' : 'Play only the segments, one after another (gaps skipped)';
      all.disabled=!rows.length; if (playAll) all.setAttribute('aria-pressed','true');
      all.addEventListener('click',()=>{ if (playAll) stopPlayAll(); else startPlayAll(rows.map(({r})=>[r.start,r.end])); });
      head.appendChild(all);
      const list=document.createElement('div'); list.className='so-segs-list';
      rows.forEach(({r,text,state},i)=>{
        const b=document.createElement('button'); b.type='button'; b.className='so-segs-row'; if (r.selected) b.setAttribute('aria-current','true'); b.addEventListener('click',()=>openAndPlay(i));
        const num=document.createElement('span'); num.className='so-segs-num'; num.textContent=String(i+1);
        const time=document.createElement('span'); time.className='so-segs-time'; time.textContent=`${shortTime(r.start)}–${shortTime(r.end)}`;
        const icon=document.createElement('span'); icon.className='so-segs-state'; icon.dataset.state=state; icon.textContent=({done:'✓',todo:'!',skip:'⊘',unknown:'•'})[state];
        icon.title=state==='unknown'?'Select it once to check':state==='todo' ? (text?.replace(/^.*?\d+:\d{2}\.\d{2}\s*[–-]\s*\d+:\d{2}\.\d{2}\s*/, '').replace(/^[⚠!✓\s]+/, '') || 'To do') : state==='done'?'Complete':'Skipped';
        b.append(num,time,icon);
        const item=document.createElement('div'); item.className='so-segs-item';
        const ask=id=>{ confirmId=id; segmentKey=''; ctx.layout.syncLayout(); };
        if (confirmId===r.id) {
          // ask inside the panel (no browser dialog: it would block the page); LS's Ctrl+Z brings a deleted segment back
          item.classList.add('so-segs-confirm');
          const q=document.createElement('span'); q.className='so-segs-ask'; q.textContent=`Delete segment ${i+1}?`;
          const yes=document.createElement('button'); yes.type='button'; yes.className='so-segs-nav so-segs-yes'; yes.textContent='Delete';
          yes.addEventListener('click',()=>{ confirmId=null; try { r.deleteRegion(); } catch (e) { console.warn('[Cinnamon Boost] delete failed', e); } segmentKey=''; ctx.layout.syncLayout(); });
          const no=document.createElement('button'); no.type='button'; no.className='so-segs-nav so-segs-no'; no.textContent='Cancel'; no.addEventListener('click',()=>ask(null));
          item.append(q,yes,no);
        } else {
          const del=document.createElement('button'); del.type='button'; del.className='so-segs-del'; del.innerHTML=svg('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>'); del.title=`Delete segment ${i+1}`; del.setAttribute('aria-label',`Delete segment ${i+1}`);
          del.addEventListener('click',()=>ask(r.id));
          item.append(b,del);
        }
        list.appendChild(item);
      });
      // ponytail: plain sum of segment lengths (overlapping segments count twice)
      const total=rows.reduce((sum,{r})=>sum+Math.max(0,r.end-r.start),0);
      const foot=document.createElement('div'); foot.className='so-segs-foot';
      foot.textContent=duration ? `Annotated ${shortTime(total)} of ${shortTime(duration)} (${Math.round(total/duration*100)}%)` : `Annotated ${shortTime(total)}`;
      foot.title='Total length of all segments';
      const scrolled=segs.querySelector('.so-segs-list')?.scrollTop || 0;
      segs.replaceChildren(head,list,foot);
      list.scrollTop=scrolled;
      const open=rows.find(row=>row.r.selected)?.r.id ?? null;
      if (open!==shownSelectedId) {
        shownSelectedId=open;
        if (open != null && ctx.settings.segmentKeys) {
          const started=performance.now(), selectedAnnotation=ann;
          const focusTrans=()=>{
            if (window.Htx?.annotationStore?.selected!==selectedAnnotation || shownSelectedId!==open ||
                !document.body.classList.contains('so-compact') ||
                ![...(selectedAnnotation?.regionStore?.regions || [])].some(r=>r.id===open && r.selected)) return;
            const form=document.querySelector('[data-so="form"]'), active=document.activeElement;
            if (form?.contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName)) return;
            const box=form?.querySelector('[data-so="trans"] textarea');
            if (box) { box.focus({preventScroll:true}); box.setSelectionRange(box.value.length,box.value.length); }
            else if (performance.now()-started<500) requestAnimationFrame(focusTrans);
          };
          requestAnimationFrame(focusTrans);
        }
        const cur=list.querySelector('.so-segs-row[aria-current="true"]');
        if (cur) {                                       // scroll the list only (scrollIntoView could move LS's panels)
          const r=cur.getBoundingClientRect(), lr=list.getBoundingClientRect();
          if (r.top<lr.top) list.scrollTop-=lr.top-r.top; else if (r.bottom>lr.bottom) list.scrollTop+=r.bottom-lr.bottom;
        }
      }
    }
    // Play all: the segments one by one in time order, gaps skipped. Stops at the end, on Stop, or as soon as the
    // playhead is taken somewhere else (pause, a click on the wave, another segment).
    // ponytail: the next segment starts when the playhead is 0.12 s from the end (frames are 33 ms, rate up to 3x)
    function playAllStep(i) {
      const { ws } = editing(), span = playAll?.list[i];
      if (!ws || !span || ws !== playAll.ws || currentTaskId() !== playAll.taskId) { stopPlayAll(); return; }
      playAll.i = i; playAll.since = performance.now();
      if (ws.playing) ws.pause();
      ws.play(span[0], span[1]);                        // the watcher moves on before Loop could repeat it
    }
    function startPlayAll(spans) { playAll = { taskId: currentTaskId(), ws: editing().ws, list: spans, i: 0, since: 0 }; segmentKey = ''; playAllStep(0); }
    function stopPlayAll(pause = true) {
      if (!playAll) return;
      const queue = playAll;
      playAll = null; segmentKey = '';
      const { ws } = editing();
      if (pause && ws?.playing && ws === queue.ws && currentTaskId() === queue.taskId) ws.pause();
    }
    function playAllRange(ws) {
      if (!playAll || playAll.ws !== ws || playAll.taskId !== currentTaskId()) return null;
      const [start, end] = playAll.list[playAll.i];
      return { start, end };
    }
    function watchPlayAll(ws) {
      if (!playAll) return;
      if (!ws || ws !== playAll.ws || currentTaskId() !== playAll.taskId) { stopPlayAll(false); return; }
      const [start, end] = playAll.list[playAll.i], t = ws.currentTime, settling = performance.now() - playAll.since < 400;
      if (t >= end - 0.12) { playAllStep(playAll.i + 1); return; }
      if (!settling && (!ws.playing || t < start - 0.3)) stopPlayAll(false);
    }
    ctx.scheduler.onFrame(1, () => watchPlayAll(editing().ws));
    return { sync: syncSegments, rows: () => segRows, annotation: () => segmentAnnotation, openAndPlay, stopPlayAll, playAllRange, watchPlayAll, invalidate: () => { segmentKey = ''; }, element: () => segs };
  } };
})();
