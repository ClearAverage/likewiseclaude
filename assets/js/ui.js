// Small DOM + UI helpers. All user-supplied text goes through textContent,
// never innerHTML, so names like "<img onerror=...>" are just text.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * h('div', { class: 'card', onclick: fn, dataset: { id } }, 'text', child)
 * Strings become text nodes. Use { html } ONLY with trusted, static markup.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'html') el.innerHTML = value; // trusted static markup only
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

// ---------------------------------------------------------------------
// Icons (static, trusted markup)
// ---------------------------------------------------------------------
const ICONS = {
  plus: '<path d="M12 4v16M4 12h16"/>',
  arrow: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  back: '<path d="M20 12H5M11 6l-6 6 6 6"/>',
  copy: '<path d="M8 8h12v12H8z"/><path d="M16 8V4H4v12h4"/>',
  share: '<path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 13v8h14v-8"/>',
  screen: '<path d="M3 4h18v12H3zM8 20h8M12 16v4"/>',
  users: '<path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1"/><path d="M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6"/>',
  lock: '<path d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
  mail: '<path d="M3 5h18v14H3z"/><path d="M3 6l9 7 9-7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1"/>',
  grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  heart: '<path d="M12 20s-8-4.6-8-10.2A4.8 4.8 0 0 1 12 7a4.8 4.8 0 0 1 8 2.8C20 15.4 12 20 12 20z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  door: '<path d="M6 21V3h12v18M3 21h18M14 12h.01"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>',
  logout: '<path d="M15 4h5v16h-5M10 8l-4 4 4 4M6 12h11"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  sparkle: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
};

export function icon(name, cls = 'icon') {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span.firstChild;
}

export function markSvg(cls = 'mark') {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="${cls}" viewBox="64 64 896 896" aria-hidden="true"><path class="m-red" fill="#EC3013" d="M338 64H960V686H761V263H338Z"/><path class="m-ink" fill="#201E1D" d="M64 338H263V761H686V960H64Z"/></svg>`;
  return span.firstChild;
}

// ---------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------
export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = [...parts[0]][0] || '';
  const last = parts.length > 1 ? [...parts[parts.length - 1]][0] || '' : '';
  return (first + last).toUpperCase();
}

export function avatar(name, tone = 0, size) {
  const el = h('span', { class: `avatar tone-${Number(tone) % 8}`, 'aria-hidden': 'true' }, initials(name));
  if (size) el.style.setProperty('--size', `${size}px`);
  return el;
}

// ---------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------
let toastRoot;
export function toast(message, type = 'info', ms = 4200) {
  if (!toastRoot) {
    toastRoot = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastRoot);
  }
  const el = h('div', { class: `toast ${type === 'error' ? 'is-error' : type === 'ok' ? 'is-ok' : ''}` }, h('span', {}, message));
  toastRoot.append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}

// ---------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------
export function modal({ title, body, actions = [], onClose, dismissible = true, label }) {
  const dlg = h('dialog', { class: 'modal', 'aria-label': label || title || 'Dialog' });
  const closeBtn = dismissible
    ? h('button', { class: 'icon-btn modal-x', type: 'button', 'aria-label': 'Close', onclick: () => close(undefined) }, icon('x'))
    : null;
  const bodyEl = h('div', { class: 'modal-body' }, title ? h('h2', {}, title) : null, body);
  const actionsEl = h('div', { class: 'modal-actions' }, actions);
  dlg.append(closeBtn || '', bodyEl, actionsEl);
  document.body.append(dlg);

  let resolved = false;
  let resolver;
  const promise = new Promise((res) => (resolver = res));
  function close(value) {
    if (resolved) return;
    resolved = true;
    dlg.close();
    dlg.remove();
    onClose?.(value);
    resolver(value);
  }
  dlg.addEventListener('cancel', (e) => {
    if (!dismissible) e.preventDefault();
    else { e.preventDefault(); close(undefined); }
  });
  dlg.addEventListener('click', (e) => {
    if (dismissible && e.target === dlg) close(undefined);
  });
  dlg.showModal();
  return { dlg, close, promise, bodyEl, actionsEl };
}

export function confirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  const yes = h('button', { class: `btn ${danger ? 'btn-red' : ''}`, type: 'button' }, confirmText);
  const no = h('button', { class: 'btn btn-ghost', type: 'button' }, cancelText);
  const m = modal({
    title,
    body: typeof message === 'string' ? h('p', { class: 'muted' }, message) : message,
    actions: [no, yes],
  });
  no.addEventListener('click', () => m.close(false));
  yes.addEventListener('click', () => m.close(true));
  setTimeout(() => yes.focus(), 50);
  return m.promise.then((v) => v === true);
}

// ---------------------------------------------------------------------
// Buttons & forms
// ---------------------------------------------------------------------
export async function withBusy(button, fn) {
  if (!button) return fn();
  button.setAttribute('aria-busy', 'true');
  button.disabled = true;
  try {
    return await fn();
  } finally {
    button.removeAttribute('aria-busy');
    button.disabled = false;
  }
}

export function fieldError(input, message) {
  const field = input.closest('.field');
  let err = field?.querySelector('.error-text');
  if (!message) {
    input.removeAttribute('aria-invalid');
    err?.remove();
    return;
  }
  input.setAttribute('aria-invalid', 'true');
  if (!err && field) {
    err = h('p', { class: 'error-text', id: `${input.id}-err` });
    field.append(err);
    input.setAttribute('aria-describedby', err.id);
  }
  if (err) err.textContent = message;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// ---------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------
const dtFull = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const dtDay = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const dtShort = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export const fmt = {
  full: (d) => dtFull.format(d),
  day: (d) => dtDay.format(d),
  short: (d) => dtShort.format(d),
};

export function timeParts(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

export function relative(ms) {
  const { d, h: hrs, m } = timeParts(Math.abs(ms));
  if (d >= 2) return `${d} days`;
  if (d === 1) return `1 day ${hrs}h`;
  if (hrs >= 1) return `${hrs}h ${m}m`;
  if (m >= 1) return `${m} min`;
  return 'less than a minute';
}

export const pad2 = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------
// Errors → friendly words
// ---------------------------------------------------------------------
const AUTH_ERRORS = {
  'auth/invalid-credential': 'That email and password don’t match an account.',
  'auth/invalid-login-credentials': 'That email and password don’t match an account.',
  'auth/wrong-password': 'That email and password don’t match an account.',
  'auth/user-not-found': 'That email and password don’t match an account.',
  'auth/email-already-in-use': 'That email already has an account. Try signing in instead.',
  'auth/invalid-email': 'That doesn’t look like a valid email address.',
  'auth/weak-password': 'That password is too weak. Use at least 8 characters with letters and numbers.',
  'auth/password-does-not-meet-requirements': 'That password doesn’t meet the requirements.',
  'auth/too-many-requests': 'Too many attempts. Take a short break and try again in a few minutes.',
  'auth/network-request-failed': 'Network problem. Check your connection and try again.',
  'auth/requires-recent-login': 'For your security, please confirm your password first.',
  'auth/expired-action-code': 'This link has expired. Request a new one.',
  'auth/invalid-action-code': 'This link is invalid or was already used.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/missing-password': 'Enter your password.',
  'auth/operation-not-allowed': 'Email/password sign-in isn’t enabled for this project yet.',
  'auth/unauthorized-continue-uri': 'This website’s domain isn’t authorized in Firebase yet (see setup guide).',
  'auth/quota-exceeded': 'Too many emails sent today. Try again later.',
};

export function friendlyError(err, fallback = 'Something went wrong. Please try again.') {
  if (!err) return fallback;
  if (AUTH_ERRORS[err.code]) return AUTH_ERRORS[err.code];
  if (err.code === 'permission-denied') return 'That action isn’t allowed right now.';
  if (err.code === 'unavailable') return 'Can’t reach the server. Check your connection.';
  if (err.code === 'not-found') return 'That doesn’t exist anymore.';
  if (err.code === 'already-exists') return 'That already exists.';
  if (err.userMessage) return err.userMessage;
  return fallback;
}

export class UserError extends Error {
  constructor(message) {
    super(message);
    this.userMessage = message;
  }
}

// ---------------------------------------------------------------------
// Security: refuse to run inside someone else's frame (clickjacking).
// GitHub Pages can't send X-Frame-Options, so we do it in JS.
// ---------------------------------------------------------------------
export function frameGuard() {
  if (window.top !== window.self) {
    document.documentElement.style.display = 'none';
    try { window.top.location = window.self.location.href; } catch { /* cross-origin parent */ }
    return true;
  }
  return false;
}

// Only allow redirects to our own pages (no open-redirects via ?next=).
export function safeNext(raw, fallback = 'app.html') {
  if (!raw) return fallback;
  try {
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin) return fallback;
    const file = url.pathname.split('/').pop();
    if (!['app.html', ''].includes(file)) return fallback;
    return `app.html${url.hash}`;
  } catch {
    return fallback;
  }
}
