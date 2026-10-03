// Results tab: every class whose reveal has happened, plus what's coming up.
import { h, icon, clear, toast, avatar, friendlyError, fmt, relative } from '../ui.js';
import { pageHead, emptyState, miniMark, seen, firstName } from './common.js';
import { burst } from '../confetti.js';

export function resultsView(ctx) {
  const { session, data } = ctx;
  const uid = session.user.uid;
  const ms = data.toMillis;

  const listSlot = h('div', { class: 'result-list', 'aria-live': 'polite' });
  const upcomingSlot = h('div');
  const root = h('section', { class: 'view' },
    pageHead({
      eyebrow: 'Results',
      title: 'The moment of truth.',
      lede: 'Results show up here on reveal day and stay for 3 days. Only you can see yours.',
    }),
    listSlot,
    upcomingSlot,
  );

  const results = new Map(); // classId -> result
  const names = new Map();   // classId -> Map(uid -> member)

  async function loadNames(cid) {
    if (names.has(cid)) return names.get(cid);
    const map = new Map();
    try {
      const { getDocs } = ctx.fb.fsMod;
      const snap = await getDocs(data.ref.members(cid));
      snap.docs.forEach((d) => map.set(d.id, d.data()));
    } catch { /* ignore */ }
    names.set(cid, map);
    return map;
  }

  async function open(m, row, btn) {
    btn?.setAttribute('aria-busy', 'true');
    try {
      const [r] = await Promise.all([data.getResult(m.id, uid), loadNames(m.id)]);
      results.set(m.id, r);
      seen.set(uid, m.id);
      dispatchEvent(new CustomEvent('lw:seen'));
      const fresh = drawRow(m, true);
      row.replaceWith(fresh);
      if (r.kind === 'match') {
        const mark = fresh.querySelector('.mini-mark');
        const rect = mark.getBoundingClientRect();
        setTimeout(() => burst({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, count: 110, spread: 0.8 }), 500);
      }
    } catch (err) {
      toast(friendlyError(err, 'Couldn’t load that result.'), 'error');
      btn?.removeAttribute('aria-busy');
    }
  }

  function drawRow(m, animate = false) {
    const r = results.get(m.id);
    const now = data.serverNow();
    const meta = h('p', { class: 'meta' }, `Gone in ${relative(ms(m.expireAt) - now)}`);
    if (!r) {
      const btn = h('button', { class: 'btn btn-red btn-sm', type: 'button' }, 'Reveal');
      const row = h('div', { class: 'result-row' },
        miniMark('sealed'),
        h('div', {}, h('h3', {}, m.className), meta),
        btn,
      );
      btn.addEventListener('click', () => open(m, row, btn));
      return row;
    }
    const nm = names.get(m.id);
    const target = r.target ? nm?.get(r.target) : null;
    const state = r.kind === 'match' ? 'match' : r.kind === 'nomatch' ? 'miss' : 'none';
    const mark = miniMark(animate ? 'sealed' : state);
    if (animate) requestAnimationFrame(() => requestAnimationFrame(() => { mark.className = `mini-mark is-${state}`; }));
    let line;
    if (r.kind === 'match') {
      line = h('div', { class: 'row', style: { '--gap': '10px' } },
        target ? avatar(target.displayName, target.tone, 32) : null,
        h('b', { class: 'red' }, `It’s mutual${target ? ` with ${firstName(target.displayName)}` : ''}.`));
    } else if (r.kind === 'nomatch') line = h('span', { class: 'muted' }, 'No mutual match this round.');
    else line = h('span', { class: 'muted' }, 'You didn’t pick anyone.');
    return h('div', { class: 'result-row' },
      mark,
      h('div', {}, h('h3', {}, m.className), meta),
      h('div', { class: 'row' }, line, h('a', { class: 'btn btn-ghost btn-sm', href: `#/c/${m.id}` }, 'Open')),
    );
  }

  async function render() {
    const now = data.serverNow();
    const revealed = session.memberships
      .filter((m) => now >= ms(m.revealAt) + data.REVEAL_GRACE_MS && now < ms(m.expireAt))
      .sort((a, b) => ms(b.revealAt) - ms(a.revealAt));
    const upcoming = session.memberships
      .filter((m) => now < ms(m.revealAt))
      .sort((a, b) => ms(a.revealAt) - ms(b.revealAt));

    // Results already seen on this device open straight away.
    await Promise.all(revealed.filter((m) => seen.has(uid, m.id) && !results.has(m.id)).map(async (m) => {
      try {
        const [r] = await Promise.all([data.getResult(m.id, uid), loadNames(m.id)]);
        results.set(m.id, r);
      } catch { /* show as sealed */ }
    }));

    clear(listSlot);
    if (!revealed.length) {
      listSlot.append(emptyState({
        title: 'Nothing to reveal yet',
        text: upcoming.length ? 'Your results will show up here the moment the reveal time hits.' : 'Join or host a class. When reveal day comes, your result lands here.',
        actions: upcoming.length ? null : [h('a', { class: 'btn', href: '#/' }, 'Go to classes')],
      }));
    } else {
      revealed.forEach((m, i) => {
        const row = drawRow(m);
        row.style.setProperty('--i', i);
        listSlot.append(row);
      });
    }

    clear(upcomingSlot);
    if (upcoming.length) {
      upcomingSlot.append(
        h('div', { class: 'section-title' }, h('span', {}, 'Coming up')),
        h('div', { class: 'result-list' }, upcoming.map((m, i) => h('a', { class: 'result-row', href: `#/c/${m.id}`, style: { '--i': i } },
          h('span', { class: 'tile-icon', style: { width: '48px', height: '48px', background: 'var(--mist)', color: 'var(--ink)' } }, icon('clock')),
          h('div', {}, h('h3', {}, m.className), h('p', { class: 'meta' }, fmt.full(m.revealAt.toDate()))),
          h('span', { class: 'pill' }, `in ${relative(ms(m.revealAt) - now)}`),
        ))),
      );
    }
  }

  const onChange = () => render();
  addEventListener('lw:memberships', onChange);
  const t = setInterval(render, 30000);
  ctx.onCleanup(() => { removeEventListener('lw:memberships', onChange); clearInterval(t); });

  return render().then(() => root);
}
