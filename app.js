'use strict';

const data = JSON.parse(document.querySelector('#site-data').textContent);
const nav = [...document.querySelectorAll('[data-panel]')];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const connection = navigator.connection;
const ROTATION_DELAY = 3000;
const carousels = {};
let current = null;
let keyboardMode = false;
let shopLoaded = false;
let tourLoaded = false;
let signupOpen = false;
let signupController = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, label) {
  const node = element('button', className);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  return node;
}

function listFor(kind) {
  return kind === 'music' ? data.music : data.videos;
}

function clearRotation(state) {
  clearTimeout(state.timer);
  state.timer = null;
}

function scheduleRotation(kind) {
  const state = carousels[kind];
  clearRotation(state);
  const focusedSlide = keyboardMode && state.cells[state.physical]?.slide.contains(document.activeElement);
  if (current !== kind || state.paused || state.playerOpen || state.streamingOpen || state.gesture ||
      document.hidden || signupOpen || focusedSlide) return;
  state.timer = setTimeout(() => goTo(kind, state.index + 1, { automatic: true, direction: 1 }), ROTATION_DELAY);
}

function updateControls(kind, announce = false) {
  const state = carousels[kind];
  const list = listFor(kind);
  state.root.dataset.index = String(state.index);
  state.toggle.textContent = state.playerOpen || state.streamingOpen ? 'Resume slideshow' : state.paused ? 'Play slideshow' : 'Pause slideshow';
  state.toggle.setAttribute('aria-label', state.toggle.textContent);
  [...state.dots.children].forEach((dot, index) => dot.setAttribute('aria-current', String(index === state.index)));
  state.cells.forEach((cell, index) => {
    cell.slide.inert = index !== state.physical;
    cell.slide.setAttribute('aria-hidden', String(index !== state.physical));
    cell.slide.dataset.active = String(index === state.physical);
  });
  if (announce) state.status.textContent = `${state.index + 1} of ${list.length}: ${list[state.index].title}`;
}

function finishTransition(kind) {
  const state = carousels[kind];
  const animation = state.animation;
  state.animation = null;
  animation?.cancel();
  state.physical = state.index + 1;
  state.track.style.transform = `translate3d(${-state.physical * 100}%, 0, 0)`;
  state.root.dataset.animating = 'false';
  updateControls(kind);
}

function videoId(item) {
  return new URL(item.url).pathname.split('/').filter(Boolean).pop();
}

function itemLink(kind, item) {
  return kind === 'video' ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId(item))}`
    : item.url;
}

function previewImage(url, title, className) {
  const image = element('img', className);
  image.src = url;
  image.alt = title;
  image.loading = 'lazy';
  image.decoding = 'async';
  return image;
}

function renderMedia(kind, cell) {
  const item = cell.item;
  if (kind === 'video') {
    const preview = button('video-frame video-preview', `Play ${item.title}`);
    const image = previewImage(`https://i.ytimg.com/vi/${encodeURIComponent(videoId(item))}/hqdefault.jpg`, '', 'video-thumbnail');
    image.width = 480;
    image.height = 360;
    image.addEventListener('error', () => { image.hidden = true; });
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 68 48');
    icon.setAttribute('aria-hidden', 'true');
    const shape = document.createElementNS(icon.namespaceURI, 'path');
    shape.setAttribute('d', 'M66 8a8 8 0 0 0-6-6C55 0 34 0 34 0S13 0 8 2a8 8 0 0 0-6 6C0 13 0 24 0 24s0 11 2 16a8 8 0 0 0 6 6c5 2 26 2 26 2s21 0 26-2a8 8 0 0 0 6-6c2-5 2-16 2-16s0-11-2-16');
    shape.setAttribute('fill', '#f00');
    const triangle = document.createElementNS(icon.namespaceURI, 'path');
    triangle.setAttribute('d', 'm27 14 18 10-18 10Z');
    triangle.setAttribute('fill', '#fff');
    icon.append(shape, triangle);
    preview.append(image, icon);
    preview.addEventListener('click', () => openPlayer(kind));
    cell.media.replaceChildren(preview);
  } else {
    const preview = button('cover music-preview', `Listen to ${item.title}`);
    preview.append(previewImage(item.image, `${item.title} cover artwork`, 'cover-art'));
    preview.addEventListener('click', openStreaming);
    cell.media.replaceChildren(preview);
  }
}

function stopPlayers(kind) {
  const state = carousels[kind];
  for (const cell of state.cells) if (cell.media.querySelector('iframe, .stream-options')) renderMedia(kind, cell);
  state.playerOpen = false;
  state.streamingOpen = false;
}

function closeStreaming({ restoreFocus = false } = {}) {
  const state = carousels.music;
  stopPlayers('music');
  updateControls('music', true);
  if (restoreFocus) state.cells[state.physical].media.querySelector('button').focus({ preventScroll: true });
  scheduleRotation('music');
}

function openStreaming() {
  if (current !== 'music') return;
  const state = carousels.music;
  finishTransition('music');
  const cell = state.cells[state.physical];
  if (state.streamingOpen) return;
  state.streamingOpen = true;
  clearRotation(state);
  const options = element('div', 'cover stream-options');
  options.setAttribute('role', 'group');
  options.setAttribute('aria-label', `Streaming options for ${cell.item.title}`);
  options.append(element('p', 'stream-prompt', 'Listen on'));
  const services = element('div', 'stream-services');
  for (const service of cell.item.services) {
    const link = element('a', 'stream-service');
    link.href = service.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.dataset.search = String(Boolean(service.search));
    const action = service.search ? 'Search' : service.action || 'Open';
    link.setAttribute('aria-label', `${action} ${cell.item.title} on ${service.name} (opens in a new tab)`);
    const icon = previewImage(`assets/services/${service.icon}.svg`, '', 'stream-icon');
    icon.width = 24;
    icon.height = 24;
    icon.loading = 'eager';
    const label = element('span', 'stream-label');
    label.append(element('span', 'stream-name', service.name), element('span', 'stream-action', `${action} ↗`));
    link.append(icon, label);
    services.append(link);
  }
  const back = button('stream-back', 'Back to artwork');
  back.textContent = 'Back to artwork';
  back.addEventListener('click', () => closeStreaming({ restoreFocus: true }));
  options.append(services, back);
  cell.media.replaceChildren(options);
  updateControls('music');
  state.status.textContent = `Choose a music service for ${cell.item.title}.`;
  if (keyboardMode) services.querySelector('a').focus({ preventScroll: true });
}

function openPlayer(kind) {
  if (current !== kind) return;
  const state = carousels[kind];
  finishTransition(kind);
  const cell = state.cells[state.physical];
  const item = cell.item;
  state.playerOpen = true;
  clearRotation(state);
  const frame = element('iframe', 'video-frame');
  const source = new URL(item.url);
  source.searchParams.set('autoplay', '1');
  source.searchParams.set('playsinline', '1');
  frame.src = source.href;
  frame.title = item.title;
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  cell.media.replaceChildren(frame);
  updateControls(kind);
  updateBackground();
  if (keyboardMode) frame.focus({ preventScroll: true });
}

function fitCarousel(kind) {
  if (current !== kind) return;
  const state = carousels[kind];
  const titleHeight = Math.max(...state.cells.map(cell => cell.title.getBoundingClientRect().height));
  const rootStyle = getComputedStyle(state.root);
  const dotsStyle = getComputedStyle(state.dots);
  const toggleStyle = getComputedStyle(state.toggle);
  const reserve = parseFloat(rootStyle.paddingTop) + titleHeight + 12 +
    state.dots.getBoundingClientRect().height + parseFloat(dotsStyle.marginTop) +
    state.toggle.getBoundingClientRect().height + parseFloat(toggleStyle.marginTop) +
    (kind === 'video' && matchMedia('(max-width: 700px)').matches ? 25 : 0) + 2;
  state.root.style.setProperty('--media-limit', `${Math.max(140, Math.floor(state.area.clientHeight - reserve))}px`);
}

function goTo(kind, requested, { automatic = false, direction = 0, dragOffset = 0 } = {}) {
  const state = carousels[kind];
  clearRotation(state);
  finishTransition(kind);
  const previous = state.index;
  const oldPhysical = state.physical;
  const count = listFor(kind).length;
  const index = ((requested % count) + count) % count;
  const step = direction || Math.sign(requested - previous);
  const physical = previous === count - 1 && index === 0 && step > 0 ? count + 1
    : previous === 0 && index === count - 1 && step < 0 ? 0 : index + 1;
  stopPlayers(kind);
  state.index = index;
  state.physical = physical;
  updateControls(kind, !automatic);
  for (const cell of state.cells.slice(Math.max(0, physical - 1), physical + 2)) {
    const image = cell.media.querySelector('img');
    if (image) image.loading = 'eager';
  }
  const width = state.viewport.clientWidth;
  state.track.style.transform = `translate3d(${-physical * 100}%, 0, 0)`;
  if (!reducedMotion.matches && width && (oldPhysical !== physical || dragOffset)) {
    state.root.dataset.animating = 'true';
    const animation = state.track.animate([
      { transform: `translate3d(${-oldPhysical * width + dragOffset}px, 0, 0)` },
      { transform: `translate3d(${-physical * width}px, 0, 0)` },
    ], { duration: 420, easing: 'cubic-bezier(.22,.61,.36,1)' });
    state.animation = animation;
    animation.onfinish = () => { if (state.animation === animation) finishTransition(kind); };
  } else finishTransition(kind);
  updateBackground();
  scheduleRotation(kind);
}

function installSwipe(kind) {
  const state = carousels[kind];
  const viewport = state.viewport;
  viewport.addEventListener('dragstart', event => event.preventDefault());
  viewport.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || event.target.closest('.stream-options')) return;
    finishTransition(kind);
    state.gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
      started: performance.now(), dx: 0, dy: 0, dragging: false };
    clearRotation(state);
  });
  viewport.addEventListener('pointermove', event => {
    const gesture = state.gesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    gesture.dx = event.clientX - gesture.x;
    gesture.dy = event.clientY - gesture.y;
    if (Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.3) {
      gesture.dragging = true;
      if (!viewport.hasPointerCapture(event.pointerId)) viewport.setPointerCapture(event.pointerId);
      if (event.cancelable) event.preventDefault();
      state.track.style.transform = `translate3d(${-state.physical * viewport.clientWidth + gesture.dx}px, 0, 0)`;
    }
  });
  function finish(event) {
    const gesture = state.gesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    if (event.type === 'pointerup') {
      gesture.dx = event.clientX - gesture.x;
      gesture.dy = event.clientY - gesture.y;
    }
    state.gesture = null;
    const distance = Math.abs(gesture.dx);
    const speed = distance / Math.max(1, performance.now() - gesture.started);
    const threshold = Math.max(35, Math.min(80, viewport.clientWidth * .12));
    const swipe = event.type === 'pointerup' && gesture.dragging &&
      distance > Math.abs(gesture.dy) * 1.3 && (distance >= threshold || (distance > 20 && speed > .45));
    if (gesture.dragging) state.suppressClickUntil = performance.now() + 400;
    const direction = gesture.dx < 0 ? 1 : -1;
    if (gesture.dragging) goTo(kind, state.index + (swipe ? direction : 0), { direction, dragOffset: gesture.dx });
    else {
      state.track.style.transform = `translate3d(${-state.physical * 100}%, 0, 0)`;
      scheduleRotation(kind);
    }
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  }
  viewport.addEventListener('pointerup', finish);
  viewport.addEventListener('pointercancel', finish);
  viewport.addEventListener('lostpointercapture', event => {
    if (event.target === viewport && state.gesture?.id === event.pointerId &&
        !viewport.hasPointerCapture(event.pointerId)) finish(event);
  });
  viewport.addEventListener('click', event => {
    if (performance.now() < state.suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
}

function createCarousel(kind) {
  const root = document.querySelector(`#${kind}-content`);
  const area = element('div', 'carousel-scroll-area');
  root.before(area);
  area.append(root);
  root.setAttribute('role', 'region');
  root.setAttribute('aria-roledescription', 'carousel');
  root.setAttribute('aria-label', kind === 'music' ? 'Music releases' : 'Music videos');
  const viewport = element('div', 'carousel-viewport');
  viewport.id = `${kind}-viewport`;
  const track = element('div', 'carousel-track');
  viewport.append(track);
  const dots = element('div', 'dots');
  dots.setAttribute('role', 'group');
  dots.setAttribute('aria-label', `Choose ${kind === 'music' ? 'a release' : 'a video'}`);
  const toggle = button('rotation-toggle', 'Pause slideshow');
  toggle.setAttribute('aria-controls', viewport.id);
  const status = element('p', 'visually-hidden');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.replaceChildren(viewport, dots, toggle, status);
  const state = carousels[kind] = { root, area, viewport, track, dots, toggle, status, cells: [],
    index: 0, physical: 1, paused: false, playerOpen: false, streamingOpen: false, animation: null,
    timer: null, gesture: null, suppressClickUntil: 0 };
  const list = listFor(kind);
  const sequence = [list[list.length - 1], ...list, list[0]];
  sequence.forEach((item, physical) => {
    const slide = element('div', 'slide');
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    const index = ((physical - 1) % list.length + list.length) % list.length;
    slide.setAttribute('aria-label', `${index + 1} of ${list.length}: ${item.title}`);
    const media = element('div', 'media');
    const title = element('h2', 'slide-title');
    const link = kind === 'music' ? button('release-title', `Streaming options for ${item.title}`) : element('a');
    link.textContent = item.title;
    if (kind === 'music') link.addEventListener('click', openStreaming);
    else {
      link.href = itemLink(kind, item);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    title.append(link);
    slide.append(media, title);
    const cell = { slide, media, title, item };
    state.cells.push(cell);
    renderMedia(kind, cell);
    track.append(slide);
  });
  list.forEach((item, index) => {
    const dot = button('dot', item.title);
    dot.addEventListener('click', () => goTo(kind, index));
    dots.append(dot);
  });
  toggle.addEventListener('click', () => {
    if (state.playerOpen || state.streamingOpen) { stopPlayers(kind); state.paused = false; updateBackground(); }
    else state.paused = !state.paused;
    updateControls(kind);
    scheduleRotation(kind);
  });
  root.addEventListener('focusin', () => scheduleRotation(kind));
  root.addEventListener('focusout', event => {
    if (!viewport.contains(event.relatedTarget)) scheduleRotation(kind);
  });
  installSwipe(kind);
  finishTransition(kind);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => fitCarousel(kind)).observe(area);
}

function panelFromLocation() {
  const name = location.hash.slice(1);
  return nav.some(item => item.dataset.panel === name) ? name : null;
}

function showPanel(name, { updateHistory = true, restoreFocus = false } = {}) {
  const previous = current;
  current = name;
  document.querySelectorAll('.panel').forEach(panel => { panel.hidden = panel.id !== current; });
  nav.forEach(item => item.setAttribute('aria-expanded', String(item.dataset.panel === current)));
  for (const [kind, state] of Object.entries(carousels)) {
    if (kind !== current) {
      clearRotation(state);
      state.gesture = null;
      finishTransition(kind);
      stopPlayers(kind);
    } else {
      finishTransition(kind);
      fitCarousel(kind);
      state.cells[state.physical].media.querySelector('img')?.setAttribute('loading', 'eager');
      scheduleRotation(kind);
    }
  }
  if (current === 'tour' && !tourLoaded) {
    tourLoaded = true;
    const script = element('script');
    script.src = 'https://widget-app.songkick.com/injector/8693968';
    script.async = true;
    script.onerror = () => { tourLoaded = false; };
    document.body.append(script);
  }
  if (current === 'shop' && !shopLoaded) {
    shopLoaded = true;
    const script = element('script');
    script.src = document.querySelector('script[data-shop-script]')?.dataset.shopScript || 'shop.js';
    script.async = true;
    script.onerror = () => { shopLoaded = false; };
    document.body.append(script);
  }
  if (updateHistory) {
    const url = new URL(location.href);
    url.hash = current || '';
    if (url.href !== location.href) history.pushState(null, '', url);
  }
  if (restoreFocus) nav.find(item => item.dataset.panel === previous)?.focus({ preventScroll: true });
  updateBackground();
  if (!current) signupController?.offer();
}

document.addEventListener('pointerdown', () => { keyboardMode = false; }, true);
document.addEventListener('keydown', event => {
  keyboardMode = true;
  if (signupOpen) return;
  if (event.target.matches('input,textarea,select,[contenteditable="true"]')) return;
  if (event.key === 'Escape' && current === 'music' && carousels.music.streamingOpen) {
    event.preventDefault();
    closeStreaming({ restoreFocus: true });
    return;
  }
  if (event.target.closest('.stream-options')) return;
  if (event.key === 'Escape' && current) showPanel(null, { restoreFocus: true });
  if (carousels[current] && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    goTo(current, carousels[current].index + (event.key === 'ArrowRight' ? 1 : -1));
  }
});
nav.forEach(item => item.addEventListener('click', () => showPanel(item.dataset.panel === current ? null : item.dataset.panel)));
document.querySelectorAll('.close').forEach(item => item.addEventListener('click', () => showPanel(null, { restoreFocus: true })));
document.querySelectorAll('.arrow').forEach(item => item.addEventListener('click', () => {
  const kind = item.closest('.panel').id;
  const direction = Number(item.dataset.direction);
  goTo(kind, carousels[kind].index + direction, { direction });
}));
document.querySelector('.wordmark').addEventListener('click', () => showPanel(null));
window.addEventListener('popstate', () => showPanel(panelFromLocation(), { updateHistory: false }));
window.addEventListener('hashchange', () => showPanel(panelFromLocation(), { updateHistory: false }));
window.addEventListener('resize', () => { if (carousels[current]) { finishTransition(current); fitCarousel(current); } });

const background = document.querySelector('.backdrop');
const motion = document.querySelector('.motion');
let backgroundRequested = !reducedMotion.matches && !connection?.saveData;

function updateMotion() {
  motion.textContent = background.paused ? 'Play background' : 'Pause background';
  motion.setAttribute('aria-pressed', String(!background.paused));
  motion.disabled = signupOpen || Object.values(carousels).some(state => state.playerOpen);
  motion.title = signupOpen ? 'Close signup to resume the background.'
    : motion.disabled ? 'Resume the slideshow to resume the background.' : '';
}

function updateBackground() {
  const playerOpen = Object.values(carousels).some(state => state.playerOpen);
  const shouldPlay = backgroundRequested && !document.hidden && !playerOpen && !signupOpen;
  if (!shouldPlay) background.pause();
  else if (background.paused) {
    if (!background.getAttribute('src')) { background.src = data.video; background.load(); }
    background.play().catch(() => updateMotion());
  }
  updateMotion();
}
background.addEventListener('play', updateMotion);
background.addEventListener('pause', updateMotion);
background.addEventListener('error', updateMotion);
motion.addEventListener('click', () => {
  backgroundRequested = background.paused;
  if (backgroundRequested && background.error) background.load();
  updateBackground();
});
document.addEventListener('visibilitychange', () => {
  updateBackground();
  for (const kind of Object.keys(carousels)) scheduleRotation(kind);
});
function updatePreferences() {
  if (reducedMotion.matches || connection?.saveData) backgroundRequested = false;
  if (reducedMotion.matches) for (const kind of Object.keys(carousels)) finishTransition(kind);
  updateBackground();
}
reducedMotion.addEventListener('change', updatePreferences);
connection?.addEventListener('change', updatePreferences);

function installSignup() {
  const dialog = document.querySelector('#signup-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') return null;
  const form = dialog.querySelector('form');
  const status = dialog.querySelector('[role="status"]');
  const storageKey = 'morefatter:signup:v1';
  const visitWindow = 30 * 60 * 1000;
  const delay = 12000;
  let ready = false;
  let previousFocus = null;
  let timer = null;

  function readState() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch { return {}; }
  }
  let state = readState();
  const now = Date.now();
  const previousVisit = Number(state.lastVisitAt) || 0;
  const visits = Number.isFinite(state.visits) ? Math.max(0, state.visits) : 0;
  state.visits = !visits || now - previousVisit >= visitWindow ? visits + 1 : visits;
  state.lastVisitAt = now;
  function remember(update = {}) {
    state = { ...readState(), ...state, ...update };
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* Storage can be unavailable in private browsers. */ }
  }
  remember();

  function eligible() {
    const saved = readState();
    return !state.dismissed && !state.continued && !saved.dismissed && !saved.continued &&
      state.visits <= 2 && state.shownVisit !== state.visits && saved.shownVisit !== state.visits;
  }

  function show(source = 'manual') {
    if (signupOpen) return;
    clearTimeout(timer);
    previousFocus = document.activeElement;
    signupOpen = true;
    status.textContent = '';
    dialog.dataset.source = source;
    if (source === 'automatic') remember({ shownVisit: state.visits });
    for (const [kind, carousel] of Object.entries(carousels)) {
      clearRotation(carousel);
      finishTransition(kind);
    }
    dialog.showModal();
    dialog.querySelector('#signup-heading').focus({ preventScroll: true });
    updateBackground();
  }

  function offer() {
    if (ready && eligible() && !signupOpen && !current && !document.hidden) show('automatic');
  }

  function finishClose() {
    if (!signupOpen || dialog.open) return;
    signupOpen = false;
    remember({ dismissed: true });
    const target = previousFocus?.isConnected && !previousFocus.closest('[hidden]')
      ? previousFocus : document.querySelector('.wordmark');
    target.focus({ preventScroll: true });
    updateBackground();
    for (const kind of Object.keys(carousels)) scheduleRotation(kind);
  }
  function dismiss() {
    dialog.close();
    finishClose();
  }
  dialog.querySelector('.signup-close').addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener('close', finishClose);
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
  });
  form.addEventListener('submit', () => {
    // Native navigation lets Mailchimp display validation, CAPTCHA, or confirmation.
    // Keep the email in the form until the browser has serialized its submission.
    remember({ continued: true });
    clearTimeout(timer);
    status.textContent = 'Finish signing up in the Mailchimp tab that opens.';
  });
  document.querySelector('.join').addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    show();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) offer(); });
  window.addEventListener('storage', event => {
    if (event.key === storageKey && !eligible()) clearTimeout(timer);
  });

  if (new URLSearchParams(location.search).get('signup') === '1') show('preview');
  else if (eligible()) timer = setTimeout(() => { ready = true; offer(); }, delay);
  return { offer };
}

createCarousel('music');
createCarousel('video');
showPanel(panelFromLocation(), { updateHistory: false });
signupController = installSignup();
