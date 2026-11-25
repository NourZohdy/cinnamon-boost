(() => {
  const { zoomAt, zoomFactor, peaks, pageAt } = window.CinnamonBoost.helpers;
  window.CinnamonBoost.features.overview = { start(ctx) {
    const { window, document, editing } = ctx;
    // --- gentle zoom: Ctrl/Cmd + wheel on the wave ---
    window.addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const { ws } = editing();
      const vis = ws?.visualizer;
      const wave = vis?.container;
      if (!wave || typeof vis.getScrollLeft !== 'function') return;
      const rect = wave.getBoundingClientRect();
      // By area, not by target: LS's cursor/tooltip overlays can sit under the mouse.
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
      e.preventDefault();
      e.stopImmediatePropagation();          // LS's own handler would jump to the zoom limit
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const next = zoomAt(ws.zoom, vis.getScrollLeft(), zoomFactor(e.deltaY, e.deltaMode), frac, vis.maxZoom || 1000);
      ws.zoom = next.zoom;
      vis.setScrollLeft(next.scrollLeft);
    }, { capture: true, passive: false });

    // --- overview: the whole file under the wave, with the zoomed window, play line and segments ---
    const ov = document.createElement('canvas');
    ov.className = 'so-ov';
    ov.title = 'Whole file. Drag to move the zoomed view, double-click to move the play line.';
    ov.setAttribute('aria-label', 'Overview of the whole audio');
    for (const event of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick']) {
      ov.addEventListener(event, e => e.stopPropagation());
    }
    let ovPeaks = null, ovData = null, ovBase = null, ovWave = '';
    const viewAt = clientX => {
      const { ws } = editing();
      const vis = ws?.visualizer;
      if (!vis) return null;
      const rect = ov.getBoundingClientRect();
      return { ws, vis, frac: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) };
    };
    // Grab and drag: a press leaves the view where it is; moving the pointer moves the view by the same distance.
    let ovDrag = null;                       // { ws, x, left, width } at the press; tracked on window: pointer capture is not reliable here
    ov.addEventListener('pointerdown', e => {
      const v = e.button === 0 ? viewAt(e.clientX) : null;
      if (!v || v.ws.zoom <= 1.001 || typeof v.vis.getScrollLeft !== 'function') return;
      ovDrag = { ws: v.ws, x: e.clientX, left: v.vis.getScrollLeft(), width: ov.getBoundingClientRect().width || 1 };
    });
    window.addEventListener('pointermove', e => {
      const { ws } = editing();
      if (!ovDrag || ws !== ovDrag.ws) return;
      ws.visualizer.setScrollLeft(Math.min(1 - 1 / ws.zoom, Math.max(0, ovDrag.left + (e.clientX - ovDrag.x) / ovDrag.width)));
    });
    window.addEventListener('pointerup', () => { ovDrag = null; });
    window.addEventListener('blur', () => { ovDrag = null; });
    ov.addEventListener('dblclick', e => {
      const v = viewAt(e.clientX);
      if (!v) return;
      ctx.gestures?.releasePlaybackRange(v.ws);
      v.ws.seek(v.frac * v.ws.duration);
    });

    function drawOverview() {
      const { ann, ws } = editing();
      const vis = ws?.visualizer;
      const data = vis?.audio?.chunks?.[0]?.[0];
      if (!vis?.container?.parentElement || !data || !ws.duration) { ov.remove(); return; }
      if (ov.previousElementSibling !== vis.container) vis.container.after(ov);   // LS may re-render
      const dpr = window.devicePixelRatio || 1;
      const W = Math.max(1, Math.round(ov.clientWidth * dpr)), H = Math.round(40 * dpr);
      if (ov.width !== W || ov.height !== H) { ov.width = W; ov.height = H; ovPeaks = null; }
      // colours come from content.css tokens (--so-ov-*), so the strip follows LS's light / dark theme
      const css = window.getComputedStyle(ov), color = name => css.getPropertyValue(name).trim();
      const wave = color('--so-ov-wave');
      if (wave !== ovWave) { ovWave = wave; ovPeaks = null; }   // theme switched: redraw the wave
      if (!ovPeaks || ovData !== data) {
        ovPeaks = peaks(data, W);
        ovData = data;
        ovBase = document.createElement('canvas');                               // the wave itself, drawn once
        ovBase.width = W; ovBase.height = H;
        const b = ovBase.getContext('2d');
        let top = 0;
        for (let i = 0; i < W; i++) top = Math.max(top, -ovPeaks.min[i], ovPeaks.max[i]);
        const k = (H / 2 - dpr) / (top || 1);
        b.fillStyle = wave;
        for (let i = 0; i < W; i++) {
          const y1 = H / 2 - ovPeaks.max[i] * k, y2 = H / 2 - ovPeaks.min[i] * k;
          b.fillRect(i, y1, 1, Math.max(1, y2 - y1));
        }
      }
      const g = ov.getContext('2d');
      g.clearRect(0, 0, W, H);
      g.drawImage(ovBase, 0, 0);
      const D = ws.duration;
      for (const r of ann.regionStore.regions) {
        if (r.type !== 'audioregion') continue;
        g.fillStyle = color(r.selected ? '--so-ov-region-on' : '--so-ov-region');
        g.fillRect(r.start / D * W, 0, Math.max(dpr, (r.end - r.start) / D * W), H);
      }
      if (ws.zoom > 1.001) {
        const x = vis.getScrollLeft() * W, w = Math.max(2 * dpr, W / ws.zoom);
        g.fillStyle = color('--so-ov-dim');                                       // dim what is off screen
        g.fillRect(0, 0, x, H);
        g.fillRect(x + w, 0, W - x - w, H);
        g.strokeStyle = color('--so-ov-window');
        g.lineWidth = 1.5 * dpr;
        g.strokeRect(x + dpr, dpr, w - 2 * dpr, H - 2 * dpr);
      }
      g.fillStyle = color('--so-ov-playhead');
      g.fillRect(ws.currentTime / D * W - dpr / 2, 0, dpr, H);
    }
    // Zoomed wave: LS's autoCenter (view slides with the playhead) is off; instead, when the playhead itself
    // leaves the view while playing, the view turns one page. A view the user scrolled away is left alone.
    let page = null;                                    // { ws, left, inside } of the last frame
    function turnPage() {
      const { ws } = editing(), vis = ws?.visualizer;
      if (!vis || typeof vis.getScrollLeft !== 'function') { page = null; return; }
      if (vis.autoCenter) vis.autoCenter = false;
      const D = ws.duration, t = ws.currentTime, left = vis.getScrollLeft();
      const start = left * D, end = start + D / ws.zoom, inside = t >= start && t <= end;
      if (page?.ws === ws && ws.playing && ws.zoom > 1 && page.inside && !inside && page.left === left) {
        vis.setScrollLeft(pageAt(t, D, ws.zoom));
        page = { ws, left: vis.getScrollLeft(), inside: true };
        return;
      }
      page = { ws, left, inside };
    }
    ctx.scheduler.onFrame(2, turnPage);
    ctx.scheduler.onFrame(3, drawOverview);
    return { turnPage, drawOverview };
  } };
})();
