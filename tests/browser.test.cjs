const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const servedRoot = process.env.TEST_BUILT_SITE ? path.join(root, '_site') : root;
const fixture = path.join(__dirname, 'fixtures/background.webm');
const publicFiles = new Set(process.env.TEST_BUILT_SITE ? fs.readdirSync(servedRoot) :
  ['index.html', 'style.css', 'app.js', 'shop.js', 'content.json']);
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=', 'base64');
let server;
let browser;
let origin;

before(async () => {
  server = http.createServer((request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
    const baseline = ['baseline.html', 'baseline.css'].includes(name);
    if (!baseline && !publicFiles.has(name)) return response.writeHead(404).end();
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
    response.setHeader('Content-Type', types[path.extname(name)]);
    response.end(fs.readFileSync(path.join(baseline ? path.join(__dirname, 'fixtures') : servedRoot, name)));
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
  if (saveData) await context.addInitScript(() => Object.defineProperty(navigator, 'connection', {
    value: { saveData: true, addEventListener() {} },
  }));
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
    if (request.resourceType() === 'document') return route.fulfill({
      body: '<!doctype html><title>Test player</title><button>Player controls</button>', contentType: 'text/html',
    });
    return route.abort();
  });
  if (clock) await page.clock.install();
  await page.goto(origin, { waitUntil: 'networkidle' });
  return { page, context, requests, errors };
}

async function choose(page, name) {
  await page.locator(`[data-panel="${name}"]`).click();
}

async function index(page, kind) {
  return Number(await page.locator(`#${kind}-content`).getAttribute('data-index'));
}

function activePreview(page, kind) {
  return page.locator(`#${kind} .slide[data-active="true"] .${kind === 'music' ? 'music-preview' : 'video-preview'}`);
}

async function styleSnapshot(page) {
  return page.evaluate(() => {
    const selectors = ['header', '.wordmark', '.nav', '.nav button', '.socials', '.socials img',
      'footer', '.join', '.footer-image', '.footer-image.spotify', '.motion'];
    const properties = ['position', 'fontFamily', 'fontSize', 'fontWeight', 'color', 'backgroundColor',
      'borderRadius', 'paddingTop', 'paddingLeft', 'gap'];
    return Object.fromEntries(selectors.map(selector => {
      const node = document.querySelector(selector);
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return [selector, { ...Object.fromEntries(properties.map(property => [property, style[property]])),
        bounds: [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 10) / 10) }];
    }));
  });
}

test('Approved baseline typography, colors, controls and layout are preserved', async t => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await t.test(`${viewport.width}×${viewport.height}`, async () => {
      const { page, context } = await openPage({ viewport, reducedMotion: 'reduce' });
      try {
        const actual = await styleSnapshot(page);
        await page.goto(`${origin}/baseline.html`, { waitUntil: 'networkidle' });
        assert.deepEqual(actual, await styleSnapshot(page));
      } finally { await context.close(); }
    });
  }
});

test('Small phones, landscape and desktop keep carousel controls inside a usable scroll area', async t => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 },
    { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    await t.test(`${viewport.width}×${viewport.height}`, async () => {
      const { page, context, errors } = await openPage({ viewport, reducedMotion: 'reduce' });
      try {
        for (const kind of ['music', 'video']) {
          await choose(page, kind);
          const layout = await page.evaluate(kind => {
            const area = document.querySelector(`#${kind} .carousel-scroll-area`).getBoundingClientRect();
            const footer = document.querySelector('footer').getBoundingClientRect();
            const overlaps = area.left < footer.right && area.right > footer.left && area.top < footer.bottom && area.bottom > footer.top;
            return { overlaps, overflow: document.documentElement.scrollWidth > innerWidth, height: area.height };
          }, kind);
          assert.equal(layout.overlaps, false);
          assert.equal(layout.overflow, false);
          assert(layout.height > 0);
          await page.locator(`#${kind} .next`).click();
          assert.equal(await index(page, kind), 1);
          await page.locator(`#${kind} .dot`).last().click();
          assert.equal(await index(page, kind), kind === 'music' ? 7 : 9);
          assert.equal(await page.locator(`#${kind} .carousel-controls`).count(), 0);
          assert.equal(await page.locator(`#${kind} .preview-title`).count(), 0);
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }
});

test('Both carousels advance every three seconds even while hovered, wrap, and respect explicit pause', async () => {
  const { page, context, errors } = await openPage({ viewport: { width: 1440, height: 900 }, clock: true });
  try {
    for (const kind of ['music', 'video']) {
      await choose(page, kind);
      await activePreview(page, kind).hover();
      await page.clock.fastForward(2000);
      assert.equal(await index(page, kind), 0);
      await page.clock.fastForward(1200);
      assert.equal(await index(page, kind), 1, 'Hover must not disable auto-advance');
      await page.locator(`#${kind} .dot`).last().click();
      await page.clock.fastForward(3100);
      assert.equal(await index(page, kind), 0, 'Auto-advance should loop to the first item');
      await page.locator(`#${kind} .rotation-toggle`).click();
      await page.clock.fastForward(30000);
      assert.equal(await index(page, kind), 0);
      await page.locator(`#${kind} .rotation-toggle`).click();
      await page.clock.fastForward(3100);
      assert.equal(await index(page, kind), 1);
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

async function touchSwipe(page, dx, dy = 0, inspectDrag) {
  const viewport = page.locator('.panel:not([hidden]) .carousel-viewport');
  const area = page.locator('.panel:not([hidden]) .carousel-scroll-area');
  const bounds = await viewport.boundingBox();
  const visible = await area.boundingBox();
  const x = bounds.x + bounds.width / 2 - dx / 2;
  const top = Math.max(bounds.y, visible.y);
  const bottom = Math.min(bounds.y + bounds.height, visible.y + visible.height);
  const y = (top + bottom) / 2;
  const client = await page.context().newCDPSession(page);
  const point = (x, y) => ({ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 });
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(x, y)] });
    for (let step = 1; step <= 6; step++) await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [point(x + dx * step / 6, y + dy * step / 6)],
    });
    if (inspectDrag) {
      // Native touch moves may be coalesced until the next rendered frame.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await inspectDrag();
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await client.detach(); }
}

test('Native swipes follow the finger and finish with a horizontal animation in both directions', async () => {
  const { page, context, errors } = await openPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    for (const kind of ['music', 'video']) {
      await choose(page, kind);
      const transform = () => page.locator(`#${kind} .carousel-track`).evaluate(track => new DOMMatrix(getComputedStyle(track).transform).m41);
      const start = await transform();
      await touchSwipe(page, -140, 0, async () => {
        assert(Math.abs((await transform()) - start + 140) < 3, 'Slide must follow the finger at full distance');
      });
      assert.equal(await index(page, kind), 1);
      assert.equal(await page.locator(`#${kind}-content`).getAttribute('data-animating'), 'true');
      const animation = await page.locator(`#${kind} .carousel-track`).evaluate(track => track.getAnimations()[0]?.effect.getKeyframes());
      assert(animation?.length >= 2 && animation[0].transform !== animation[1].transform, 'Swipe needs a real horizontal transition');
      await page.waitForFunction(kind => document.querySelector(`#${kind}-content`).dataset.animating === 'false', kind);
      assert.equal(await page.locator('iframe').count(), 0, 'Swiping must not activate a player');
      await touchSwipe(page, 140);
      assert.equal(await index(page, kind), 0);
      await page.waitForFunction(kind => document.querySelector(`#${kind}-content`).dataset.animating === 'false', kind);
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Both carousels show grab cursors, switch to grabbing during mouse swipes, and reset on release', async () => {
  const { page, context, errors } = await openPage({ viewport: { width: 1440, height: 900 } });
  try {
    for (const kind of ['music', 'video']) {
      await choose(page, kind);
      const preview = activePreview(page, kind);
      const artwork = preview.locator('img');
      await preview.hover();
      assert.equal(await artwork.evaluate(node => getComputedStyle(node).cursor), 'grab');
      const bounds = await preview.boundingBox();
      await page.mouse.down();
      assert.equal(await artwork.evaluate(node => getComputedStyle(node).cursor), 'grabbing');
      await page.mouse.move(bounds.x + bounds.width / 2 - 140, bounds.y + bounds.height / 2, { steps: 6 });
      assert.equal(await artwork.evaluate(node => getComputedStyle(node).cursor), 'grabbing');
      await page.mouse.up();
      assert.equal(await index(page, kind), 1);
      await page.waitForFunction(kind => document.querySelector(`#${kind}-content`).dataset.animating === 'false', kind);
      assert.equal(await activePreview(page, kind).evaluate(node => getComputedStyle(node).cursor), 'grab');
      assert.equal(await page.locator('iframe').count(), 0, 'Dragging must not activate a player');
      assert.equal(await page.locator(`#${kind} .next`).evaluate(node => getComputedStyle(node).cursor), 'pointer');
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Short landscape screens scroll the carousel vertically without changing slides', async () => {
  const { page, context } = await openPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  try {
    await choose(page, 'music');
    await touchSwipe(page, 0, -80);
    await page.waitForFunction(() => document.querySelector('#music .carousel-scroll-area').scrollTop > 0);
    assert.equal(await index(page, 'music'), 0);
  } finally { await context.close(); }
});

test('Players load on demand and suspend rotation and background video until slideshow resume', async () => {
  const { page, context, requests, errors } = await openPage({ clock: true });
  try {
    await page.waitForFunction(() => !document.querySelector('.backdrop').paused);
    for (const kind of ['music', 'video']) {
      await choose(page, kind);
      assert.equal(await page.locator('iframe').count(), 0);
      const count = requests.filter(request => request.type === 'document').length;
      await activePreview(page, kind).click();
      await page.locator(`#${kind} iframe`).waitFor();
      assert.equal(requests.filter(request => request.type === 'document').length, count + 1);
      assert.equal(await page.locator('.backdrop').evaluate(video => video.paused), true);
      await page.clock.fastForward(30000);
      assert.equal(await index(page, kind), 0);
      assert.equal(await page.locator(`#${kind} .rotation-toggle`).innerText(), 'Resume slideshow');
      await page.locator(`#${kind} .rotation-toggle`).click();
      assert.equal(await page.locator('iframe').count(), 0);
      await page.waitForFunction(() => !document.querySelector('.backdrop').paused);
      await page.clock.fastForward(3100);
      assert.equal(await index(page, kind), 1);
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Reduced motion and data saving keep the background unloaded without silently disabling auto-advance', async () => {
  for (const options of [{ reducedMotion: 'reduce' }, { saveData: true }]) {
    const { page, context, requests } = await openPage({ ...options, clock: true });
    try {
      await choose(page, 'music');
      assert.equal(await page.locator('#music .rotation-toggle').innerText(), 'Pause slideshow');
      await page.clock.fastForward(3100);
      assert.equal(await index(page, 'music'), 1);
      assert.equal(await page.locator('.backdrop').getAttribute('src'), null);
      assert.equal(requests.some(request => request.url.includes('.mp4')), false);
      if (options.reducedMotion) assert.equal(await page.locator('#music-content').getAttribute('data-animating'), 'false');
    } finally { await context.close(); }
  }
});

test('Hiding the tab suspends rotation and background playback', async () => {
  const { page, context } = await openPage({ clock: true });
  try {
    await choose(page, 'music');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(20000);
    assert.equal(await index(page, 'music'), 0);
    assert.equal(await page.locator('.backdrop').evaluate(video => video.paused), true);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(3100);
    assert.equal(await index(page, 'music'), 1);
  } finally { await context.close(); }
});

test('The original JOIN control opens Mailchimp and browser navigation stays in sync', async () => {
  const { page, context } = await openPage({ reducedMotion: 'reduce' });
  try {
    const signup = page.getByRole('link', { name: 'Join the mailing list', exact: true });
    assert.equal(await signup.getAttribute('href'), 'https://mailchi.mp/e55a52839a47/mf');
    const popupPromise = page.waitForEvent('popup');
    await signup.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(popup.url(), 'https://mailchi.mp/e55a52839a47/mf');
    await popup.close();
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
