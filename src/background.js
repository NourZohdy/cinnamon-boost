// Service worker and isolated page bridge.
const DEV = true;
const SETTINGS_KEY = 'soundOnly.settings';
const MODE_KEY = 'soundOnly.mode';
if (typeof window === 'undefined') {
  globalThis.importScripts('/src/shared/update.js');
  const REPO = 'NourZohdy/ls-sound-only';
  const { UPDATE_KEY, isNewer, releaseUrl } = globalThis.LSSoundOnly.update;
  const current = chrome.runtime.getManifest().version;
  const hour = 60 * 60 * 1000;
  const setBadge = async record => {
    const newer = record?.newer && isNewer(record.latest, current);
    if (newer) await chrome.action.setBadgeBackgroundColor({ color: '#2854c5' });
    await chrome.action.setBadgeText({ text: newer ? 'NEW' : '' });
  };
  const readUpdate = async () => (await chrome.storage.local.get(UPDATE_KEY))[UPDATE_KEY];
  let queue = readUpdate().then(setBadge).catch(() => {});

  function checkForUpdate(force) {
    const check = queue.then(async () => {
      const previous = await readUpdate();
      if (!force && Date.now() - previous?.checkedAt < (previous?.failed ? 1 : 6) * hour) return previous;
      let record;
      try {
        const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
        const release = await response.json();
        const latest = release.tag_name.replace(/^v/, '');
        record = { latest, url: releaseUrl(release.html_url), newer: isNewer(latest, current) };
      } catch (_) {
        record = { ...previous, failed: true };
      }
      record.checkedAt = Date.now();
      await chrome.storage.local.set({ [UPDATE_KEY]: record });
      await setBadge(record).catch(() => {});
      return record;
    });
    queue = check.catch(() => {});
    return check;
  }

  for (const event of [chrome.runtime.onInstalled, chrome.runtime.onStartup]) {
    event.addListener(() => { checkForUpdate().catch(() => {}); });
  }
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'so-check-update') return;
    checkForUpdate(msg.force === true).then(sendResponse, () => sendResponse(undefined));
    return true;
  });
  if (DEV) chrome.runtime.onMessage.addListener(msg => { if (msg === 'so-dev-reload') chrome.runtime.reload(); });
} else {
  const UPDATE_KEY = 'soundOnly.update';
  if (DEV) window.addEventListener('message', e => { if (e.source === window && e.data === 'so-dev-reload') chrome.runtime.sendMessage('so-dev-reload'); });
  const started = performance.now();
  let interacted = false;
  for (const event of ['keydown', 'pointerdown']) window.addEventListener(event, () => { interacted = true; }, { capture: true, once: true });
  const mirror = (key, value) => {
    if (value === undefined) return false;
    const serialized = key === MODE_KEY ? value : JSON.stringify(value);
    try { const before = localStorage.getItem(key); localStorage.setItem(key, serialized); return before !== serialized; } catch (_) { return false; }
  };
  const mirrorUpdate = value => {
    if (value) mirror(UPDATE_KEY, { ...value, current: chrome.runtime.getManifest().version });
    else { try { localStorage.removeItem(UPDATE_KEY); } catch (_) {} }
  };
  let updateChanged = false;
  chrome.storage.local.get([SETTINGS_KEY, MODE_KEY, UPDATE_KEY]).then(data => {
    if (!updateChanged) mirrorUpdate(data[UPDATE_KEY]);
    const settingsChanged = mirror(SETTINGS_KEY, data[SETTINGS_KEY]);
    const modeChanged = mirror(MODE_KEY, data[MODE_KEY]);
    const changed = settingsChanged || modeChanged;
    if (changed && !interacted && performance.now() - started <= 3000) window.location.reload();
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of [SETTINGS_KEY, MODE_KEY]) if (changes[key]) mirror(key, changes[key].newValue);
    if (changes[UPDATE_KEY]) {
      updateChanged = true;
      mirrorUpdate(changes[UPDATE_KEY].newValue);
    }
  });
  chrome.runtime.sendMessage({ type: 'so-check-update' }).catch(() => {});
}
