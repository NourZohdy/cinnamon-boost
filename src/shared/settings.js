(() => {
  const keys = ['sound', 'cache', 'compact', 'pager', 'preview', 'gestures', 'segmentKeys', 'taskKeys', 'nextAfterSubmit'];
  const KEY_DEFAULTS = Object.freeze({
    play: 'Space', yes: 'KeyY', no: 'KeyN', nextSegment: 'Tab', prevSegment: 'Shift+Tab',
    prevTask: 'ArrowLeft', submit: 'ArrowRight',
    seekBack: 'Digit9', seekForward: 'Digit0',
  });
  const keyGroup = action => action === 'prevTask' || action === 'submit' ? 'taskKeys' : 'segmentKeys';
  const preset = (enabled, preload) => Object.freeze({ ...Object.fromEntries(keys.map(key => [key, enabled.includes(key)])), preload });
  const PRESETS = Object.freeze({
    full: preset(keys, 3),
    loading: preset(['sound', 'cache'], 3),
    off: preset([], 0),
  });
  const DEFAULTS = Object.freeze({ ...PRESETS.full, keys: KEY_DEFAULTS });
  function validBinding(binding) {
    if (binding === '') return true;
    if (typeof binding !== 'string') return false;
    // Leave fixed editor keys and popup capture controls available.
    return /^(?:Shift\+)?(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Arrow(?:Up|Down|Left|Right)|Space|Tab|Insert|Home|End|PageUp|PageDown|Backquote|Backslash|BracketLeft|BracketRight|Comma|Equal|Minus|Period|Quote|Semicolon|Slash|Intl(?:Backslash|Ro|Yen)|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Comma|Equal|ParenLeft|ParenRight))$/.test(binding);
  }
  function bindingLabel(binding) {
    return binding.replace(/(Key|Digit)([A-Z0-9])$/, '$2').replace(/Arrow(Left|Right|Up|Down)$/, (_, dir) =>
      ({ Left: '←', Right: '→', Up: '↑', Down: '↓' })[dir]);
  }
  function eventBinding(event, withAlt = false) {
    return event.code && !event.ctrlKey && !!event.altKey === withAlt && !event.metaKey && !event.isComposing
      ? (event.shiftKey ? 'Shift+' : '') + event.code : null;
  }
  function normalizeSettings(raw) {
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const result = {};
    for (const key of keys) result[key] = typeof input[key] === 'boolean' ? input[key] : DEFAULTS[key];
    result.preload = Number.isInteger(input.preload) ? Math.max(0, Math.min(3, input.preload)) : DEFAULTS.preload;
    result.keys = {};
    const used = new Set();
    for (const [action, fallback] of Object.entries(KEY_DEFAULTS)) {
      const candidate = input.keys?.[action];
      const binding = validBinding(candidate) ? candidate : fallback;
      result.keys[action] = used.has(binding) ? '' : binding;
      used.add(binding);
    }
    return result;
  }
  function migrateSettings(raw, legacyMode) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const wasOff = !Object.hasOwn(raw, 'nextAfterSubmit') && raw.preload === 0 &&
        keys.every(key => key === 'nextAfterSubmit' || raw[key] === false);
      return normalizeSettings(wasOff ? { ...raw, nextAfterSubmit: false } : raw);
    }
    if (legacyMode === 'off') return normalizeSettings(PRESETS.off);
    if (legacyMode === 'sound') return { ...DEFAULTS, compact: false, pager: false };
    return { ...DEFAULTS };
  }
  function applyPreset(settings, id) {
    return normalizeSettings({ ...PRESETS[id], keys: settings.keys });
  }
  function matchPreset(settings) {
    const normalized = normalizeSettings(settings);
    return Object.keys(PRESETS).find(id => Object.entries(PRESETS[id]).every(([key, value]) => normalized[key] === value)) || 'custom';
  }
  const api = { DEFAULTS, PRESETS, normalizeSettings, migrateSettings, matchPreset, applyPreset, keyGroup, validBinding, bindingLabel, eventBinding };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { window.CinnamonBoost = window.CinnamonBoost || {}; window.CinnamonBoost.settings = api; }
})();
