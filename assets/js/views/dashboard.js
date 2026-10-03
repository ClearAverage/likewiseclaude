// Home: your classes + host / join.
import { h, icon, clear, toast, relative } from '../ui.js';
import { pageHead, emptyState, phasePill, markSvg, seen, firstName } from './common.js';

export async function dashboard(ctx) {
  const { session, data } = ctx;
  const uid = session.user.uid;
  const ms = data.toMillis;

  const root = h('section', { class: 'view' });
  const head = pageHead({
    eyebrow: 'Your classes',
    title: `Hey, ${firstName(session.profile.displayName)}.`,
    lede: 'Host a new class or join one with a code. Whatever you pick stays sealed.',
  });

  const hostTile = h('a', { class: 'tile tile-ink', href: '#/new', 'data-tilt': '4' },
    h('div', {},
      h('span', { class: 'tile-icon' }, icon('plus')),
    ),
    h('div', {},
      h('h2', {}, 'Host a class'),
      h('p', {}, 'Name it, lock in the reveal date, share the code.'),
    ),
    h('div', { class: 'tile-foot' }, h('b', {}, 'Start one'), icon('arrow', 'icon tile-arrow')),
  );
  const joinTile = h('a', { class: 'tile', href: '#/join', 'data-tilt': '4' },
    h('div', {},
      h('span', { class: 'tile-icon', style: { background: 'var(--ink)' } }, icon('door')),
    ),
    h('div', {},
      h('h2', {}, 'Join with a code'),
      h('p', {}, 'Got a 6-letter code from a classmate? Jump in before the doors close.'),
    ),
    h('div', { class: 'tile-foot' }, h('b', {}, 'Enter code'), icon('arrow', 'icon tile-arrow')),
  );

  const bannerSlot = h('div');
  const countEl = h('span');
  const grid = h('div', { class: 'class-grid', 'aria-live': 'polite' });
  root.append(
    head,
    bannerSlot,
    h('div', { class: 'tiles' }, hostTile, joinTile),
    h('div', { class: 'section-title' }, h('span', {}, 'Your classes'), countEl),
    grid,
  );

  // skeletons while loading
  for (let i = 0; i < 2; i++) grid.append(h('div', { class: 'class-card skeleton', style: { border: '0' } }));

  const cache = new Map(); // classId -> { cls } | { gone: true }
  const handled = new Set();
  let memberships = session.memberships;
  let disposed = false;
  ctx.onCleanup(() => { disposed = true; });

  async function fetchClasses(list) {
    const now = data.serverNow();
    await Promise.all(list.map(async (m) => {
      if (now >= ms(m.expireAt)) return;
      try {
        const cls = await data.getClass(m.id);
        cache.set(m.id, cls ? { cls } : { gone: true });
      } catch (err) {
        if (err.code === 'permission-denied' || err.code === 'not-found') cache.set(m.id, { gone: true });
        else cache.set(m.id, { error: true });
      }
    }));
  }

  function phaseFor(m) {
    const now = data.serverNow();
    if (now >= ms(m.expireAt)) return 'expired';
    const c = cache.get(m.id);
    if (!c) return 'loading';
    if (c.gone) return 'gone';
    if (c.error) return 'error';
    return data.phaseOf(c.cls, now);
  }

  function whenText(m, phase) {
    const now = data.serverNow();
    const c = cache.get(m.id)?.cls;
    const isHost = m.role === 'host';
    switch (phase) {
      case 'lobby': return isHost ? 'Waiting for you to press Start' : 'Waiting for the host to start';
      case 'live': return `Results in ${relative(ms(m.revealAt) - now)} · ${c?.pickCount ?? 0} locked in`;
      case 'revealing': return 'Revealing now…';
      case 'revealed': return seen.has(uid, m.id) ? `Results are in · gone in ${relative(ms(m.expireAt) - now)}` : 'Tap to see your result';
      case 'stale': return 'Reveal time passed before it started';
      case 'error': return 'Couldn’t load. Tap to retry';
      default: return '';
    }
  }

  const ORDER = { revealed: 0, revealing: 1, live: 2, lobby: 3, stale: 4, error: 5, loading: 6 };

  function render() {
    if (disposed) return;

    // Tidy up expired and closed classes in the background (once each).
    for (const m of memberships) {
      const phase = phaseFor(m);
      if (handled.has(m.id)) continue;
      if (phase === 'expired') {
        handled.add(m.id);
        data.sweepClass(m.id, uid).catch(() => {});
      }
      if (phase === 'gone') {
        handled.add(m.id);
        data.forgetClass(m.id, uid).catch(() => {});
        toast(`“${m.className}” is no longer available.`);
      }
    }

    const visible = memberships
      .map((m) => ({ m, phase: phaseFor(m) }))
      .filter(({ phase }) => phase !== 'expired' && phase !== 'gone')
      .sort((a, b) => (ORDER[a.phase] - ORDER[b.phase]) || (ms(a.m.revealAt) - ms(b.m.revealAt)));

    countEl.textContent = visible.length ? String(visible.length) : '';

    // Results banner
    clear(bannerSlot);
    const fresh = visible.find(({ m, phase }) => phase === 'revealed' && !seen.has(uid, m.id));
    if (fresh) {
      bannerSlot.append(h('a', { class: 'banner', href: `#/c/${fresh.m.id}` },
        markSvg(36, 'banner-mark'),
        h('div', {}, h('b', {}, 'Results are in.'), h('div', { class: 'small muted' }, fresh.m.className)),
        h('span', { class: 'spacer' }),
        h('span', { class: 'btn btn-sm btn-red' }, 'See result'),
      ));
    }

    clear(grid);
    if (!visible.length) {
      grid.append(emptyState({
        title: 'No classes yet',
        text: 'Host one for your class, or join with the code someone shared.',
        actions: [
          h('a', { class: 'btn', href: '#/new' }, 'Host a class'),
          h('a', { class: 'btn btn-ghost', href: '#/join' }, 'Join with a code'),
        ],
      }));
      grid.style.gridTemplateColumns = '1fr';
      return;
    }
    grid.style.gridTemplateColumns = '';
    visible.forEach(({ m, phase }, i) => {
      const c = cache.get(m.id)?.cls;
      const hot = phase === 'revealed' && !seen.has(uid, m.id);
      grid.append(h('a', { class: 'class-card', href: `#/c/${m.id}`, style: { '--i': i } },
        h('div', { class: 'row', style: { justifyContent: 'space-between' } },
          phasePill(phase === 'loading' ? 'lobby' : phase),
          m.role === 'host' ? h('span', { class: 'pill pill-outline' }, 'Host') : null,
        ),
        h('div', {},
          h('h3', {}, m.className),
          h('p', { class: 'meta' }, c ? `Hosted by ${c.hostName}` : ' '),
        ),
        h('div', { class: 'class-card-foot' },
          h('span', { class: `when ${hot ? 'is-hot' : ''}` }, whenText(m, phase)),
          icon('arrow'),
        ),
      ));
    });
  }

  async function refresh(list) {
    memberships = list;
    await fetchClasses(list.filter((m) => !cache.has(m.id)));
    render();
  }

  const onMemberships = () => refresh(session.memberships);
  addEventListener('lw:memberships', onMemberships);
  ctx.onCleanup(() => removeEventListener('lw:memberships', onMemberships));

  const tick = setInterval(async () => {
    // re-check statuses occasionally (host may have started, picks counted)
    await fetchClasses(memberships);
    render();
  }, 30000);
  ctx.onCleanup(() => clearInterval(tick));

  await refresh(memberships);
  return root;
}
