import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = fileURLToPath(new URL('..', import.meta.url));
export const zipName = 'cinnamon-boost.zip';

function requireFile(directory, file) {
  const path = resolve(directory, file);
  const local = relative(directory, path);
  if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) {
    throw new Error(`Package file is outside the extension: ${file}`);
  }
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) throw new Error(`Missing package file: ${file}`);
  return path;
}

export function buildFileList(directory, manifest) {
  const action = manifest.action;
  const files = new Set(['manifest.json', 'update.cmd', 'docs/install.html', 'docs/images/screenshot.jpg', manifest.background?.service_worker, action?.default_popup,
    ...Object.values(manifest.icons ?? {}),
    ...(typeof action?.default_icon === 'string' ? [action.default_icon] : Object.values(action?.default_icon ?? {})),
    ...(manifest.content_scripts ?? []).flatMap(script => [...(script.js ?? []), ...(script.css ?? [])]),
  ]);
  files.delete(undefined);
  if (action?.default_popup) {
    const origin = 'https://extension.invalid';
    const popup = new JSDOM(readFileSync(requireFile(directory, action.default_popup), 'utf8'), {
      url: new URL(action.default_popup, origin).href,
    });
    for (const element of popup.window.document.querySelectorAll('script[src], link[href], img[src]')) {
      const url = new URL(element.src ?? element.href);
      if (url.origin !== origin) throw new Error(`Popup resource is outside the extension: ${url.href}`);
      files.add(decodeURIComponent(url.pathname.slice(1)));
    }
    popup.window.close();
  }
  for (const file of files) requireFile(directory, file);
  return [...files];
}

export function disableDevReload(source) {
  const marker = 'const DEV = true;';
  if (!source.includes(marker)) throw new Error(`src/background.js is missing "${marker}"`);
  return source.replace(marker, 'const DEV = false;');
}

function main() {
  const directory = realpathSync(root);
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  const files = buildFileList(directory, manifest);
  const background = manifest.background.service_worker;
  const releaseWorker = disableDevReload(readFileSync(join(directory, background), 'utf8'));
  const dist = join(directory, 'dist');
  const unpacked = join(dist, 'cinnamon-boost');
  const zip = join(dist, zipName);
  for (const path of [dist, unpacked]) {
    if (existsSync(path) && relative(path, realpathSync(path)) !== '') {
      throw new Error(`Package output resolves to another directory: ${path}`);
    }
  }
  rmSync(unpacked, { recursive: true, force: true });
  for (const file of files) {
    const dest = join(unpacked, file);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(directory, file), dest);
  }
  writeFileSync(join(unpacked, background), releaseWorker);
  rmSync(zip, { force: true });
  const tar = join(process.env.SystemRoot, 'System32', 'tar.exe');
  const result = spawnSync(tar, ['-a', '-c', '-f', zip, '-C', unpacked, '.'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tar failed (${result.signal ?? result.status})`);
  console.log(`Cinnamon Boost ${manifest.version}: ${relative(directory, zip)} (${statSync(zip).size} bytes)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
