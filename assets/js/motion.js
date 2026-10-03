// Likewise motion engine: tiny, dependency-free.
//  - [data-reveal]        fade/slide in when scrolled into view
//  - [data-split]         headline words slide up out of a mask
//  - [data-magnetic]      buttons drift toward the pointer
//  - [data-tilt]          cards tilt in 3D with the pointer
//  - [data-parallax=0.2]  elements drift at a different scroll speed
//  - [data-count=42]      numbers count up when visible
//  - scrub(el, fn)        call fn(progress 0→1) as el moves through the viewport
//  - custom cursor whose brackets snap around whatever you hover
// Everything switches off for prefers-reduced-motion.

const html = document.documentElement;
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

// ---------------------------------------------------------------------
// Frame loop: reads first, then writes (avoids layout thrash)
// ---------------------------------------------------------------------
const frameFns = new Set();
const scrubbers = new Set();
let running = false;
let lastY = window.scrollY;
export const scrollState = { y: window.scrollY, velocity: 0 };

function loop() {
  const y = window.scrollY;
  scrollState.velocity = scrollState.velocity * 0.85 + (y - lastY) * 0.15;
  scrollState.y = y;
  lastY = y;

  const vh = window.innerHeight;
  const reads = [];
  for (const s of scrubbers) {
    if (!s.el.isConnected) { scrubbers.delete(s); continue; }
    const r = s.el.getBoundingClientRect();
    // 0 when the element's top hits the bottom of the viewport, 1 when its bottom leaves the top.
    const total = r.height + vh * (s.range ?? 1);
    const p = Math.min(1, Math.max(0, (vh - r.top) / total));
    reads.push([s, p, r]);
  }
  for (const [s, p, r] of reads) {
    if (s.last === p) continue;
    s.last = p;
    s.fn(p, r);
  }
  for (const fn of frameFns) fn();
  requestAnimationFrame(loop);
}

function ensureLoop() {
  if (running) return;
  running = true;
  requestAnimationFrame(loop);
}

export function onFrame(fn) {
  frameFns.add(fn);
  ensureLoop();
  return () => frameFns.delete(fn);
}

export function scrub(el, fn, { range = 1 } = {}) {
  if (!el) return () => {};
  const s = { el, fn, range, last: -1 };
  scrubbers.add(s);
  ensureLoop();
  return () => scrubbers.delete(s);
}

// ---------------------------------------------------------------------
// Reveal on scroll
// ---------------------------------------------------------------------
let io;
export function observeReveals(root = document) {
  const els = root.querySelectorAll('[data-reveal]:not(.is-in), [data-split]:not(.is-in), [data-count]:not(.is-in)');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    els.forEach((el) => { el.classList.add('is-in'); if (el.dataset.count) countUp(el, true); });
    return;
  }
  if (!io) {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        if (e.target.dataset.count) countUp(e.target);
        io.unobserve(e.target);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  }
  els.forEach((el) => io.observe(el));
}

// ---------------------------------------------------------------------
// Split headline text into masked words
// ---------------------------------------------------------------------
export function splitText(root = document) {
  root.querySelectorAll('[data-split]:not([data-split-done])').forEach((el) => {
    let wi = 0;
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === Node.TEXT_NODE) {
          const frag = document.createDocumentFragment();
          for (const part of child.textContent.split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) { frag.append(document.createTextNode(' ')); continue; }
            const outer = document.createElement('span');
            outer.className = 'split-w';
            const inner = document.createElement('span');
            inner.textContent = part;
            inner.style.setProperty('--wi', wi++);
            outer.append(inner);
            frag.append(outer);
          }
          child.replaceWith(frag);
        } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'BR' && !child.classList.contains('split-w')) {
          walk(child);
        }
      }
    };
    walk(el);
    el.dataset.splitDone = '1';
  });
}

// ---------------------------------------------------------------------
// Count up
// ---------------------------------------------------------------------
export function countUp(el, instant = false) {
  const target = Number(el.dataset.count);
  const from = Number(el.dataset.from ?? 0);
  const suffix = el.dataset.suffix || '';
  if (instant || reduceMotion) { el.textContent = target + suffix; return; }
  const dur = Number(el.dataset.duration) || 1400;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 4);
    el.textContent = Math.round(from + (target - from) * eased) + suffix;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------------
// Magnetic + tilt (fine pointers only)
// ---------------------------------------------------------------------
export function bindMagnetic(root = document) {
  if (!finePointer || reduceMotion) return;
  root.querySelectorAll('[data-magnetic]:not([data-mag-bound])').forEach((el) => {
    el.dataset.magBound = '1';
    const k = parseFloat(el.dataset.magnetic) || 0.28;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${x * k}px, ${y * k}px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
}

export function bindTilt(root = document) {
  if (!finePointer || reduceMotion) return;
  root.querySelectorAll('[data-tilt]:not([data-tilt-bound])').forEach((el) => {
    el.dataset.tiltBound = '1';
    const max = parseFloat(el.dataset.tilt) || 8;
    el.style.transformStyle = 'preserve-3d';
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      el.style.transform = `perspective(1000px) rotateX(${(0.5 - py) * max}deg) rotateY(${(px - 0.5) * max}deg) translateZ(0)`;
      el.style.setProperty('--gx', `${px * 100}%`);
      el.style.setProperty('--gy', `${py * 100}%`);
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
}

// ---------------------------------------------------------------------
// Parallax
// ---------------------------------------------------------------------
export function bindParallax(root = document) {
  if (reduceMotion) return;
  root.querySelectorAll('[data-parallax]').forEach((el) => {
    const speed = parseFloat(el.dataset.parallax) || 0.15;
    scrub(el, (p, r) => {
      const center = r.top + r.height / 2 - window.innerHeight / 2;
      el.style.transform = `translate3d(0, ${(-center * speed).toFixed(1)}px, 0)`;
    });
  });
}

// ---------------------------------------------------------------------
// Pointer position (normalized -1..1), shared by hero effects
// ---------------------------------------------------------------------
export const pointer = { x: 0, y: 0, cx: innerWidth * 0.68, cy: innerHeight * 0.42, sx: 0, sy: 0, scx: innerWidth * 0.68, scy: innerHeight * 0.42 };
if (finePointer) {
  addEventListener('pointermove', (e) => {
    pointer.cx = e.clientX;
    pointer.cy = e.clientY;
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });
}
onFrame(() => {
  // smoothed copy
  pointer.sx += (pointer.x - pointer.sx) * 0.08;
  pointer.sy += (pointer.y - pointer.sy) * 0.08;
  pointer.scx += (pointer.cx - pointer.scx) * 0.1;
  pointer.scy += (pointer.cy - pointer.scy) * 0.1;
});

// ---------------------------------------------------------------------
// Custom cursor: a red dot plus two brackets that snap around targets
// ---------------------------------------------------------------------
function initCursor({ hideNative }) {
  if (!finePointer || reduceMotion) return;
  const dot = document.createElement('div');
  const frame = document.createElement('div');
  dot.className = 'cursor-dot';
  frame.className = 'cursor-frame';
  dot.setAttribute('aria-hidden', 'true');
  frame.setAttribute('aria-hidden', 'true');
  document.body.append(dot, frame);
  if (hideNative) html.classList.add('cursor-hide');

  let mx = -100, my = -100, fx = -100, fy = -100, fw = 34, fh = 34;
  let target = null;
  let visible = false;
  let down = false;
  const SELECTOR = 'a, button, [data-cursor], summary, label.check, .select, [role="button"]';

  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    mx = e.clientX; my = e.clientY;
    if (!visible) { visible = true; html.classList.add('cursor-on'); fx = mx - 17; fy = my - 17; }
  }, { passive: true });
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.(SELECTOR);
    if (t && !t.matches('[disabled]')) {
      const r = t.getBoundingClientRect();
      target = r.width < 640 && r.height < 420 ? t : null;
    } else target = null;
    frame.classList.toggle('is-target', !!target);
  });
  document.documentElement.addEventListener('pointerleave', () => { visible = false; html.classList.remove('cursor-on'); });
  addEventListener('pointerdown', () => { down = true; });
  addEventListener('pointerup', () => { down = false; });

  onFrame(() => {
    if (!visible) return;
    let tx, ty, tw, th;
    if (target && target.isConnected) {
      const r = target.getBoundingClientRect();
      const pad = 7;
      tx = r.left - pad; ty = r.top - pad; tw = r.width + pad * 2; th = r.height + pad * 2;
    } else {
      tw = th = down ? 26 : 34;
      tx = mx - tw / 2; ty = my - th / 2;
    }
    const k = 0.24;
    fx += (tx - fx) * k; fy += (ty - fy) * k; fw += (tw - fw) * k; fh += (th - fh) * k;
    frame.style.transform = `translate3d(${fx.toFixed(1)}px, ${fy.toFixed(1)}px, 0)`;
    frame.style.width = `${fw.toFixed(1)}px`;
    frame.style.height = `${fh.toFixed(1)}px`;
    dot.style.transform = `translate3d(${mx}px, ${my}px, 0) scale(${down ? 0.6 : 1})`;
  });
}

// ---------------------------------------------------------------------
// Scroll progress bar + hide-on-scroll nav
// ---------------------------------------------------------------------
function initChrome() {
  const bar = document.querySelector('.progress-bar');
  const nav = document.querySelector('[data-nav]');
  let lastNavY = scrollY;
  onFrame(() => {
    const y = scrollState.y;
    if (bar) {
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.setProperty('--p', max > 0 ? (y / max).toFixed(4) : 0);
    }
    if (nav) {
      nav.classList.toggle('is-scrolled', y > 12);
      const dy = y - lastNavY;
      if (Math.abs(dy) > 6) {
        nav.classList.toggle('is-hidden', dy > 0 && y > 320 && !nav.classList.contains('menu-open'));
        lastNavY = y;
      }
    }
  });
}

// ---------------------------------------------------------------------
export function initMotion({ cursor = true, hideNativeCursor = false } = {}) {
  window.__lwReady = true;
  if (!reduceMotion) html.classList.add('motion');
  splitText();
  observeReveals();
  bindMagnetic();
  bindTilt();
  bindParallax();
  initChrome();
  if (cursor) initCursor({ hideNative: hideNativeCursor });
}

// Re-scan a freshly rendered chunk of DOM (used by the app router)
export function refreshMotion(root) {
  splitText(root);
  observeReveals(root);
  bindMagnetic(root);
  bindTilt(root);
}
