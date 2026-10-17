import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

function localAsset(reference, label) {
  assert(typeof reference === 'string' && reference.startsWith('assets/'), `${label} must be hosted with the site.`);
  const file = resolve(root, decodeURIComponent(reference));
  const pathWithinRoot = relative(root, file);
  assert(!pathWithinRoot.startsWith('..') && !isAbsolute(pathWithinRoot), `${label} leaves the site directory.`);
  assert(statSync(file).isFile(), `${label} is missing: ${reference}`);
  return file;
}

localAsset(data.video, 'Background video');
localAsset(data.poster, 'Background poster');
for (const icon of data.icons) localAsset(icon.image, icon.name);
const css = readFileSync(resolve(root, 'style.css'), 'utf8');
for (const match of css.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)) localAsset(match[1], 'Stylesheet asset');
const media = JSON.parse(readFileSync(resolve(root, 'assets/media/sources.json'), 'utf8'));
for (const entry of media.entries) {
  const file = localAsset(entry.path, 'Imported media');
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), entry.sha256,
    `Imported asset checksum differs: ${entry.path}`);
}
for (const match of html.matchAll(/data-brand-animation="([^"]+)"/g)) localAsset(match[1], 'Original logo animation');
const player = JSON.parse(readFileSync(resolve(root, 'assets/vendor/sources.json'), 'utf8'));
assert.equal(createHash('sha256').update(readFileSync(localAsset(player.file, 'Local animation player'))).digest('hex'), player.sha256,
  'The bundled animation player must match its recorded checksum.');
for (const key of ['music', 'videos']) {
  assert(Array.isArray(data[key]) && data[key].length > 0, `${key} must contain content.`);
  for (const item of data[key]) {
    assert(typeof item.title === 'string' && item.title.trim(), `${key} entry needs a title.`);
  }
}
for (const release of data.music) {
  localAsset(release.image, `${release.title} cover artwork`);
  assert(Array.isArray(release.services) && release.services.length > 0,
    `${release.title} needs streaming options.`);
  const names = new Set();
  for (const service of release.services) {
    assert(typeof service.name === 'string' && service.name.trim(), 'Streaming services need names.');
    assert(!names.has(service.name), `${release.title} has duplicate ${service.name} options.`);
    names.add(service.name);
    assert(new URL(service.url).protocol === 'https:', `${service.name} links must use HTTPS.`);
    assert(service.search === undefined || typeof service.search === 'boolean',
      'Search links must be marked explicitly.');
    assert(/^[a-z]+$/.test(service.icon), `${service.name} needs a local service icon.`);
    assert(statSync(resolve(root, 'assets/services', `${service.icon}.svg`)).isFile(),
      `Missing ${service.name} icon.`);
  }
}

const signup = html.match(/<a\b(?=[^>]*\bclass="signup-continue")([^>]*)>/i);
assert(signup, 'The signup dialog needs its direct Mailchimp button.');
const action = signup[1].match(/\bhref="([^"]+)"/i)?.[1];
const destination = new URL(action?.replaceAll('&amp;', '&'));
assert(destination.protocol === 'https:' && (destination.hostname === 'mailchi.mp' ||
  /\.list-manage\d?\.com$/.test(destination.hostname)), 'Signup must use a public HTTPS Mailchimp form.');
const dialog = html.match(/<dialog\b[^>]*id="signup-dialog"[\s\S]*?<\/dialog>/i)?.[0];
assert(dialog && !/<input\b/i.test(dialog), 'The signup popup must not ask for an email before opening Mailchimp.');
assert(/\btarget="_blank"/.test(signup[1]), 'The Mailchimp page must open in a new tab.');

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
