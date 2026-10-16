'use strict';

const data = JSON.parse(document.querySelector('#site-data').textContent);
const nav = [...document.querySelectorAll('[data-panel]')];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const connection = navigator.connection;
const ROTATION_DELAY = 8000;
const INTERACTION_DELAY = 12000;
const carousels = {};
let current = null;
let keyboardMode = false;
let shopLoaded = false;
let tourLoaded = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, label) {
  const node = element('button', className, text);
  node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  return node;
}

function listFor(kind) {
  return kind === 'music' ? data.music : data.videos;
}

function clearRotation(state) {
  clearTimeout(state.timer);
  state.timer = null;
}

function scheduleRotation(kind, focusedElement = document.activeElement) {
  const state = carousels[kind];
  clearRotation(state);
  const keyboardInside = keyboardMode && state.root.contains(focusedElement) && !state.allowFocusedRotation;
  if (current !== kind || state.paused || state.hovered || state.playerOpen ||
      state.gesture || document.hidden || keyboardInside) return;
  const delay = Math.max(ROTATION_DELAY, state.interactionUntil - Date.now());
  state.timer = setTimeout(() => goTo(kind, state.index + 1, { automatic: true }), delay);
}

function updateRotationControl(state) {
  state.toggle.textContent = state.paused ? 'Play slideshow' : 'Pause slideshow';
  state.help.textContent = state.playerOpen
    ? 'Close the player to continue the slideshow. Swipe beside the player or use the arrows to browse.'
    : state.paused ? 'Swipe or use the arrows to browse.'
      : 'Swipe to browse · slides advance every 8 seconds.';
}

function createCarousel(kind) {
  const root = document.querySelector(`#${kind}-content`);
  root.setAttribute('role', 'region');
  root.setAttribute('aria-roledescription', 'carousel');
  root.setAttribute('aria-label', kind === 'music' ? 'Music releases' : 'Music videos');
  const stage = element('div', 'carousel-stage');
  const slide = element('div', 'slide');
  slide.setAttribute('role', 'group');
  slide.setAttribute('aria-roledescription', 'slide');
  stage.append(slide);
  const controls = element('div', 'carousel-controls');
  const previous = button('arrow prev', '‹', `Previous ${kind === 'music' ? 'release' : 'video'}`);
  const counter = element('span', 'slide-counter');
  counter.setAttribute('aria-hidden', 'true');
  const next = button('arrow next', '›', `Next ${kind === 'music' ? 'release' : 'video'}`);
  const toggle = button('rotation-toggle', 'Pause slideshow');
  controls.append(previous, counter, next, toggle);
  const dots = element('div', 'dots');
  dots.setAttribute('role', 'group');
  dots.setAttribute('aria-label', `Choose ${kind === 'music' ? 'a release' : 'a video'}`);
  const help = element('p', 'carousel-help');
  const status = element('p', 'visually-hidden');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.replaceChildren(stage, controls, dots, help, status);
  const state = carousels[kind] = {
    root, stage, slide, dots, counter, toggle, help, status,
    index: 0, paused: reducedMotion.matches || Boolean(connection?.saveData),
    hovered: false, playerOpen: false, rendered: false, allowFocusedRotation: false,
    timer: null, gesture: null, interactionUntil: 0, suppressClickUntil: 0,
  };
  listFor(kind).forEach((item, index) => {
    const dot = button('dot', '', `${index + 1}: ${item.title}`);
    dot.addEventListener('click', () => goTo(kind, index));
    dots.append(dot);
  });
  previous.addEventListener('click', () => goTo(kind, state.index - 1));
  next.addEventListener('click', () => goTo(kind, state.index + 1));
  toggle.addEventListener('click', () => {
    state.paused = !state.paused;
    state.allowFocusedRotation = !state.paused;
    state.interactionUntil = 0;
    updateRotationControl(state);
    scheduleRotation(kind);
  });
  root.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'mouse') return;
    state.hovered = true;
    scheduleRotation(kind);
  });
  root.addEventListener('pointerleave', event => {
    if (event.pointerType !== 'mouse') return;
    state.hovered = false;
    scheduleRotation(kind);
  });
  root.addEventListener('focusin', () => {
    state.allowFocusedRotation = false;
    scheduleRotation(kind);
  });
  root.addEventListener('focusout', event => scheduleRotation(kind, event.relatedTarget));
  installSwipe(kind);
  updateRotationControl(state);
}

function videoId(item) {
  return new URL(item.url).pathname.split('/').filter(Boolean).pop();
}

function itemLink(kind, item) {
  return kind === 'video'
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId(item))}`
    : item.embed ? item.embed.replace(/\/widget\/?$/, '') : item.url;
}

function openPlayer(kind) {
  const state = carousels[kind];
  if (current !== kind) return;
  const item = listFor(kind)[state.index];
  state.playerOpen = true;
  clearRotation(state);
  const media = state.slide.querySelector('.media');
  const frame = element('iframe', kind === 'video' ? 'video-frame' : 'cover');
  const source = new URL(kind === 'video' ? item.url : item.embed);
  if (kind === 'video') {
    source.searchParams.set('autoplay', '1');
    source.searchParams.set('playsinline', '1');
  }
  frame.src = source.href;
  frame.title = item.title;
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  const closePlayer = button('close-player', 'Close player');
  closePlayer.addEventListener('click', () => {
    state.playerOpen = false;
    state.interactionUntil = Date.now() + INTERACTION_DELAY;
    renderSlide(kind);
    state.slide.querySelector('.play-preview')?.focus({ preventScroll: true });
    updateBackground();
    scheduleRotation(kind);
  });
  media.replaceChildren(frame, closePlayer);
  updateRotationControl(state);
  updateBackground();
  if (keyboardMode) closePlayer.focus({ preventScroll: true });
}

function renderSlide(kind) {
  const state = carousels[kind];
  const item = listFor(kind)[state.index];
  state.rendered = true;
  state.playerOpen = false;
  state.slide.style.transform = '';
  state.slide.setAttribute('aria-label', `${state.index + 1} of ${listFor(kind).length}: ${item.title}`);
  const media = element('div', `media ${kind === 'video' ? 'video-media' : 'music-media'}`);
  if (kind === 'video' || item.embed) {
    const preview = button(`play-preview ${kind === 'video' ? 'video-preview' : 'cover music-preview'}`,
      undefined, `${kind === 'video' ? 'Play' : 'Listen to'} ${item.title}`);
    if (kind === 'video') {
      const image = element('img', 'video-thumbnail');
      image.src = `https://i.ytimg.com/vi/${encodeURIComponent(videoId(item))}/hqdefault.jpg`;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.width = 480;
      image.height = 360;
      image.addEventListener('error', () => { image.hidden = true; });
      preview.append(image);
    } else {
      preview.append(element('span', 'preview-artist', 'More Fatter'),
        element('span', 'preview-title', item.title));
    }
    const icon = element('span', 'play-icon');
    icon.setAttribute('aria-hidden', 'true');
    preview.append(icon, element('span', 'play-label', kind === 'video' ? 'Play video' : 'Listen now'));
    preview.addEventListener('click', () => openPlayer(kind));
    media.append(preview);
  } else {
    const link = element('a', 'artwork-link');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const image = element('img', 'cover');
    image.src = item.image;
    image.alt = `${item.title} cover artwork`;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.width = 400;
    image.height = 400;
    link.append(image);
    media.append(link);
  }
  const title = element('h2', 'slide-title');
  const link = element('a', '', item.title);
  link.href = itemLink(kind, item);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  title.append(link);
  state.slide.replaceChildren(media, title);
  state.counter.textContent = `${state.index + 1} / ${listFor(kind).length}`;
  [...state.dots.children].forEach((dot, index) => {
    dot.setAttribute('aria-current', String(index === state.index));
  });
  updateRotationControl(state);
}

function goTo(kind, index, { automatic = false } = {}) {
  const state = carousels[kind];
  const count = listFor(kind).length;
  state.index = ((index % count) + count) % count;
  if (!automatic) state.interactionUntil = Date.now() + INTERACTION_DELAY;
  renderSlide(kind);
  if (!reducedMotion.matches) {
    state.slide.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 220 });
  }
  if (!automatic) state.status.textContent = `${state.index + 1} of ${count}: ${listFor(kind)[state.index].title}`;
  updateBackground();
  scheduleRotation(kind);
}

function installSwipe(kind) {
  const state = carousels[kind];
  const stage = state.stage;
  stage.addEventListener('dragstart', event => event.preventDefault());
  stage.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || event.target.closest('.close-player')) return;
    state.gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
      started: performance.now(), dx: 0, dy: 0, dragging: false };
    clearRotation(state);
  });
  stage.addEventListener('pointermove', event => {
    const gesture = state.gesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    gesture.dx = event.clientX - gesture.x;
    gesture.dy = event.clientY - gesture.y;
    if (Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.3) {
      gesture.dragging = true;
      if (!stage.hasPointerCapture(event.pointerId)) stage.setPointerCapture(event.pointerId);
      if (event.cancelable) event.preventDefault();
      state.slide.style.transform = `translateX(${Math.max(-65, Math.min(65, gesture.dx * 0.3))}px)`;
    }
  });
  function finish(event) {
    const gesture = state.gesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    state.gesture = null;
    state.slide.style.transform = '';
    const distance = Math.abs(gesture.dx);
    const speed = distance / Math.max(1, performance.now() - gesture.started);
    const threshold = Math.max(35, Math.min(65, stage.clientWidth * 0.12));
    const swipe = event.type === 'pointerup' && gesture.dragging &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.3 &&
      (distance >= threshold || (distance > 20 && speed > 0.45));
    if (gesture.dragging) state.suppressClickUntil = performance.now() + 400;
    if (swipe) goTo(kind, gesture.dx < 0 ? state.index + 1 : state.index - 1);
    else scheduleRotation(kind);
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  }
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);
  stage.addEventListener('lostpointercapture', event => {
    // Touch starts with implicit capture on the child button. Its capture-loss
    // event bubbles when we transfer capture to the stage; that is not a cancel.
    if (event.target === stage && state.gesture?.id === event.pointerId &&
        !stage.hasPointerCapture(event.pointerId)) finish(event);
  });
  stage.addEventListener('click', event => {
    if (performance.now() < state.suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
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
      state.hovered = false;
      state.gesture = null;
      if (state.playerOpen) renderSlide(kind);
    } else {
      if (!state.rendered) renderSlide(kind);
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
}

document.addEventListener('pointerdown', () => {
  keyboardMode = false;
  if (carousels[current]) scheduleRotation(current);
}, true);
document.addEventListener('pointermove', event => {
  const state = carousels[current];
  if (!state || event.pointerType !== 'mouse') return;
  // Removing a focused iframe/player can skip the root's pointerleave event.
  // Reconcile against the pointer's actual target so hover cannot stay stuck.
  const hovered = state.root.contains(event.target);
  if (hovered !== state.hovered) {
    state.hovered = hovered;
    scheduleRotation(current);
  }
}, true);
document.addEventListener('keydown', event => {
  keyboardMode = true;
  if (carousels[current]) scheduleRotation(current);
  if (event.target.matches('input,textarea,select,[contenteditable="true"]')) return;
  if (event.key === 'Escape' && current) showPanel(null, { restoreFocus: true });
  if (carousels[current] && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    goTo(current, carousels[current].index + (event.key === 'ArrowRight' ? 1 : -1));
  }
});
nav.forEach(item => item.addEventListener('click', () => showPanel(item.dataset.panel === current ? null : item.dataset.panel)));
document.querySelectorAll('.close').forEach(item => item.addEventListener('click', () => showPanel(null, { restoreFocus: true })));
document.querySelector('.wordmark').addEventListener('click', () => showPanel(null));
window.addEventListener('popstate', () => showPanel(panelFromLocation(), { updateHistory: false }));
window.addEventListener('hashchange', () => showPanel(panelFromLocation(), { updateHistory: false }));

const background = document.querySelector('.backdrop');
const motion = document.querySelector('.motion');
let backgroundRequested = !reducedMotion.matches && !connection?.saveData;

function updateMotion() {
  motion.textContent = background.paused ? 'Play background' : 'Pause background';
  motion.setAttribute('aria-pressed', String(!background.paused));
  motion.disabled = Object.values(carousels).some(state => state.playerOpen);
  motion.title = motion.disabled ? 'Close the music or video player to resume the background.' : '';
}

function updateBackground() {
  const playerOpen = Object.values(carousels).some(state => state.playerOpen);
  const shouldPlay = backgroundRequested && !document.hidden && !playerOpen;
  if (!shouldPlay) background.pause();
  else if (background.paused) {
    if (!background.getAttribute('src')) {
      background.src = data.video;
      background.load();
    }
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
  if (reducedMotion.matches || connection?.saveData) {
    backgroundRequested = false;
    for (const state of Object.values(carousels)) {
      state.paused = true;
      updateRotationControl(state);
    }
  }
  updateBackground();
  for (const kind of Object.keys(carousels)) scheduleRotation(kind);
}
reducedMotion.addEventListener('change', updatePreferences);
connection?.addEventListener('change', updatePreferences);

createCarousel('music');
createCarousel('video');
showPanel(panelFromLocation(), { updateHistory: false });
