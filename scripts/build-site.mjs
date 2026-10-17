import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '_site');
rmSync(output, { recursive: true, force: true });
mkdirSync(output);

let html = readFileSync(resolve(root, 'index.html'), 'utf8');
for (const name of ['app.js', 'shop.js', 'style.css']) {
  const content = readFileSync(resolve(root, name));
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  const versioned = name.replace(/(\.[^.]+)$/, `.${hash}$1`);
  writeFileSync(resolve(output, versioned), content);
  const attribute = name === 'shop.js' ? 'data-shop-script' : name.endsWith('.css') ? 'href' : 'src';
  const reference = `${attribute}="${name}"`;
  if (!html.includes(reference)) throw new Error(`Missing asset reference: ${reference}`);
  html = html.replace(reference, `${attribute}="${versioned}"`);
}
writeFileSync(resolve(output, 'index.html'), html);
for (const name of ['content.json', '.nojekyll', 'music-links.html']) cpSync(resolve(root, name), resolve(output, name));
if (existsSync(resolve(root, 'assets'))) cpSync(resolve(root, 'assets'), resolve(output, 'assets'), { recursive: true });
writeFileSync(resolve(output, 'build-info.json'), JSON.stringify({
  commit: process.env.GITHUB_SHA || null,
  builtAt: new Date().toISOString(),
}) + '\n');
console.log('Built website with versioned assets in _site.');
