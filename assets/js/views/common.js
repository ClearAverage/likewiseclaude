// Shared building blocks for app views.
import { h, icon, pad2, timeParts, relative, fmt } from '../ui.js';

export function pageHead({ eyebrow, title, lede, actions }) {
  return h('header', { class: 'page-head' },
    eyebrow ? h('p', { class: 'eyebrow' }, eyebrow) : null,
    h('div', { class: 'page-head-row' },
      h('h1', { 'data-split': '' }, title),
      actions ? h('div', { class: 'row' }, actions) : null,
    ),
    lede ? h('p', { class: 'lede' }, lede) : null,
  );
}

export function backLink(href = '#/', label = 'All classes') {
  return h('a', { class: 'back-link', href }, icon('back'), label);
}

export function emptyState({ title, text, actions }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-art', 'aria-hidden': 'true' }, h('span', { class: 'er' }), h('span', { class: 'ei' })),
    h('h3', {}, title),
    text ? h('p', {}, text) : null,
    actions ? h('div', { class: 'row', style: { justifyContent: 'center' } }, actions) : null,
  );
}

/** Two brackets: state = sealed | match | miss | none */
export function revealMark(state = 'sealed', cls = 'rv-mark') {
  return h('div', { class: `${cls} is-${state}`, 'aria-hidden': 'true' }, h('span', { class: 'rv-red' }), h('span', { class: 'rv-ink' }));
}

export function miniMark(state = 'sealed') {
  return h('div', { class: `mini-mark is-${state}`, 'aria-hidden': 'true' }, h('span', { class: 'r' }), h('span', { class: 'i' }));
}

export function markSvg(size = 36, cls = '') {
  const el = h('span', {
    html: `<svg class="${cls}" width="${size}" height="${size}" viewBox="64 64 896 896" aria-hidden="true"><path fill="#EC3013" d="M338 64H960V686H761V263H338Z"/><path fill="#201E1D" d="M64 338H263V761H686V960H64Z"/></svg>`,
  });
  return el.firstChild;
}

export function phasePill(phase) {
  const map = {
    lobby: ['pill', 'Lobby'],
    live: ['pill pill-live', 'Picking'],
    revealing: ['pill pill-ink', 'Revealing'],
    revealed: ['pill pill-ink', 'Results in'],
    stale: ['pill pill-outline', 'Never started'],
    expired: ['pill pill-outline', 'Gone'],
    gone: ['pill pill-outline', 'Closed'],
  };
  const [cls, text] = map[phase] || ['pill', phase];
  return h('span', { class: cls }, text);
}

/** Live countdown. Call .update(now) every second. */
export function countdown(targetMs, { label = 'Results drop in', light = false } = {}) {
  const nums = {};
  const unit = (key, cap) => {
    nums[key] = h('span', { class: 'cd-num' }, '00');
    return h('div', { class: 'cd-unit' }, nums[key], h('span', { class: 'cd-cap' }, cap));
  };
  const el = h('div', { class: 'countdown', role: 'timer', 'aria-live': 'off' },
    h('span', { class: 'cd-label' }, label),
    h('div', { class: 'cd-units' },
      unit('d', 'days'), h('span', { class: 'cd-sep', 'aria-hidden': 'true' }, ':'),
      unit('h', 'hours'), h('span', { class: 'cd-sep', 'aria-hidden': 'true' }, ':'),
      unit('m', 'min'), h('span', { class: 'cd-sep', 'aria-hidden': 'true' }, ':'),
      unit('s', 'sec'),
    ),
    h('span', { class: 'small', style: { opacity: light ? 0.7 : 1 } }, fmt.full(new Date(targetMs))),
  );
  const last = {};
  function update(now) {
    const p = timeParts(targetMs - now);
    for (const k of ['d', 'h', 'm', 's']) {
      const v = pad2(p[k]);
      if (last[k] !== v) {
        nums[k].textContent = v;
        if (last[k] !== undefined) {
          nums[k].classList.remove('is-tick');
          void nums[k].offsetWidth;
          nums[k].classList.add('is-tick');
        }
        last[k] = v;
      }
    }
    el.setAttribute('aria-label', `Results in ${relative(targetMs - now)}`);
  }
  return { el, update };
}

// "Seen" flags for reveal animations are a per-device nicety only.
export const seen = {
  key: (uid, cid) => `lw:seen:${uid}:${cid}`,
  has(uid, cid) {
    try { return localStorage.getItem(this.key(uid, cid)) === '1'; } catch { return false; }
  },
  set(uid, cid) {
    try { localStorage.setItem(this.key(uid, cid), '1'); } catch { /* ignore */ }
  },
};

export function firstName(name = '') {
  return name.trim().split(/\s+/)[0] || name;
}
