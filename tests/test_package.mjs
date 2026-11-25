import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildFileList, disableDevReload, zipName } from '../scripts/package.mjs';

const directory = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const files = buildFileList(directory, manifest);
const featureScripts = manifest.content_scripts.flatMap(script => script.js ?? []).filter(file => file.startsWith('features/'));
const icons = [16, 48, 128].map(size => `icons/icon${size}.png`);
for (const file of ['manifest.json', 'INSTALL.html', 'install/result.jpg', 'reload.js', 'update.js', 'update.cmd', 'content.css', 'popup.html', 'popup.js', 'popup.css', 'settings.js', ...featureScripts, ...icons]) {
  assert.ok(files.includes(file), `Missing from package: ${file}`);
}
assert.equal(files.filter(file => file === 'reload.js').length, 1);
assert.equal(zipName, 'ls-sound-only.zip');
const updater = readFileSync(new URL('../update.cmd', import.meta.url), 'utf8');
assert.ok(updater.endsWith('\r\n') && !/[\r\n]/.test(updater.replaceAll('\r\n', '')));
assert.ok(updater.includes(`/releases/latest/download/${zipName}`));
assert.ok(files.every(file => !/(^|\/)(?:test_[^/]*\.mjs|node_modules|\.feature|compressed-videos)(?:\/|$)|\.md$/i.test(file)));
assert.throws(() => buildFileList(directory, { ...manifest, icons: { 16: 'icons/missing.png' } }), /Missing package file: icons\/missing\.png/);

const reload = readFileSync(new URL('../reload.js', import.meta.url), 'utf8');
const packaged = disableDevReload(reload);
assert.notEqual(packaged, reload);
assert.equal(packaged.replace('const DEV = false;', 'const DEV = true;'), reload);
assert.throws(() => disableDevReload(packaged), /missing "const DEV = true;"/);
console.log('package file list and dev reload rewrite tests passed');
