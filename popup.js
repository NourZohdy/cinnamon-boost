const { DEFAULTS, normalizeSettings, migrateSettings, matchPreset, applyPreset, keyGroup, validBinding, bindingLabel, eventBinding } = window.LSSoundOnly.settings;
const { UPDATE_KEY, isNewer, releaseUrl } = window.LSSoundOnly.update;
const KEY = 'soundOnly.settings';
const sections = [
  ['Sound & loading', [
    ['sound', 'Sound fixes & controls', 'Smooth playback, Speed mode, Speed and Loop.'],
    ['cache', 'Keep files on this computer', 'Opened tasks load instantly next time (up to 6 files).'],
    ['preload', 'Download tasks ahead', 'Fetch the next tasks in the background.'],
  ]],
  ['Layout', [
    ['compact', 'Compact workspace', 'Video, wave and questions in one window, with the segments panel.'],
    ['pager', 'Task pager', 'Task tiles at the bottom: status, length, download state.'],
  ]],
  ['Waveform', [
    ['preview', 'Overview & zoom', 'Whole-file strip under the wave, gentle Ctrl + wheel zoom, page turns.'],
    ['gestures', 'Scrubbing & highlights', 'Drag the ruler to scrub, click to replay, Clear, Add all, segment length tip.'],
  ]],
  ['Keyboard', [
    ['segmentKeys', 'Segment keys', 'Enter saves transcription text. Ctrl alone focuses the text box. Hold Alt to seek while typing.'],
    ['taskKeys', 'Task keys', 'Submit or update the annotation, or move between tasks.'],
    ['nextAfterSubmit', 'Open the next task after Submit', 'Also applies when you click Submit or Update in Label Studio.'],
  ]],
];
const actions = {
  play: 'Play / pause', yes: 'Code-switching: Yes', no: 'Code-switching: No',
  seekBack: 'Back 1 s', seekForward: 'Forward 1 s',
  nextSegment: 'Next segment', prevSegment: 'Previous segment',
  prevTask: 'Previous task', submit: 'Submit / next task',
};
let settings = { ...DEFAULTS };
let loaded = false;
let queue = Promise.resolve();
const openSections = new Set();
const status = document.getElementById('status');
const presets = document.getElementById('presets');
const main = document.getElementById('sections');
const reset = document.getElementById('reset');

function renderPresets() {
  const match = matchPreset(settings);
  document.getElementById('custom').hidden = match !== 'custom';
  presets.replaceChildren();
  for (const [id, label] of [['everything', 'Everything'], ['sound', 'Sound & loading'], ['interface', 'Interface only'], ['off', 'Off']]) {
    const button = document.createElement('button');
    button.className = 'seg';
    button.textContent = label;
    button.disabled = !loaded;
    button.setAttribute('aria-pressed', String(match === id));
    button.onclick = () => save(applyPreset(settings, id));
    presets.append(button);
  }
}

function renderPreload(blocked, describedBy) {
  const group = document.createElement('div');
  group.className = 'segments';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Tasks to download ahead');
  group.setAttribute('aria-describedby', describedBy);
  for (let n = 0; n <= 3; n++) {
    const button = document.createElement('button');
    button.className = 'seg';
    button.textContent = n || 'Off';
    button.disabled = !loaded || blocked;
    button.setAttribute('aria-pressed', String(settings.preload === n));
    button.onclick = () => save({ ...settings, preload: n });
    group.append(button);
  }
  return group;
}

function renderRow([key, label, desc]) {
  const blocked = (key === 'preload' && !settings.cache) || (key === 'pager' && !settings.compact);
  const reason = key === 'preload' ? 'Needs “Keep files on this computer”.' : 'Needs “Compact workspace”.';
  const row = document.createElement('div');
  row.className = 'row' + (blocked ? ' blocked' : '');
  const description = `d-${key}`;
  const reasonId = `r-${key}`;
  const describedBy = description + (blocked ? ' ' + reasonId : '');
  const lab = document.createElement(key === 'preload' ? 'div' : 'label');
  lab.innerHTML = `<span class="text"><strong>${label}</strong><span class="desc" id="${description}">${desc}</span></span>`;
  if (key !== 'preload') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.checked = settings[key];
    input.disabled = !loaded || blocked;
    input.setAttribute('aria-describedby', describedBy);
    input.onchange = () => save({ ...settings, [key]: input.checked });
    lab.append(input);
  }
  row.append(lab);
  if (key === 'preload') row.append(renderPreload(blocked, describedBy));
  if (blocked) {
    const el = document.createElement('span');
    el.className = 'reason';
    el.id = reasonId;
    el.textContent = reason;
    row.append(el);
  }
  return row;
}

function renderBinding(action, label) {
  const row = document.createElement('div');
  row.className = 'row';
  const line = document.createElement('div');
  line.className = 'binding';
  const name = document.createElement('span');
  name.textContent = label;
  const button = document.createElement('button');
  button.className = 'key-button';
  button.id = `key-${action}`;
  button.disabled = !loaded || !settings[keyGroup(action)];
  const key = document.createElement('kbd');
  const current = bindingLabel(settings.keys[action]) || '—';
  const message = document.createElement('span');
  message.className = 'reason';
  message.setAttribute('role', 'status');
  message.hidden = true;
  let listening = false;
  const showKey = value => {
    key.textContent = value;
    button.setAttribute('aria-label', `${label}: ${value}`);
  };
  showKey(current);
  button.onclick = () => {
    listening = true;
    message.hidden = true;
    showKey('Press a key…');
  };
  button.onblur = () => {
    listening = false;
    showKey(current);
  };
  button.onkeydown = event => {
    if (!listening) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || event.isComposing || event.key === 'Shift') return;
    if (event.key === 'Escape') {
      listening = false;
      message.hidden = true;
      showKey(current);
      return;
    }
    const binding = event.key === 'Backspace' ? '' : eventBinding(event);
    const conflict = binding && Object.keys(actions).find(other => other !== action && settings.keys[other] === binding);
    if (conflict || !validBinding(binding)) {
      message.textContent = conflict ? 'Already used by ' + actions[conflict] : 'Choose a supported key, with Shift if needed.';
      message.hidden = false;
      return;
    }
    save({ ...settings, keys: { ...settings.keys, [action]: binding } });
    document.getElementById(button.id).focus();
  };
  button.append(key);
  line.append(name, button);
  row.append(line, message);
  return row;
}

function renderSection([title, rows]) {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = title;
  details.open = openSections.has(title);
  details.addEventListener('toggle', () => {
    if (!details.isConnected) return;
    if (details.open) openSections.add(title);
    else openSections.delete(title);
  });
  details.append(summary);
  const box = document.createElement('div');
  box.className = 'rows';
  for (const row of rows) {
    box.append(renderRow(row));
    for (const [action, label] of Object.entries(actions)) {
      if (keyGroup(action) === row[0]) box.append(renderBinding(action, label));
    }
  }
  details.append(box);
  return details;
}

function render() {
  renderPresets();
  main.replaceChildren();
  for (const section of sections) main.append(renderSection(section));
  reset.disabled = !loaded;
}

function showError(error) {
  status.hidden = false;
  status.className = 'error';
  status.textContent = 'Could not save settings: ' + (error.message || error);
}

function save(next) {
  settings = normalizeSettings(next);
  render();
  const snapshot = { ...settings };
  queue = queue.catch(() => {}).then(() => chrome.storage.local.set({ [KEY]: snapshot }));
  queue.then(() => {
    status.hidden = false;
    status.className = '';
    status.textContent = 'Saved. Save your work, then reload the Label Studio tab to apply.';
  }, showError);
}

async function load() {
  try {
    const data = await chrome.storage.local.get([KEY, 'soundOnly.mode']);
    settings = migrateSettings(data[KEY], data['soundOnly.mode']);
    if (!Object.hasOwn(data, KEY)) await chrome.storage.local.set({ [KEY]: settings });
    loaded = true;
    render();
  } catch (error) {
    showError(error);
  }
}

reset.onclick = () => save({ ...DEFAULTS });
const current = chrome.runtime.getManifest().version;
document.getElementById('version').textContent = 'v' + current;
const banner = document.getElementById('update-banner');
const updateVersion = document.getElementById('update-version');
const releaseLink = document.getElementById('release-link');
const checkUpdate = document.getElementById('check-update');
const updateResult = document.getElementById('update-result');
function renderUpdate(record) {
  const newer = record?.newer === true && isNewer(record.latest, current);
  banner.hidden = !newer;
  if (newer) {
    updateVersion.textContent = `Version ${record.latest} is available (you have ${current}).`;
    releaseLink.href = releaseUrl(record.url);
  }
  return newer;
}

let updateChanged = false;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[UPDATE_KEY]) return;
  updateChanged = true;
  if (renderUpdate(changes[UPDATE_KEY].newValue)) updateResult.textContent = '';
});
chrome.storage.local.get(UPDATE_KEY).then(data => {
  if (!updateChanged) renderUpdate(data[UPDATE_KEY]);
}).catch(() => {});
document.getElementById('reload-extension').onclick = () => chrome.runtime.reload();
checkUpdate.onclick = async () => {
  checkUpdate.disabled = true;
  updateResult.textContent = 'Checking…';
  try {
    const record = await chrome.runtime.sendMessage({ type: 'so-check-update', force: true });
    updateChanged = true;
    const newer = renderUpdate(record);
    updateResult.textContent = !record || record.failed ? 'Could not check' : newer ? '' : 'Up to date';
  } catch (_) {
    updateResult.textContent = 'Could not check';
  } finally {
    checkUpdate.disabled = false;
  }
};
render();
load();
