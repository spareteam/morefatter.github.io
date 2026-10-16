const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const fixture = path.join(__dirname, 'fixtures/background.webm');
const publicFiles = new Set(['index.html', 'style.css', 'app.js', 'shop.js', 'content.json']);
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=', 'base64');
let server;
let browser;
let origin;

before(async () => {
  server = http.createServer((request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!publicFiles.has(name)) return response.writeHead(404).end();
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
    response.setHeader('Content-Type', types[path.extname(name)]);
    response.end(fs.readFileSync(path.join(root, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function openPage(options = {}) {
  const { saveData, clock = false, ...contextOptions } = options;
  const context = await browser.newContext(contextOptions);
  if (saveData) {
    await context.addInitScript(() => Object.defineProperty(navigator, 'connection', {
      value: { saveData: true, addEventListener() {} },
    }));
  }
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    requests.push({ url: url.href, type: request.resourceType() });
    if (url.pathname.endsWith('.mp4')) return route.fulfill({ path: fixture, contentType: 'video/webm' });
    if (request.resourceType() === 'image') return route.fulfill({ body: image, contentType: 'image/png' });
    if (request.resourceType() === 'document') {
      return route.fulfill({ body: '<!doctype html><title>Test player</title><button>Player controls</button>', contentType: 'text/html' });
    }
    return route.abort();
  });
  if (clock) await page.clock.install();
  await page.goto(origin, { waitUntil: 'networkidle' });
  return { page, context, requests, errors };
}

async function choose(page, name) {
  await page.locator(`[data-panel="${name}"]`).click();
  await page.mouse.move(1, 1);
}

async function counter(page, kind) {
  return page.locator(`#${kind} .slide-counter`).innerText();
}

test('Small phones, landscape and desktop keep content and controls clear of the footer', async t => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 },
    { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    await t.test(`${viewport.width}×${viewport.height}`, async () => {
      const { page, context, errors } = await openPage({ viewport, reducedMotion: 'reduce' });
      try {
        for (const kind of ['music', 'video']) {
          await choose(page, kind);
          const layout = await page.evaluate(kind => {
            const bounds = selector => {
              const rect = document.querySelector(selector).getBoundingClientRect();
              return { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
            };
            return {
              main: bounds('main'), footer: bounds('footer'),
              dots: bounds(`#${kind} .dots`), dot: bounds(`#${kind} .dot`),
              controls: bounds(`#${kind} .carousel-controls`),
              overflow: document.documentElement.scrollWidth > innerWidth,
            };
          }, kind);
          assert.equal(layout.overflow, false);
          assert(layout.footer.top >= layout.main.bottom, 'Footer must follow the panel');
          assert(layout.dots.bottom <= layout.main.bottom, 'Pagination must stay within the panel');
          assert(layout.controls.bottom <= layout.main.bottom, 'Controls must stay within the panel');
          assert(layout.dot.width >= 44 && layout.dot.height >= 44, 'Dots need usable touch targets');
          await page.locator(`#${kind} .next`).scrollIntoViewIfNeeded();
          await page.locator(`#${kind} .next`).click();
          assert.equal(await counter(page, kind), `2 / ${kind === 'music' ? 8 : 10}`);
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }
});

test('Both carousels advance at eight seconds, wrap, and respect pause controls', async () => {
  const { page, context, errors } = await openPage({ viewport: { width: 1440, height: 900 }, clock: true });
  try {
    for (const kind of ['music', 'video']) {
      const count = kind === 'music' ? 8 : 10;
      await choose(page, kind);
      await page.clock.fastForward(7900);
      assert.equal(await counter(page, kind), `1 / ${count}`);
      await page.clock.fastForward(200);
      assert.equal(await counter(page, kind), `2 / ${count}`);
      await page.locator(`#${kind} .dot`).last().click();
      await page.mouse.move(1, 1);
      await page.clock.fastForward(12100);
      assert.equal(await counter(page, kind), `1 / ${count}`);
      await page.locator(`#${kind} .rotation-toggle`).click();
      await page.mouse.move(1, 1);
      await page.clock.fastForward(30000);
      assert.equal(await counter(page, kind), `1 / ${count}`);
      await page.locator(`#${kind} .rotation-toggle`).click();
      await page.mouse.move(1, 1);
      await page.clock.fastForward(8100);
      assert.equal(await counter(page, kind), `2 / ${count}`);
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

async function touchSwipe(page, dx, dy = 0) {
  const stage = page.locator('.panel:not([hidden]) .carousel-stage');
  await stage.scrollIntoViewIfNeeded();
  const bounds = await stage.boundingBox();
  const x = bounds.x + bounds.width / 2 - dx / 2;
  const y = Math.max(120, Math.min(bounds.y + bounds.height / 2, 550));
  const client = await page.context().newCDPSession(page);
  const point = (x, y) => ({ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 });
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(x, y)] });
    for (let step = 1; step <= 6; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(x + dx * step / 6, y + dy * step / 6)] });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await client.detach(); }
}

test('Native touch swipes browse both ways without opening a player, while vertical gestures scroll', async () => {
  const { page, context, errors } = await openPage({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  try {
    for (const kind of ['music', 'video']) {
      await choose(page, kind);
      const count = kind === 'music' ? 8 : 10;
      await touchSwipe(page, -140);
      assert.equal(await counter(page, kind), `2 / ${count}`);
      assert.equal(await page.locator(`#${kind} iframe`).count(), 0);
      await touchSwipe(page, 140);
      assert.equal(await counter(page, kind), `1 / ${count}`);
      const previousScroll = await page.evaluate(() => scrollY);
      await touchSwipe(page, 0, -140);
      assert.equal(await counter(page, kind), `1 / ${count}`);
      assert(await page.evaluate(() => scrollY) > previousScroll, 'Vertical gestures should scroll the page');
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Players load on demand and stop rotation and the decorative background until closed', async () => {
  const { page, context, requests, errors } = await openPage({ clock: true });
  try {
    await page.waitForFunction(() => !document.querySelector('.backdrop').paused);
    for (const kind of ['music', 'video']) {
      await choose(page, kind);
      assert.equal(await page.locator('iframe').count(), 0);
      const beforeRequests = requests.filter(request => request.type === 'document').length;
      const beforeCounter = await counter(page, kind);
      await page.locator(`#${kind} .play-preview`).click();
      await page.mouse.move(1, 1);
      await page.locator(`#${kind} iframe`).waitFor();
      assert.equal(requests.filter(request => request.type === 'document').length, beforeRequests + 1);
      assert.equal(await page.locator('.backdrop').evaluate(video => video.paused), true);
      assert.equal(await page.locator('.motion').isDisabled(), true);
      await page.clock.fastForward(30000);
      assert.equal(await counter(page, kind), beforeCounter);
      await page.locator(`#${kind} .close-player`).click();
      await page.mouse.move(1, 1);
      assert.equal(await page.locator('iframe').count(), 0);
      await page.waitForFunction(() => !document.querySelector('.backdrop').paused);
      await page.clock.fastForward(12100);
      assert.notEqual(await counter(page, kind), beforeCounter);
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Reduced motion and data saving avoid background video downloads and automatic rotation', async () => {
  for (const options of [{ reducedMotion: 'reduce' }, { saveData: true }]) {
    const { page, context, requests } = await openPage({ ...options, clock: true });
    try {
      await choose(page, 'music');
      await page.clock.fastForward(30000);
      assert.equal(await counter(page, 'music'), '1 / 8');
      assert.equal(await page.locator('.backdrop').getAttribute('src'), null);
      assert.equal(requests.some(request => request.url.includes('.mp4')), false);
      assert.equal(await page.locator('#music .rotation-toggle').innerText(), 'Play slideshow');
    } finally { await context.close(); }
  }
});

test('Visibility and hover suspend rotation; hiding the tab pauses its background', async () => {
  const { page, context } = await openPage({ clock: true });
  try {
    await choose(page, 'music');
    await page.locator('#music .carousel-stage').hover();
    await page.clock.fastForward(20000);
    assert.equal(await counter(page, 'music'), '1 / 8');
    await page.mouse.move(1, 1);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(20000);
    assert.equal(await counter(page, 'music'), '1 / 8');
    assert.equal(await page.locator('.backdrop').evaluate(video => video.paused), true);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(8100);
    assert.equal(await counter(page, 'music'), '2 / 8');
  } finally { await context.close(); }
});

test('Mailing list opens the actual Mailchimp form; Back and section URLs stay in sync', async () => {
  const { page, context } = await openPage({ reducedMotion: 'reduce' });
  try {
    const signup = page.getByRole('link', { name: /join the mailing list/i });
    assert.equal(await signup.getAttribute('href'), 'https://mailchi.mp/e55a52839a47/mf');
    const popupPromise = page.waitForEvent('popup');
    await signup.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(popup.url(), 'https://mailchi.mp/e55a52839a47/mf');
    await popup.close();
    assert.equal(await page.locator('input[type="email"]').count(), 0, 'Fans enter their email only in the real form');
    await choose(page, 'music');
    await choose(page, 'video');
    await page.goBack();
    assert.equal(await page.locator('#music').isVisible(), true);
    await page.evaluate(() => { location.hash = 'video'; });
    await page.waitForFunction(() => !document.querySelector('#video').hidden);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#video').isVisible(), false);
    assert.equal(await page.locator('[data-panel="video"]').evaluate(button => button === document.activeElement), true);
  } finally { await context.close(); }
});
