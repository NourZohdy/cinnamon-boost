import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { buildFileList, disableDevReload, zipName } from '../scripts/package.mjs';

const directory = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const files = buildFileList(directory, manifest);
const featureScripts = manifest.content_scripts.flatMap(script => script.js ?? []).filter(file => file.startsWith('src/page/features/'));
const icons = [16, 48, 128].map(size => `icons/icon${size}.png`);
const guideImages = [...icons, 'docs/images/screenshot.jpg'];
for (const file of [
  'manifest.json', 'update.cmd', 'docs/install.html', 'src/background.js',
  'src/shared/settings.js', 'src/shared/update.js',
  'src/page/content.js', 'src/page/content.css', 'src/page/helpers.js', 'src/page/runtime.js',
  'src/popup/popup.html', 'src/popup/popup.js', 'src/popup/popup.css',
  ...featureScripts, ...guideImages,
]) {
  assert.ok(files.includes(file), `Missing from package: ${file}`);
}
const guide = readFileSync(new URL('../docs/install.html', import.meta.url), 'utf8');
for (const root of [new URL('../', import.meta.url), new URL('https://nourzohdy.github.io/ls-sound-only/')]) {
  const { window } = new JSDOM(guide, { url: new URL('docs/install.html', root).href });
  const urls = [...window.document.images].map(image => image.src);
  assert.deepEqual(urls.sort(), guideImages.map(file => new URL(file, root).href).sort());
  window.close();
}
assert.equal(files.filter(file => file === 'src/background.js').length, 1);
assert.equal(zipName, 'ls-sound-only.zip');
const updater = readFileSync(new URL('../update.cmd', import.meta.url), 'utf8');
assert.ok(updater.endsWith('\r\n') && !/[\r\n]/.test(updater.replaceAll('\r\n', '')));
assert.ok(updater.includes(`/releases/latest/download/${zipName}`));
assert.ok(files.every(file => !/(^|\/)(?:test_[^/]*\.mjs|node_modules|\.feature|compressed-videos)(?:\/|$)|\.md$/i.test(file)));
assert.throws(() => buildFileList(directory, { ...manifest, icons: { 16: 'icons/missing.png' } }), /Missing package file: icons\/missing\.png/);

const reload = readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const packaged = disableDevReload(reload);
assert.notEqual(packaged, reload);
assert.equal(packaged.replace('const DEV = false;', 'const DEV = true;'), reload);
assert.throws(() => disableDevReload(packaged), /missing "const DEV = true;"/);
console.log('package file list and dev reload rewrite tests passed');
