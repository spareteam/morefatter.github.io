const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const playwright = require('playwright');

const root = path.resolve(__dirname, '..');
const site = process.env.TEST_BUILT_SITE ? path.join(root, '_site') : root;
const engine = process.env.TEST_BROWSER || 'chromium';
const artifacts = path.join(root, 'test-results/device-audit', engine);
const profiles = [
  ['iphone-se', 320, 568], ['android-small', 360, 800],
  ['iphone-13-safari', 390, 664], ['iphone-13-full', 390, 844],
  ['iphone-large', 430, 932], ['phone-landscape', 844, 390],
  ['tablet-portrait', 768, 1024], ['tablet-landscape', 1024, 768],
  ['laptop', 1366, 768], ['desktop', 1440, 900], ['wide-desktop', 2560, 1080],
];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.mp4': 'video/mp4', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.ttf': 'font/ttf' };
let server, browser, origin;

before(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  server = http.createServer((request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
    const file = path.join(site, name);
    if (name.split('/').includes('..') || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
    const bytes = fs.readFileSync(file);
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.setHeader('Accept-Ranges', 'bytes');
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Math.min(range[2] ? Number(range[2]) : bytes.length - 1, bytes.length - 1);
      response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': end - start + 1 });
      return response.end(bytes.subarray(start, end + 1));
    }
    response.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright[engine].launch(engine === 'chromium' ? {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
  } : {});
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function open({ width = 390, height = 664, mobile = true, motion = 'no-preference' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: mobile,
    ...(engine === 'firefox' ? {} : { isMobile: mobile }), reducedMotion: motion });
  await context.addInitScript(() => localStorage.setItem('morefatter:signup:v1', JSON.stringify({ dismissed: true, visits: 3 })));
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#music .dot').last().waitFor({ state: 'attached' });
  await page.evaluate(() => document.fonts.ready);
  const press = locator => mobile ? locator.tap() : locator.click();
  return { context, page, errors, press };
}

const index = (page, kind) => page.locator(`#${kind}-content`).getAttribute('data-index').then(Number);
const preview = (page, kind) => page.locator(`#${kind} .slide[data-active="true"] .${kind === 'music' ? 'music-preview' : 'video-preview'}`);
const nextFrame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const settled = (page, kind) => page.waitForFunction(kind => document.querySelector(`#${kind}-content`).dataset.animating === 'false', kind);

async function drag(page, kind, distance, duration = 480) {
  const box = await preview(page, kind).boundingBox();
  const area = await page.locator(`#${kind} .carousel-scroll-area`).boundingBox();
  const x = box.x + box.width / 2;
  const y = (Math.max(box.y, area.y) + Math.min(box.y + box.height, area.y + area.height)) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let n = 1; n <= 6; n++) {
    await page.mouse.move(x + distance * n / 6, y + n / 2);
    await page.waitForTimeout(duration / 6);
  }
  await page.mouse.up();
}

test('Device audit: iPhone 13 music and video auto-advance after dismissing signup', async () => {
  const { page, context, errors, press } = await open();
  try {
    await press(page.locator('.join'));
    await press(page.locator('.signup-close'));
    for (const kind of ['music', 'video']) {
      await press(page.locator(`[data-panel="${kind}"]`));
      assert.equal(await index(page, kind), 0);
      await page.waitForFunction(kind => document.querySelector(`#${kind}-content`).dataset.index === '1', kind, { timeout: 5000 });
      await settled(page, kind);
      const active = preview(page, kind);
      assert(await active.isVisible(), `${kind}: the new slide must be visible`);
      const track = await page.locator(`#${kind} .carousel-track`).evaluate(track => ({
        x: new DOMMatrix(getComputedStyle(track).transform).m41, width: track.getBoundingClientRect().width,
      }));
      assert(Math.abs(track.x + track.width * 2) < 2, `${kind}: the actual track must advance with its index`);
      if (kind === 'music') assert(await active.locator('img').evaluate(image => image.complete && image.naturalWidth > 0));
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Device audit: lost artwork capture cannot freeze Music while Video keeps advancing', async () => {
  const { page, context, errors, press } = await open();
  try {
    await press(page.locator('[data-panel="music"]'));
    const art = preview(page, 'music').locator('img');
    await art.evaluate(image => image.addEventListener('pointerdown', event => {
      // Touch browsers implicitly capture on the original artwork, before a
      // horizontal drag is recognized. Exercise that native capture lifecycle.
      image.dataset.pointer = String(event.pointerId);
      image.setPointerCapture(event.pointerId);
    }, { once: true }));
    const box = await art.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2);
    await art.evaluate(image => image.releasePointerCapture(Number(image.dataset.pointer)));
    await page.mouse.move(2, 2);
    await page.mouse.up();
    await page.waitForTimeout(3500);
    const musicIndex = await index(page, 'music');
    await press(page.locator('[data-panel="video"]'));
    await page.waitForFunction(() => document.querySelector('#video-content').dataset.index === '1', null, { timeout: 5000 });
    assert.equal(musicIndex, 1, 'Music must recover after artwork capture is lost, just as Video keeps advancing');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Device audit: short, gentle swipes animate both directions without activating covers', async () => {
  const { page, context, errors, press } = await open();
  try {
    for (const kind of ['music', 'video']) {
      await press(page.locator(`[data-panel="${kind}"]`));
      await drag(page, kind, -24);
      assert.equal(await index(page, kind), 1, `${kind}: a gentle 24px drag should advance`);
      assert.equal(await page.locator(`#${kind}-content`).getAttribute('data-animating'), 'true');
      await settled(page, kind);
      await drag(page, kind, 24);
      assert.equal(await index(page, kind), 0);
      await settled(page, kind);
      assert.equal(await page.locator('.stream-options, iframe').count(), 0, 'A swipe must not become an artwork click');
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Device audit: releasing outside the artwork and rotating the phone resume auto-advance', async () => {
  const { page, context, errors, press } = await open();
  try {
    for (const kind of ['music', 'video']) {
      await press(page.locator(`[data-panel="${kind}"]`));
      const art = preview(page, kind);
      let box = await art.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(2, 2);
      await page.mouse.up();
      await page.waitForFunction(kind => document.querySelector(`#${kind}-content`).dataset.index === '1', kind, { timeout: 5000 });
      await settled(page, kind);
      box = await preview(page, kind).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.setViewportSize({ width: 844, height: 390 });
      await nextFrame(page);
      await page.mouse.up();
      await page.waitForFunction(kind => document.querySelector(`#${kind}-content`).dataset.index === '2', kind, { timeout: 5000 });
      await page.setViewportSize({ width: 390, height: 664 });
      await nextFrame(page);
      assert.equal(await page.locator('.stream-options, iframe').count(), 0);
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Device audit: responsive layouts and controls', async t => {
  for (const [name, width, height] of profiles) await t.test(name, async () => {
    const { page, context, errors, press } = await open({ width, height, mobile: width < 1100, motion: 'reduce' });
    const shot = view => page.screenshot({ path: path.join(artifacts, `${name}-${view}.png`) });
    try {
      await nextFrame(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      for (const selector of ['.wordmark', '.nav', '.socials', 'footer', '.motion']) {
        const box = await page.locator(selector).boundingBox();
        assert(box.x >= -1 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height, `${name}: ${selector} must fit`);
      }
      await shot('home');
      for (const kind of ['music', 'video']) {
        await press(page.locator(`[data-panel="${kind}"]`));
        await nextFrame(page);
        await press(page.locator(`#${kind} .rotation-toggle`));
        await press(page.locator(`#${kind} .next`));
        assert.equal(await index(page, kind), 1);
        await press(page.locator(`#${kind} .prev`));
        assert.equal(await index(page, kind), 0);
        const area = await page.locator(`#${kind} .carousel-scroll-area`).boundingBox();
        const footer = await page.locator('footer').boundingBox();
        assert(area.height > 0 && area.y + area.height <= footer.y, `${name}: ${kind} must clear the footer`);
        await shot(kind);
        if (kind === 'music') {
          const before = await preview(page, kind).boundingBox();
          await press(preview(page, kind));
          const chooser = page.locator('#music .stream-options');
          const after = await chooser.boundingBox();
          assert(Math.abs(after.width - after.height) <= 1 && Math.abs(before.width - after.width) <= 1, `${name}: chooser must match the cover square`);
          const last = chooser.locator('.stream-service').last();
          await last.scrollIntoViewIfNeeded();
          assert(await last.isVisible());
          await shot('chooser');
          await press(chooser.locator('.stream-back'));
        }
      }
      for (const kind of ['tour', 'shop']) {
        await press(page.locator(`[data-panel="${kind}"]`));
        const close = page.locator(`#${kind} > .close`);
        const panel = await page.locator(`#${kind}`).boundingBox();
        const box = await close.boundingBox();
        assert(box.x >= panel.x && box.y >= panel.y && box.x + box.width <= panel.x + panel.width, `${name}: ${kind} close button must fit`);
        await shot(kind);
        await press(close);
      }
      await press(page.locator('.join'));
      const dialog = await page.locator('#signup-dialog').boundingBox();
      for (const selector of ['body > header', '.nav', '.socials', 'footer', '.motion']) {
        const control = await page.locator(selector).boundingBox();
        const overlaps = dialog.x < control.x + control.width && dialog.x + dialog.width > control.x && dialog.y < control.y + control.height && dialog.y + dialog.height > control.y;
        assert.equal(overlaps, false, `${name}: signup must clear ${selector}`);
      }
      const cta = await page.locator('.signup-continue').boundingBox();
      assert(cta.y >= dialog.y && cta.y + cta.height <= dialog.y + dialog.height);
      await shot('signup');
      await press(page.locator('.signup-close'));
      assert.deepEqual(errors, []);
    } catch (error) {
      await shot('failure');
      throw error;
    } finally { await context.close(); }
  });
});
