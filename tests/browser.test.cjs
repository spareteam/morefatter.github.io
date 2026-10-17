const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const releases = JSON.parse(fs.readFileSync(path.join(root, 'content.json'), 'utf8')).music;
const servedRoot = process.env.TEST_BUILT_SITE ? path.join(root, '_site') : root;
const fixture = path.join(__dirname, 'fixtures/background.webm');
const mediaSources = JSON.parse(fs.readFileSync(path.join(root, 'assets/media/sources.json'), 'utf8')).entries;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const publicFiles = new Set(process.env.TEST_BUILT_SITE ? fs.readdirSync(servedRoot) :
  ['index.html', 'style.css', 'app.js', 'shop.js', 'content.json', 'music-links.html']);
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=', 'base64');
let server;
let browser;
let origin;

before(async () => {
  server = http.createServer((request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
    const baseline = ['baseline.html', 'baseline.css'].includes(name);
    const localAsset = name.startsWith('assets/') && !name.split('/').includes('..') &&
      fs.existsSync(path.join(servedRoot, name)) && fs.statSync(path.join(servedRoot, name)).isFile();
    if (!baseline && !publicFiles.has(name) && !localAsset) return response.writeHead(404).end();
    response.setHeader('Content-Type', types[path.extname(name)] || 'application/octet-stream');
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
  const { saveData, clock = false, signupState, storageUnavailable, realMedia = false, query = '', ...contextOptions } = options;
  const context = await browser.newContext(contextOptions);
  if (signupState) await context.addInitScript(state => {
    localStorage.setItem('morefatter:signup:v1', JSON.stringify(state));
  }, signupState);
  if (storageUnavailable) await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage unavailable', 'SecurityError'); } });
  });
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
    requests.push({ url: url.href, type: request.resourceType(), method: request.method(), body: request.postData() });
    // A short fixture keeps long background downloads from blocking timer-driven tests.
    if (url.pathname.endsWith('.mp4') && !realMedia) return route.fulfill({ path: fixture, contentType: 'video/webm' });
    if (url.origin === origin) return route.continue();
    // Compare the approved baseline with the same original font and image bytes.
    const imported = mediaSources.find(asset => asset.source === url.href);
    if (imported) return route.fulfill({ path: path.join(root, imported.path), contentType: types[path.extname(imported.path)] });
    if (request.resourceType() === 'image') return route.fulfill({ body: image, contentType: 'image/png' });
    if (request.resourceType() === 'document') return route.fulfill({
      body: '<!doctype html><title>Test player</title><button>Player controls</button>', contentType: 'text/html',
    });
    return route.abort();
  });
  if (clock) await page.clock.install();
  await page.goto(origin + query, { waitUntil: 'networkidle' });
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

test('Owned artwork, logos, font and background video work without third-party media requests', async () => {
  const { page, context, requests, errors } = await openPage({ reducedMotion: 'reduce', clock: true, realMedia: true });
  try {
    const decoded = await page.evaluate(async () => {
      const data = JSON.parse(document.querySelector('#site-data').textContent);
      const urls = [...new Set([data.poster, ...data.music.map(release => release.image),
        ...[...document.querySelectorAll('.socials img, footer img')].map(image => image.getAttribute('src'))])];
      const images = await Promise.all(urls.map(async url => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return { local: new URL(image.src).origin === location.origin, width: image.naturalWidth, height: image.naturalHeight };
      }));
      await document.fonts.load('48px Advert');
      return { images, fontLoaded: [...document.fonts].some(font => font.family === 'Advert' && font.status === 'loaded') };
    });
    assert(decoded.images.every(image => image.local && image.width > 0 && image.height > 0));
    assert.equal(decoded.fontLoaded, true);
    await page.locator('.motion').click();
    await page.waitForFunction(() => {
      const video = document.querySelector('.backdrop');
      if (video.error) throw new Error(`The test browser could not decode the original H.264 film: ${video.error.message}`);
      return !video.paused && video.readyState >= 2 && video.videoWidth > 0;
    });
    assert.equal(await page.locator('.backdrop').evaluate(video => new URL(video.currentSrc).origin === location.origin), true);
    assert.equal(requests.some(request => /website-files\.com|ffmcdn\.com|imagestore\.ffm\.to/.test(new URL(request.url).hostname)), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Original title pulse and bird flutter loop locally and respect pause and reduced motion', async () => {
  const { page, context, requests, errors } = await openPage({ clock: true });
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('[data-brand-animation]')]
      .every(container => container.dataset.animationState === 'playing'));
    const frames = () => page.evaluate(() => lottie.getRegisteredAnimations().map(animation => ({
      name: animation.name, frame: animation.currentFrame, paused: animation.isPaused,
      loop: animation.loop, frames: animation.totalFrames, rate: animation.frameRate,
    })).sort((a, b) => a.name.localeCompare(b.name)));
    const initial = await frames();
    assert.deepEqual(initial.map(({ name, loop, frames, rate }) => ({ name, loop, frames, rate })), [
      { name: 'bird', loop: true, frames: 40, rate: 30 },
      { name: 'title', loop: true, frames: 50, rate: 25 },
    ]);
    await page.clock.runFor(650);
    const moving = await frames();
    assert(moving.every((animation, index) => !animation.paused && animation.frame !== initial[index].frame));
    assert.equal(await page.locator('.links-mark').getAttribute('href'), 'https://www.linktr.ee/morefatter');
    assert.equal(await page.locator('.links-mark .brand-player svg').count(), 1);
    await page.locator('.motion').click();
    const paused = await frames();
    assert(paused.every(animation => animation.paused));
    await page.clock.runFor(500);
    assert.deepEqual(await frames(), paused);
    await page.locator('.motion').click();
    await page.clock.runFor(200);
    assert((await frames()).every(animation => !animation.paused));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => lottie.getRegisteredAnimations().every(animation => animation.isPaused && animation.currentFrame === 0));
    assert.equal(requests.some(request => /website-files\.com|ffmcdn\.com/.test(new URL(request.url).hostname)), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('The link helper shows only unfinished services, rejects invalid links and copies a saved reply', async () => {
  const { page, context, errors } = await openPage({ query: '/music-links.html', viewport: { width: 390, height: 844 } });
  try {
    const missing = releases.flatMap(release => release.services.filter(service => service.search)
      .map(service => ({ release: release.title, service: service.name })));
    await page.locator('#actions').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.row input').count(), missing.length);
    const input = page.locator('.row input').first();
    const copy = page.getByRole('button', { name: 'Copy links', exact: true });
    await input.fill('https://example.com/album/not-the-music-service');
    await copy.click();
    assert.equal(await input.getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#output').isVisible(), false);
    // A known URL exercises collection and storage, without claiming title verification.
    const sample = releases.flatMap(release => release.services).find(service => service.name === missing[0].service && !service.search).url;
    await input.fill(sample);
    await copy.click();
    assert.deepEqual(JSON.parse(await page.locator('#collected').inputValue()).links,
      [{ ...missing[0], url: sample }]);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await input.inputValue(), sample);
    await page.locator('.row .fields button').first().click();
    assert.equal(await input.inputValue(), '');
    await page.locator('.row > button').first().click();
    await copy.click();
    assert.deepEqual(JSON.parse(await page.locator('#collected').inputValue()).links,
      [{ ...missing[0], status: 'not_found' }]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Tour and merch scroll inside their containers while padded close buttons stay reachable', async t => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 },
    { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await t.test(`${viewport.width}×${viewport.height}`, async () => {
      const { page, context, errors } = await openPage({ viewport, reducedMotion: 'reduce', clock: true });
      try {
        for (const kind of ['tour', 'shop']) {
          await choose(page, kind);
          const selector = kind === 'tour' ? '.tour-wrap' : '.shop-wrap';
          await page.locator(selector).evaluate(container => {
            const spacer = document.createElement('div');
            spacer.style.height = '1600px';
            const last = document.createElement('button');
            last.className = 'test-last-item';
            last.textContent = 'Last event or product';
            container.append(spacer, last);
          });
          const close = page.locator(`#${kind} > .close`);
          const checkClose = async () => {
            const panel = await page.locator(`#${kind}`).boundingBox();
            const bounds = await close.boundingBox();
            assert(bounds.x >= panel.x + 8 && bounds.y >= panel.y + 8 &&
              bounds.x + bounds.width <= panel.x + panel.width - 8 && bounds.y + bounds.height <= panel.y + panel.height,
              `${kind}: the whole close button needs padding inside its container`);
            assert.equal(await close.evaluate(button => {
              const bounds = button.getBoundingClientRect();
              return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === button;
            }), true, `${kind}: the close button must remain clickable`);
          };
          await checkClose();
          const last = page.locator(`${selector} .test-last-item`);
          await last.scrollIntoViewIfNeeded();
          const scrolling = await page.locator(selector).evaluate(container => ({
            inner: container.scrollTop, outer: container.parentElement.scrollTop,
            page: document.scrollingElement.scrollTop,
          }));
          assert(scrolling.inner > 0, `${kind}: long contents should scroll inside the container`);
          assert.equal(scrolling.outer, 0);
          assert.equal(scrolling.page, 0);
          const innerBounds = await page.locator(selector).boundingBox();
          const lastBounds = await last.boundingBox();
          assert(lastBounds.y >= innerBounds.y && lastBounds.y + lastBounds.height <= innerBounds.y + innerBounds.height + 1);
          await checkClose();
          await close.click();
          assert.equal(await page.locator(`#${kind}`).isVisible(), false);
        }
        assert.deepEqual(errors, []);
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
          assert.equal(await index(page, kind), kind === 'music' ? releases.length - 1 : 9);
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

test('Video players load on demand and suspend rotation and background video until slideshow resume', async () => {
  const { page, context, requests, errors } = await openPage({ clock: true });
  try {
    await page.waitForFunction(() => !document.querySelector('.backdrop').paused);
    for (const kind of ['video']) {
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

test('Every music cover and title opens services in place, pauses rotation, and removes the outdated playlist', async () => {
  const { page, context, requests, errors } = await openPage({ clock: true });
  try {
    await choose(page, 'music');
    assert.equal(await page.locator('#music .dot').count(), 7);
    assert.equal(await page.getByRole('button', { name: 'More Fatter Complete', exact: true }).count(), 0);
    const url = page.url();
    const externalDocuments = () => requests.filter(request => request.type === 'document' && !request.url.startsWith(origin)).length;
    const initialDocuments = externalDocuments();
    for (let selected = 0; selected < releases.length; selected++) {
      const release = releases[selected];
      await page.locator('#music .dot').nth(selected).click();
      await activePreview(page, 'music').click();
      const options = page.getByRole('group', { name: `Streaming options for ${release.title}`, exact: true });
      assert.equal(await options.isVisible(), true);
      assert.equal(await page.locator('iframe').count(), 0);
      assert.equal(externalDocuments(), initialDocuments, 'Choosing a release must not load another page or widget');
      assert.equal(context.pages().length, 1);
      assert.equal(page.url(), url);
      const links = await options.locator('a').evaluateAll(nodes => nodes.map(node => ({
        url: node.href, search: node.dataset.search === 'true', target: node.target,
        text: node.textContent, cursor: getComputedStyle(node).cursor,
      })));
      assert.equal(links.length, release.services.length);
      for (const [i, link] of links.entries()) {
        const expected = release.services[i];
        assert.equal(link.url, expected.url);
        assert.equal(link.search, Boolean(expected.search));
        assert(link.text.includes(expected.name));
        if (expected.search) assert(link.text.includes('Search'));
        assert.equal(link.target, '_blank');
        assert.equal(link.cursor, 'pointer');
      }
      await page.waitForFunction(() => [...document.querySelectorAll('#music .stream-icon')]
        .every(icon => icon.complete && icon.naturalWidth > 0));
      assert.equal(await options.locator('.stream-icon').count(), release.services.length);
      await page.clock.fastForward(15000);
      assert.equal(await index(page, 'music'), selected, 'Service choices must stay open while reading');
      await options.getByRole('button', { name: 'Back to artwork' }).click();
      assert.equal(await activePreview(page, 'music').isVisible(), true);
      await page.locator('#music .slide[data-active="true"] .release-title').click();
      assert.equal(await options.isVisible(), true, 'Titles must open the same service chooser');
      await page.locator('#music .rotation-toggle').click();
      assert.equal(await options.count(), 0);
    }
    await page.clock.fastForward(3100);
    assert.equal(await index(page, 'music'), 0, 'Resume must restore looping auto-advance');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Streaming links open the chosen service while keyboard dismissal and navigation return to the artwork', async () => {
  const { page, context } = await openPage({ clock: true });
  try {
    await choose(page, 'music');
    await page.locator('#music .slide[data-active="true"] .release-title').focus();
    await page.keyboard.press('Enter');
    const firstLink = page.locator('#music .stream-service').first();
    assert.equal(await firstLink.evaluate(node => node === document.activeElement), true);
    const popupPromise = page.waitForEvent('popup');
    await firstLink.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(popup.url(), releases[0].services[0].url);
    await popup.close();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#music').isVisible(), true);
    assert.equal(await activePreview(page, 'music').evaluate(node => node === document.activeElement), true);
    await activePreview(page, 'music').click();
    await choose(page, 'video');
    await choose(page, 'music');
    assert.equal(await page.locator('#music .stream-options').count(), 0);
    assert.equal(await activePreview(page, 'music').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#music').isVisible(), false);
  } finally { await context.close(); }
});

test('Carousels are vertically centered with lighter titles, and the shop is narrow and centered', async t => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await t.test(`${viewport.width}×${viewport.height}`, async () => {
      const { page, context } = await openPage({ viewport, reducedMotion: 'reduce', clock: true });
      try {
        for (const kind of ['music', 'video']) {
          await choose(page, kind);
          const layout = await page.evaluate(kind => {
            const area = document.querySelector(`#${kind} .carousel-scroll-area`).getBoundingClientRect();
            const preview = document.querySelector(`#${kind} .carousel-viewport`).getBoundingClientRect();
            const toggle = document.querySelector(`#${kind} .rotation-toggle`).getBoundingClientRect();
            const groupHeight = toggle.bottom - preview.top;
            const groupCenter = (toggle.bottom + preview.top) / 2;
            const areaCenter = (area.bottom + area.top) / 2;
            const title = document.querySelector(`#${kind} .slide-title`);
            return { groupHeight, areaHeight: area.height, difference: Math.abs(groupCenter - areaCenter),
              weight: getComputedStyle(title).fontWeight };
          }, kind);
          if (layout.groupHeight <= layout.areaHeight) assert(layout.difference <= 8, `${kind} should be vertically centered`);
          assert.equal(layout.weight, '500');
        }
        await choose(page, 'shop');
        const bounds = await page.locator('#shop').boundingBox();
        assert(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) <= 1);
        if (viewport.width > 700) assert(bounds.width >= viewport.width / 3 && bounds.width <= viewport.width / 2);
        else assert(bounds.width <= viewport.width - 40);
        const close = page.locator('#shop > .close');
        const closeBounds = await close.boundingBox();
        assert(closeBounds.y >= bounds.y && closeBounds.x >= bounds.x, 'The narrower shop must not clip its close button');
        await close.click();
        assert.equal(await page.locator('#shop').isVisible(), false);
      } finally { await context.close(); }
    });
  }
});

test('Every streaming choice stays reachable on small phones and short landscape screens', async t => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await t.test(`${viewport.width}×${viewport.height}`, async () => {
      const { page, context } = await openPage({ viewport, reducedMotion: 'reduce', clock: true });
      try {
        await choose(page, 'music');
        await activePreview(page, 'music').click();
        for (const service of await page.locator('#music .stream-service').all()) {
          await service.scrollIntoViewIfNeeded();
          const bounds = await service.boundingBox();
          const area = await page.locator('#music .carousel-scroll-area').boundingBox();
          assert(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
          assert(bounds.y >= area.y - 1 && bounds.y + bounds.height <= area.y + area.height + 1);
        }
        await page.getByRole('button', { name: 'Back to artwork' }).click();
        assert.equal(await activePreview(page, 'music').isVisible(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      } finally { await context.close(); }
    });
  }
});

test('Every chooser matches its cover square exactly, keeps titles in place, and resizes with the viewport', async t => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 },
    { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await t.test(`${viewport.width}×${viewport.height}`, async () => {
      const { page, context, errors } = await openPage({ viewport, reducedMotion: 'reduce', clock: true });
      try {
        await choose(page, 'music');
        await page.locator('#music .rotation-toggle').click();
        for (let selected = 0; selected < releases.length; selected++) {
          await page.locator('#music .dot').nth(selected).click();
          const preview = activePreview(page, 'music');
          await preview.scrollIntoViewIfNeeded();
          const before = await preview.boundingBox();
          const title = page.locator('#music .slide[data-active="true"] .slide-title');
          const titleBefore = await title.boundingBox();
          await preview.click();
          const chooser = page.locator('#music .stream-options');
          const after = await chooser.boundingBox();
          for (const dimension of ['width', 'height', 'x', 'y']) {
            assert(Math.abs(before[dimension] - after[dimension]) <= 1,
              `${releases[selected].title}: chooser ${dimension} should match the cover`);
          }
          assert(Math.abs(after.width - after.height) <= 1, 'The chooser must stay square');
          assert(Math.abs((await title.boundingBox()).y - titleBefore.y) <= 1, 'Opening the chooser must not move the title');
          const serviceArea = page.locator('#music .stream-services');
          for (const service of await chooser.locator('a').all()) {
            await service.scrollIntoViewIfNeeded();
            const box = await service.boundingBox();
            const scrollBox = await serviceArea.boundingBox();
            assert(box.y >= scrollBox.y - 1 && box.y + box.height <= scrollBox.y + scrollBox.height + 1,
              'Every service must scroll into the square');
          }
          await chooser.getByRole('button', { name: 'Back to artwork' }).click();
        }
        await page.locator('#music .dot').first().click();
        await activePreview(page, 'music').click();
        const resized = viewport.width > 700 ? { width: 390, height: 844 } : { width: 1440, height: 900 };
        await page.setViewportSize(resized);
        const chooser = await page.locator('#music .stream-options').boundingBox();
        assert(Math.abs(chooser.width - chooser.height) <= 1, 'Resizing must preserve the square');
        await page.getByRole('button', { name: 'Back to artwork' }).click();
        const cover = await activePreview(page, 'music').boundingBox();
        assert(Math.abs(chooser.width - cover.width) <= 1 && Math.abs(chooser.height - cover.height) <= 1);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }
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

test('The original JOIN control opens signup and browser navigation stays in sync', async () => {
  const { page, context } = await openPage({ reducedMotion: 'reduce' });
  try {
    const signup = page.getByRole('link', { name: 'Join the mailing list', exact: true });
    assert.equal(await signup.getAttribute('href'), 'https://mailchi.mp/e55a52839a47/mf');
    await signup.click();
    assert.equal(await page.locator('#signup-dialog').isVisible(), true);
    await page.getByRole('button', { name: 'Close mailing list signup' }).click();
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

test('Signup appears after twelve seconds, shows the band note, and remembers dismissal across reloads', async () => {
  const { page, context, errors } = await openPage({ clock: true });
  try {
    await page.waitForFunction(() => !document.querySelector('.backdrop').paused);
    await page.clock.fastForward(10000);
    assert.equal(await page.locator('#signup-dialog').isVisible(), false);
    await page.clock.fastForward(2500);
    const dialog = page.getByRole('dialog', { name: 'Hello visitor,' });
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await dialog.evaluate(node => node.matches(':modal')), true);
    assert.equal(await dialog.locator('ol li').count(), 5);
    assert((await dialog.innerText()).includes('We will always love you and cherish you.'));
    assert.equal(await page.locator('.backdrop').evaluate(video => video.paused), true);
    await dialog.getByRole('button', { name: 'Close mailing list signup' }).click();
    await page.waitForFunction(() => !document.querySelector('.backdrop').paused);
    await page.reload({ waitUntil: 'networkidle' });
    await page.clock.fastForward(30000);
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('morefatter:signup:v1')).visits), 1);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Automatic signup waits for panels and hidden tabs, and keyboard dismissal preserves the active panel', async () => {
  const { page, context } = await openPage({ clock: true });
  try {
    await choose(page, 'music');
    await page.clock.fastForward(15000);
    assert.equal(await page.locator('#signup-dialog').isVisible(), false);
    await page.locator('#music > .close').click();
    assert.equal(await page.locator('#signup-dialog').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#signup-dialog').isVisible(), false);
    await choose(page, 'music');
    const selected = await index(page, 'music');
    await page.locator('.join').click();
    await page.clock.fastForward(15000);
    await page.keyboard.press('ArrowRight');
    assert.equal(await index(page, 'music'), selected);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#signup-dialog').evaluate(dialog => dialog.contains(document.activeElement)), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#music').isVisible(), true);
    assert.equal(await page.locator('.join').evaluate(node => node === document.activeElement), true);
    await page.clock.fastForward(3100);
    assert.equal(await index(page, 'music'), (selected + 1) % releases.length);
  } finally { await context.close(); }
  const hidden = await openPage({ clock: true });
  try {
    await hidden.page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await hidden.page.clock.fastForward(15000);
    assert.equal(await hidden.page.locator('#signup-dialog').isVisible(), false);
    await hidden.page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await hidden.page.locator('#signup-dialog').isVisible(), true);
  } finally { await hidden.context.close(); }
});

test('Signup can appear on a second visit but not a third, after handoff, or twice in the same visit', async () => {
  const old = Date.now() - 31 * 60 * 1000;
  for (const [signupState, expected] of [
    [{ visits: 1, lastVisitAt: old, shownVisit: 1 }, true],
    [{ visits: 2, lastVisitAt: old, shownVisit: 2 }, false],
    [{ visits: 1, lastVisitAt: old, continued: true }, false],
    [{ visits: 1, lastVisitAt: Date.now(), shownVisit: 1 }, false],
  ]) {
    const { page, context } = await openPage({ signupState, clock: true });
    try {
      await page.clock.fastForward(15000);
      assert.equal(await page.locator('#signup-dialog').isVisible(), expected);
    } finally { await context.close(); }
  }
});

test('Signup validates email and hands it to the configured Mailchimp form without claiming a subscription', async () => {
  const { page, context, requests, errors } = await openPage({ clock: true });
  try {
    await page.locator('.join').click();
    const dialog = page.locator('#signup-dialog');
    const email = dialog.getByLabel('Your email address');
    const submit = dialog.locator('button[type="submit"]');
    await submit.click();
    assert.equal(await email.evaluate(node => node.validity.valueMissing), true);
    await email.fill('not-an-email');
    await submit.click();
    assert.equal(await email.evaluate(node => node.validity.typeMismatch), true);
    assert.equal(requests.filter(request => request.type === 'document' && !request.url.startsWith(origin)).length, 0);
    const address = 'fan@example.test';
    await email.fill(address);
    const form = dialog.locator('form');
    const action = await form.getAttribute('action');
    const method = (await form.getAttribute('method')).toUpperCase();
    const popupPromise = page.waitForEvent('popup');
    await submit.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    const request = requests.find(request => request.type === 'document' && !request.url.startsWith(origin));
    assert.equal(request.method, method);
    const destination = new URL(request.url);
    assert.equal(destination.origin + destination.pathname, new URL(action).origin + new URL(action).pathname);
    const fields = method === 'POST' ? new URLSearchParams(request.body) : destination.searchParams;
    assert.equal(fields.get('EMAIL'), address);
    assert((await dialog.locator('[role="status"]').innerText()).includes('Finish signing up'));
    const saved = await page.evaluate(() => localStorage.getItem('morefatter:signup:v1'));
    assert.equal(JSON.parse(saved).continued, true);
    assert.equal(saved.includes(address), false, 'The email must not be persisted in local storage');
    await popup.close();
    await dialog.getByRole('button', { name: 'Close mailing list signup' }).click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.clock.fastForward(30000);
    assert.equal(await dialog.isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Signup fits between the site controls with an accessible form even when local storage is unavailable', async t => {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 },
    { width: 768, height: 600 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await t.test(`${viewport.width}×${viewport.height}`, async () => {
      const { page, context, errors } = await openPage({ viewport, query: '?signup=1', storageUnavailable: true, reducedMotion: 'reduce' });
      try {
        const dialog = page.locator('#signup-dialog');
        const bounds = await dialog.boundingBox();
        assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
        assert(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) < 1, 'The signup should be horizontally centered');
        for (const selector of ['body > header', '.nav', '.socials', 'footer', '.motion']) {
          const control = await page.locator(selector).boundingBox();
          const overlaps = bounds.x < control.x + control.width && bounds.x + bounds.width > control.x &&
            bounds.y < control.y + control.height && bounds.y + bounds.height > control.y;
          assert.equal(overlaps, false, `The signup must leave ${selector} uncovered`);
        }
        const email = await dialog.getByLabel('Your email address').boundingBox();
        assert(email.y >= bounds.y && email.y + email.height <= bounds.y + bounds.height);
        const submit = await dialog.getByRole('button', { name: 'Continue to Mailchimp' }).boundingBox();
        assert(submit.y >= bounds.y && submit.y + submit.height <= bounds.y + bounds.height);
        const note = dialog.locator('.signup-copy');
        assert.deepEqual(await note.evaluate(element => {
          const signup = getComputedStyle(element);
          const tour = getComputedStyle(document.querySelector('.tour-wrap'));
          return [signup.scrollbarWidth === tour.scrollbarWidth, signup.scrollbarColor === tour.scrollbarColor];
        }), [true, true], 'Signup and Tour must share the same subtle scrollbar styling');
        await dialog.locator('.signup-signoff').scrollIntoViewIfNeeded();
        const signoff = await dialog.locator('.signup-signoff').boundingBox();
        const copy = await note.boundingBox();
        assert(signoff.y + signoff.height <= copy.y + copy.height + 1);
        await page.keyboard.press('Escape');
        assert.equal(await dialog.isVisible(), false);
        await choose(page, 'shop');
        const shop = await page.locator('#shop').boundingBox();
        assert(Math.abs(bounds.width - shop.width) < 1, 'The signup should use the Shop popup width');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }
});
