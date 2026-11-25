// A space after the colon of a pseudo-class ("input: checked {") silently disables the rule. Run: node tests/test_css.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const file of ['src/popup/popup.css', 'src/page/content.css']) {
  readFileSync(new URL('../' + file, import.meta.url), 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (!line.includes('{') || line.trimStart().startsWith('@')) return;
    const selector = line.slice(0, line.indexOf('{')).replace(/\[[^\]]*\]/g, '[]');   // attribute values like [style*="display: none"] are fine
    assert.doesNotMatch(selector, /[\w\])]: +[a-z-]+/, `${file}:${i + 1} has a space after a pseudo-class colon: ${selector.trim()}`);
  });
}
console.log('css selector check passed');
