import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, isAbsolute } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const embedded = html.match(/<script\b(?=[^>]*\bid="site-data")[^>]*>([\s\S]*?)<\/script>/i);
assert(embedded, 'The page must contain its site-data JSON.');
const data = JSON.parse(embedded[1]);
assert.deepEqual(data, JSON.parse(readFileSync(resolve(root, 'content.json'), 'utf8')),
  'Update both index.html and content.json when editing site content.');
for (const key of ['music', 'videos']) {
  assert(Array.isArray(data[key]) && data[key].length > 0, `${key} must contain content.`);
  for (const item of data[key]) {
    assert(typeof item.title === 'string' && item.title.trim(), `${key} entry needs a title.`);
  }
}

const references = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
references.push('shop.js', '.nojekyll');
for (const reference of references) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) continue;
  const pathname = decodeURIComponent(reference.split(/[?#]/)[0]);
  if (!pathname) continue;
  const file = resolve(root, pathname);
  const pathWithinRoot = relative(root, file);
  assert(!pathWithinRoot.startsWith('..') && !isAbsolute(pathWithinRoot),
    `Local reference leaves the site directory: ${reference}`);
  assert(statSync(file).isFile(), `Missing local asset: ${reference}`);
}
console.log(`Site checks passed: ${data.music.length} releases, ${data.videos.length} videos; local assets exist.`);
