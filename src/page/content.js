/* global require */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = require('./helpers.js');
} else {
  (() => {
    const ctx = window.LSSoundOnly.ctx = window.LSSoundOnly.createContext();
    if (ctx.mode === 'off') return;
    const { document } = ctx;
    if (ctx.settings.cache) ctx.cache = window.LSSoundOnly.features.cache.start(ctx);
    function startUI() {
      const s = ctx.settings;
      document.body.classList.toggle('so-f-preview', s.preview);
      document.body.classList.toggle('so-f-segmentkeys', s.segmentKeys);
      const enabled = { preload: (s.cache && s.preload > 0) || s.pager || s.taskKeys || s.nextAfterSubmit, toolbar: true, sound: s.sound, layout: s.compact, segments: s.compact, pager: true, gestures: s.gestures, overview: s.preview, keyboard: true };
      for (const name of Object.keys(enabled)) if (enabled[name]) ctx[name] = window.LSSoundOnly.features[name].start(ctx);
      if (ctx.sound) {
        ctx.toolbar.bar.insertBefore(ctx.sound.loopBtn, ctx.gestures ? ctx.toolbar.bar.lastElementChild : null);
        ctx.toolbar.bar.append(ctx.sound.speedSeg);
      }
      ctx.toolbar.bar.append(ctx.toolbar.nextChip);
      ctx.toolbar.setNext('idle', '');
      ctx.gestures?.syncTooltip();
      ctx.layout?.syncLayout();
      ctx.toolbar.place();
      ctx.sound?.applySpeed();
      ctx.sound?.syncLoop();
      ctx.scheduler.start();
    }
    if (document.body) startUI();
    else document.addEventListener('DOMContentLoaded', startUI, { once: true });
  })();
}
