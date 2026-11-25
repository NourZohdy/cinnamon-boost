import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Usage: node scripts/make-icons.mjs [path/to/logo-preview.png]
const sizes = [16, 48, 128];
const icons = fileURLToPath(new URL('../icons/', import.meta.url));
const source = readFileSync(join(icons, 'logo.svg'), 'utf8');
const browser = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
  .filter(Boolean)
  .flatMap(directory => [
    join(directory, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(directory, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ])
  .find(existsSync);
if (!browser) throw new Error('Chrome or Edge is required to render the icons.');

const temp = realpathSync(tmpdir());
const work = mkdtempSync(join(temp, 'cinnamon-icons-'));
function render(html, ...args) {
  const page = join(work, 'render.html');
  writeFileSync(page, html);
  const result = spawnSync(browser, [
    '--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run',
    ...(process.env.CINNAMON_RENDER_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    `--user-data-dir=${join(work, 'profile')}`, ...args, pathToFileURL(page).href,
  ], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Browser rendering failed: ${result.stderr}`);
  return result.stdout;
}

function dataImage(type, data) {
  return `data:image/${type};base64,${Buffer.from(data).toString('base64')}`;
}

try {
  const images = sizes.map(size => {
    const sized = source.replace('<svg ', `<svg width="${size}" height="${size}" `);
    return `<img width="${size}" height="${size}" src="${dataImage('svg+xml', sized)}">`;
  }).join('');
  const html = render(`<!doctype html><meta charset="utf-8">${images}<output id="pngs"></output>
    <script>
      window.addEventListener('load', () => {
        document.getElementById('pngs').textContent = Array.from(document.images, image => {
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          canvas.getContext('2d').drawImage(image, 0, 0);
          return canvas.toDataURL('image/png').split(',')[1];
        }).join(' ');
      });
    </script>`, '--dump-dom');
  const pngs = html.match(/<output id="pngs">([A-Za-z0-9+/= ]+)<\/output>/)?.[1].split(' ');
  if (pngs?.length !== sizes.length) throw new Error('The browser did not render all three PNGs.');
  const buffers = pngs.map(png => Buffer.from(png, 'base64'));
  for (const [index, size] of sizes.entries()) {
    writeFileSync(join(icons, `icon${size}.png`), buffers[index]);
  }

  if (process.argv[2]) {
    const samples = sizes.map((size, index) => [`PNG ${size} × ${size}`, size, dataImage('png', buffers[index])]);
    samples.push(['Master SVG', 128, dataImage('svg+xml', source)]);
    const figures = samples.map(([label, size, url]) => `<figure>
      <div><img width="${size}" height="${size}" src="${url}" alt=""></div>
      <figcaption>${label}</figcaption>
    </figure>`).join('');
    render(`<!doctype html><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      body { margin: 0; font: 14px system-ui, sans-serif; }
      section { height: 200px; padding: 14px 24px; }
      .dark { background: #22201f; color: #fff; }
      h1, h2 { margin: 0; font-size: 14px; font-weight: 600; }
      .samples { display: grid; grid-template-columns: repeat(4, 1fr); }
      figure { margin: 0; text-align: center; }
      figure div { display: grid; place-items: center; height: 134px; }
      figcaption { margin-top: 5px; }
    </style>
    <section><h1>White background</h1><div class="samples">${figures}</div></section>
    <section class="dark"><h2>Dark background</h2><div class="samples">${figures}</div></section>`,
    '--window-size=680,400', '--force-device-scale-factor=1', `--screenshot=${resolve(process.argv[2])}`);
  }
} finally {
  if (dirname(realpathSync(work)) === temp) rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
