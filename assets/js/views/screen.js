// Big screen mode: project the join code + QR on the classroom board.
import { h, icon, clear, avatar } from '../ui.js';
import { qrSvg, joinUrl } from '../qr.js';

export function screenView(ctx, classId) {
  const { data } = ctx;
  const root = h('div', { class: 'screen-mode view', role: 'dialog', 'aria-label': 'Join code, big screen' });
  const exit = h('a', { class: 'btn btn-ghost btn-sm', href: `#/c/${classId}` }, icon('x'), 'Exit');
  const fsBtn = document.fullscreenEnabled ? h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('fullscreen'), 'Fullscreen') : null;
  fsBtn?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else root.requestFullscreen?.().catch(() => {});
  });

  const body = h('div', { class: 'screen-body' }, h('div', { class: 'spinner' }));
  const foot = h('div', { class: 'screen-count' });
  root.append(
    h('div', { class: 'screen-top' },
      h('span', { class: 'brand' },
        h('span', { html: '<svg class="mark" viewBox="64 64 896 896" aria-hidden="true"><path class="m-red" fill="#EC3013" d="M338 64H960V686H761V263H338Z"/><path class="m-ink" fill="#201E1D" d="M64 338H263V761H686V960H64Z"/></svg>' }).firstChild,
        h('img', { class: 'wordmark', src: 'assets/img/wordmark.png', alt: 'Likewise', width: '1797', height: '328' }),
      ),
      h('div', { class: 'row' }, fsBtn, exit),
    ),
    body,
    foot,
  );

  let cls;
  let members = [];
  let builtFor = null;
  const seenFaces = new Set();

  async function render() {
    if (cls === undefined) return;
    if (!cls || cls.status !== 'lobby') {
      clear(body).append(h('div', { style: { gridColumn: '1 / -1', textAlign: 'center' } },
        h('h1', { class: 'display display-l' }, 'Doors are closed.'),
        h('p', { class: 'lede', style: { margin: '20px auto' } }, 'This class has started (or ended), so the code no longer works.'),
        h('a', { class: 'btn', href: `#/c/${classId}` }, 'Back to class'),
      ));
      clear(foot);
      return;
    }
    if (builtFor !== cls.code) {
      builtFor = cls.code;
      const url = joinUrl(cls.code);
      const qrSlot = h('div', { class: 'qr-box', style: { border: '0', padding: '0' } }, h('span', { class: 'spinner' }));
      clear(body).append(
        h('div', {},
          h('p', { class: 'screen-join' }, `Join “${cls.name}”`),
          h('div', { class: 'code-tiles display' }, [...cls.code].map((c) => h('div', { class: 'code-tile' }, c))),
          h('p', { class: 'screen-url' }, 'Open ', h('b', {}, new URL('app.html', location.href).host + new URL('app.html', location.href).pathname), ' → Join with a code'),
        ),
        qrSlot,
      );
      qrSvg(url).then((svg) => clear(qrSlot).append(svg)).catch(() => clear(qrSlot));
    }
    clear(foot).append(
      h('b', {}, String(members.length)),
      h('span', { class: 'muted' }, members.length === 1 ? 'person in the lobby' : 'people in the lobby'),
      h('div', { class: 'screen-faces' }, members.map((m) => {
        const a = avatar(m.displayName, m.tone);
        if (seenFaces.has(m.uid)) a.style.animation = 'none';
        seenFaces.add(m.uid);
        a.title = m.displayName;
        return a;
      })),
    );
  }

  const u1 = data.watchClass(classId, (c) => { cls = c; render(); }, () => { cls = null; render(); });
  const u2 = data.watchMembers(classId, (list) => { members = list; render(); }, () => {});
  const onKey = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) ctx.navigate(`#/c/${classId}`); };
  addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  ctx.onCleanup(() => {
    u1(); u2();
    removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  });
  return root;
}
