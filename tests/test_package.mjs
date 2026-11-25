import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { buildFileList, disableDevReload, zipName } from '../scripts/package.mjs';

const directory = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const files = buildFileList(directory, manifest);
const featureScripts = manifest.content_scripts.flatMap(script => script.js ?? []).filter(file => file.startsWith('src/page/features/'));
const icons = [16, 48, 128].map(size => `icons/icon${size}.png`);
const guideImages = ['icons/logo.svg', ...icons.slice(0, 2), 'docs/images/screenshot.jpg'];
for (const file of [
  'manifest.json', 'update.cmd', 'docs/install.html', 'src/background.js',
  'src/shared/settings.js', 'src/shared/update.js',
  'src/page/content.js', 'src/page/content.css', 'src/page/helpers.js', 'src/page/runtime.js',
  'src/popup/popup.html', 'src/popup/popup.js', 'src/popup/popup.css',
  ...featureScripts, ...icons, ...guideImages,
]) {
  assert.ok(files.includes(file), `Missing from package: ${file}`);
}
for (const [index, size] of [16, 48, 128].entries()) {
  const png = readFileSync(new URL(`../${icons[index]}`, import.meta.url));
  assert.equal(png.subarray(12, 16).toString(), 'IHDR');
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
}
const pages = new URL('https://nourzohdy.github.io/cinnamon-boost/');
const guide = read('docs/install.html');
assert.ok(read('README.md').includes(new URL('docs/install.html', pages).href));
for (const root of [new URL('../', import.meta.url), pages]) {
  const { window } = new JSDOM(guide, { url: new URL('docs/install.html', root).href });
  const urls = [...new Set(Array.from(window.document.images, image => image.src))];
  assert.deepEqual(urls.sort(), guideImages.map(file => new URL(file, root).href).sort());
  assert.equal(window.document.querySelector('.titlebar img[alt="Cinnamon Boost"]').title, manifest.action.default_title);
  for (const language of ['.en', '[lang="ar"]']) {
    const copy = Array.from(window.document.querySelectorAll(language), node => node.textContent).join('\n');
    assert.ok(copy.includes('Documents\\cinnamon-boost'));
    assert.ok(copy.includes('cinnamon-boost.zip'));
  }
  window.close();
}
assert.equal(files.filter(file => file === 'src/background.js').length, 1);
assert.equal(zipName, 'cinnamon-boost.zip');
assert.equal(JSON.parse(read('package.json').replace(/^\uFEFF/, '')).name, 'cinnamon-boost');
const lock = JSON.parse(read('package-lock.json'));
assert.equal(lock.name, 'cinnamon-boost');
assert.equal(lock.packages[''].name, 'cinnamon-boost');
const updater = read('update.cmd');
assert.ok(updater.endsWith('\r\n') && !/[\r\n]/.test(updater.replaceAll('\r\n', '')));
assert.ok(updater.includes(`https://github.com/NourZohdy/cinnamon-boost/releases/latest/download/${zipName}`));
const workflow = read('.github/workflows/release.yml');
assert.match(workflow, /\$legacyZip = 'dist\/ls-sound-only\.zip'\s+Copy-Item -LiteralPath dist\/cinnamon-boost\.zip -Destination \$legacyZip\s+gh release create "\$tag" dist\/cinnamon-boost\.zip "\$legacyZip"/);
assert.ok(files.every(file => !/(^|\/)(?:test_[^/]*\.mjs|node_modules|\.feature|compressed-videos)(?:\/|$)|\.md$/i.test(file)));
assert.throws(() => buildFileList(directory, { ...manifest, icons: { 16: 'icons/missing.png' } }), /Missing package file: icons\/missing\.png/);

const reload = readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const packaged = disableDevReload(reload);
assert.notEqual(packaged, reload);
assert.equal(packaged.replace('const DEV = false;', 'const DEV = true;'), reload);
assert.throws(() => disableDevReload(packaged), /missing "const DEV = true;"/);
console.log('package file list and dev reload rewrite tests passed');
