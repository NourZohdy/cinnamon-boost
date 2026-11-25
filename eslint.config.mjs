const browser = Object.fromEntries(('window document console navigator location localStorage chrome URL URLSearchParams Blob Response Request Headers AbortController AbortSignal XMLHttpRequest Audio MutationObserver ResizeObserver IntersectionObserver ProgressEvent DOMException HTMLMediaElement Node performance setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame getComputedStyle fetch structuredClone module').split(' ').map(name => [name, 'readonly']));
const node = Object.fromEntries(('process console Buffer global globalThis Event EventTarget URL URLSearchParams Blob Response Request Headers AbortController AbortSignal setTimeout clearTimeout setInterval clearInterval structuredClone').split(' ').map(name => [name, 'readonly']));
const rules = { 'no-undef': 'error', 'no-dupe-args': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error' };
export default [
  { ignores: ['node_modules/**'] },
  { files: ['**/*.js'], languageOptions: { sourceType: 'script', globals: browser }, rules },
  { files: ['**/*.mjs'], languageOptions: { sourceType: 'module', globals: node }, rules },
];


