// One class: lobby → picking → reveal → gone.
import { h, icon, clear, toast, withBusy, friendlyError, confirmDialog, modal, avatar, copyText, fmt, relative } from '../ui.js';
import { settings } from '../config.js';
import { refreshMotion } from '../motion.js';
import { burst } from '../confetti.js';
import { qrSvg, joinUrl } from '../qr.js';
import { backLink, emptyState, phasePill, countdown, revealMark, seen, firstName } from './common.js';

export async function classView(ctx, classId) {
  const { session, data } = ctx;
  const uid = session.user.uid;
  const ms = data.toMillis;
  const membership = () => session.memberships.find((m) => m.id === classId);

  const headSlot = h('div');
  const bodySlot = h('div');
  const footSlot = h('div', { style: { marginTop: '40px' } });
  const root = h('section', { class: 'view' }, backLink(), headSlot, bodySlot, footSlot);

  let cls;            // undefined = loading, null = gone
  let members = [];
  let myPick;         // undefined = loading, null = none
  let denied = false;
  let mounted = null; // { phase, update?, tick? }
  let unsubPick = null;

  // Expired already? Don't even ask the server for the class.
  const m0 = membership();
  if (m0 && data.serverNow() >= ms(m0.expireAt)) {
    renderExpired(m0);
    return root;
  }

  const unsubClass = data.watchClass(classId, (c) => {
    cls = c;
    update();
  }, (err) => {
    denied = true;
    cls = null;
    console.warn('class listener', err.code);
    update();
  });
  const unsubMembers = data.watchMembers(classId, (list) => {
    members = list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    update();
  }, () => {});
  const ticker = setInterval(() => {
    const p = phase();
    if (mounted && mounted.phase !== p) update();
    else mounted?.tick?.(data.serverNow());
  }, 1000);
  ctx.onCleanup(() => {
    unsubClass();
    unsubMembers();
    unsubPick?.();
    clearInterval(ticker);
  });

  function phase() {
    if (cls === undefined) return 'loading';
    if (cls === null) return denied ? 'gone' : 'gone';
    return data.phaseOf(cls, data.serverNow());
  }

  function ensurePickListener() {
    if (unsubPick) return;
    unsubPick = data.watchMyPick(classId, uid, (p) => { myPick = p; update(); }, () => { myPick = null; update(); });
  }

  function update() {
    const p = phase();
    renderHead(p);
    if (['live', 'revealing', 'revealed'].includes(p)) ensurePickListener();
    if (!mounted || mounted.phase !== p) mount(p);
    else mounted.update?.();
  }

  function mount(p) {
    clear(bodySlot);
    clear(footSlot);
    const builders = {
      loading: mountLoading, gone: mountGone, expired: () => renderExpired(membership()),
      stale: mountStale, lobby: mountLobby, live: mountLive, revealing: mountRevealing, revealed: mountRevealed,
    };
    mounted = builders[p]?.() || { phase: p };
    mounted.phase = p;
    if (!['loading', 'gone', 'expired'].includes(p)) footSlot.append(reportLink());
    refreshMotion(root);
  }

  // ------------------------------------------------------------------
  // Head
  // ------------------------------------------------------------------
  function renderHead(p) {
    const m = membership();
    const name = cls?.name || m?.className || 'Class';
    const revealAt = cls?.revealAt || m?.revealAt;
    clear(headSlot).append(h('header', { class: 'class-head' },
      h('div', { class: 'row' },
        phasePill(p === 'loading' ? 'lobby' : p),
        cls?.hostUid === uid ? h('span', { class: 'pill pill-outline' }, 'You’re hosting') : null,
      ),
      h('h1', {}, name),
      h('div', { class: 'class-meta' },
        cls ? h('span', {}, icon('user'), `Host: ${cls.hostName}`) : null,
        revealAt ? h('span', {}, icon('clock'), `Results ${fmt.full(revealAt.toDate())}`) : null,
        members.length ? h('span', {}, icon('users'), `${members.length} ${members.length === 1 ? 'person' : 'people'}`) : null,
      ),
    ));
    document.title = `${name} · Likewise`;
  }

  // ------------------------------------------------------------------
  // Simple states
  // ------------------------------------------------------------------
  function mountLoading() {
    bodySlot.append(h('div', { class: 'class-layout' },
      h('div', { class: 'panel skeleton', style: { height: '280px', border: '0' } }),
      h('div', { class: 'panel skeleton', style: { height: '280px', border: '0' } }),
    ));
    return {};
  }

  function mountGone() {
    data.forgetClass(classId, uid).catch(() => {});
    bodySlot.append(emptyState({
      title: 'This class isn’t available',
      text: 'The host may have cancelled it, or you were removed from the lobby.',
      actions: [h('a', { class: 'btn', href: '#/' }, 'Back to classes')],
    }));
    return {};
  }

  function renderExpired(m) {
    data.sweepClass(classId, uid).catch(() => {});
    clear(headSlot).append(h('header', { class: 'class-head' },
      h('div', { class: 'row' }, phasePill('expired')),
      h('h1', {}, m?.className || 'Class'),
    ));
    clear(bodySlot).append(emptyState({
      title: 'This class is gone.',
      text: `Results were up for ${settings.keepDaysAfterReveal} days, and now everything about this class has been wiped.`,
      actions: [h('a', { class: 'btn', href: '#/' }, 'Back to classes')],
    }));
    return {};
  }

  function mountStale() {
    const isHost = cls.hostUid === uid;
    const btn = h('button', { class: 'btn btn-ghost', type: 'button' }, isHost ? 'Delete this class' : 'Leave this class');
    btn.addEventListener('click', () => withBusy(btn, async () => {
      try {
        if (isHost) await data.cancelClass(classId, uid, cls.code, members.map((x) => x.uid));
        else await data.leaveClass(classId, uid);
        ctx.navigate('#/');
      } catch (err) { toast(friendlyError(err), 'error'); }
    }));
    bodySlot.append(emptyState({
      title: 'This class never started',
      text: 'The reveal time passed before the host pressed Start, so there’s nothing to reveal.',
      actions: [btn, h('a', { class: 'btn', href: '#/new' }, 'Host a new one')],
    }));
    return {};
  }

  // ------------------------------------------------------------------
  // Roster
  // ------------------------------------------------------------------
  const shown = new Set();
  let firstRoster = true;
  function rosterEl({ canKick }) {
    const grid = h('div', { class: 'roster' });
    for (const m of members) {
      const isNew = !firstRoster && !shown.has(m.uid);
      shown.add(m.uid);
      const tags = [];
      if (m.uid === cls.hostUid) tags.push(h('span', { class: 'tag is-host' }, 'Host'));
      if (m.uid === uid) tags.push(h('span', { class: 'tag' }, 'You'));
      let kick = null;
      if (canKick && m.uid !== uid) {
        kick = h('button', { class: 'kick', type: 'button', 'aria-label': `Remove ${m.displayName}`, title: 'Remove' }, icon('x'));
        kick.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: `Remove ${m.displayName}?`,
            message: 'They’ll be taken out of the lobby and can’t rejoin this class. Use this for names you don’t recognize.',
            confirmText: 'Remove', danger: true,
          });
          if (!ok) return;
          try {
            await data.kickMember(classId, m.uid);
            toast(`${m.displayName} was removed.`);
          } catch (err) { toast(friendlyError(err), 'error'); }
        });
      }
      grid.append(h('div', { class: `roster-item ${isNew ? 'is-new' : ''}` },
        avatar(m.displayName, m.tone),
        h('div', { class: 'who' }, h('span', { class: 'name' }, m.displayName), tags.length ? h('div', { class: 'row', style: { '--gap': '8px' } }, tags) : null),
        kick,
      ));
    }
    firstRoster = false;
    return grid;
  }

  // ------------------------------------------------------------------
  // Lobby
  // ------------------------------------------------------------------
  function mountLobby() {
    const isHost = cls.hostUid === uid;
    return isHost ? mountHostLobby() : mountMemberLobby();
  }

  function codeTiles(code) {
    return h('div', { class: 'code-tiles display', role: 'img', 'aria-label': `Class code ${code.split('').join(' ')}` },
      [...code].map((c) => h('div', { class: 'code-tile', 'aria-hidden': 'true' }, c)));
  }

  function mountHostLobby() {
    const code = cls.code;
    const url = joinUrl(code);
    const copyBtn = h('button', { class: 'btn btn-white btn-sm', type: 'button' }, icon('copy'), 'Copy code');
    const linkBtn = h('button', { class: 'btn btn-white btn-sm', type: 'button' }, icon('copy'), 'Copy invite link');
    const shareBtn = navigator.share ? h('button', { class: 'btn btn-white btn-sm', type: 'button' }, icon('share'), 'Share') : null;
    const qrBtn = h('button', { class: 'btn btn-white btn-sm', type: 'button', 'aria-expanded': 'false' }, icon('qr'), 'QR code');
    const screenBtn = h('a', { class: 'btn btn-red btn-sm', href: `#/c/${classId}/screen` }, icon('screen'), 'Big screen');
    const qrSlot = h('div');

    copyBtn.addEventListener('click', async () => toast((await copyText(code)) ? 'Code copied.' : 'Couldn’t copy. Long-press the code instead.'));
    linkBtn.addEventListener('click', async () => toast((await copyText(url)) ? 'Invite link copied.' : 'Couldn’t copy the link.'));
    shareBtn?.addEventListener('click', () => navigator.share({ title: `Join ${cls.name} on Likewise`, text: `Join my class on Likewise with code ${code}`, url }).catch(() => {}));
    qrBtn.addEventListener('click', async () => {
      const open = qrBtn.getAttribute('aria-expanded') !== 'true';
      qrBtn.setAttribute('aria-expanded', String(open));
      clear(qrSlot);
      if (!open) return;
      qrSlot.append(h('div', { class: 'qr-box' }, h('span', { class: 'spinner' })));
      try {
        const svg = await qrSvg(url);
        clear(qrSlot).append(h('div', { class: 'qr-box' }, svg));
      } catch {
        clear(qrSlot).append(h('p', { class: 'small' }, 'Couldn’t load the QR code. Share the link instead.'));
      }
    });

    const rosterSlot = h('div');
    const countPill = h('span', { class: 'pill' });
    const startBtn = h('button', { class: 'btn btn-lg btn-red', type: 'button' }, 'Start: close the doors', icon('arrow', 'icon arrow'));
    const startHint = h('p', { class: 'small muted' });
    const cancelBtn = h('button', { class: 'danger-link', type: 'button' }, 'Cancel this class');

    startBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Close the doors?',
        message: h('div', { class: 'stack', style: { '--gap': '10px' } },
          h('p', { class: 'muted' }, `Once you start, nobody new can join and you can’t remove anyone. Picking opens right away for all ${members.length} of you.`),
          h('p', { class: 'muted' }, 'Results drop ', h('b', { style: { color: 'var(--ink)' } }, fmt.full(cls.revealAt.toDate())), '.'),
        ),
        confirmText: 'Start now',
      });
      if (!ok) return;
      await withBusy(startBtn, async () => {
        try {
          await data.startClass(classId, code);
          toast('Doors closed. Picking is open!', 'ok');
        } catch (err) { toast(friendlyError(err), 'error'); }
      });
    });
    cancelBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Cancel this class?',
        message: 'Everyone will be removed and the code will stop working. This can’t be undone.',
        confirmText: 'Cancel class', cancelText: 'Keep it', danger: true,
      });
      if (!ok) return;
      try {
        await data.cancelClass(classId, uid, code, members.map((x) => x.uid));
        toast('Class cancelled.');
        ctx.navigate('#/');
      } catch (err) { toast(friendlyError(err), 'error'); }
    });

    bodySlot.append(h('div', { class: 'class-layout' },
      h('div', { class: 'stack', style: { '--gap': '20px' } },
        h('div', { class: 'panel panel-ink' },
          h('p', { class: 'eyebrow on-dark' }, 'Share this code'),
          codeTiles(code),
          h('div', { class: 'code-actions' }, copyBtn, linkBtn, shareBtn, qrBtn, screenBtn),
          qrSlot,
          h('p', { class: 'small muted' }, 'Classmates open Likewise, tap “Join with a code”, and type it in. Or scan the QR.'),
        ),
        h('div', { class: 'panel' },
          h('div', { class: 'panel-title' }, h('h2', {}, 'Ready?')),
          h('p', { class: 'lock-note' }, icon('lock'), h('span', {}, 'Check every name in the lobby first. Remove anyone who isn’t in your class. Once you start, the list is locked.')),
          h('div', { class: 'sticky-actions' }, startBtn),
          startHint,
          cancelBtn,
        ),
      ),
      h('div', { class: 'panel' },
        h('div', { class: 'panel-title' }, h('h2', {}, 'In the lobby'), countPill),
        rosterSlot,
      ),
    ));

    function upd() {
      clear(rosterSlot).append(rosterEl({ canKick: true }));
      countPill.textContent = `${members.length} joined`;
      const enough = members.length >= settings.minMembersToStart;
      startBtn.disabled = !enough;
      startHint.textContent = enough
        ? `Results drop ${fmt.full(cls.revealAt.toDate())}.`
        : `You need at least ${settings.minMembersToStart} people to start (so results stay private).`;
    }
    upd();
    return { update: upd };
  }

  function mountMemberLobby() {
    const rosterSlot = h('div');
    const countPill = h('span', { class: 'pill' });
    const leaveBtn = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Leave class');
    leaveBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Leave this class?', message: 'You can rejoin with the code as long as the host hasn’t started yet.', confirmText: 'Leave' });
      if (!ok) return;
      try {
        await data.leaveClass(classId, uid);
        ctx.navigate('#/');
      } catch (err) { toast(friendlyError(err), 'error'); }
    });

    bodySlot.append(h('div', { class: 'class-layout' },
      h('div', { class: 'panel panel-ink' },
        h('div', { class: 'waiting' }, h('span', { class: 'waiting-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', { class: 'cd-label' }, 'Waiting for the host')),
        h('h2', { class: 'display display-s' }, 'You’re in.'),
        h('p', { class: 'muted' }, `When ${firstName(cls.hostName)} presses Start, the doors close and picking opens. Results drop ${fmt.full(cls.revealAt.toDate())}.`),
        h('div', {}, leaveBtn),
      ),
      h('div', { class: 'panel' },
        h('div', { class: 'panel-title' }, h('h2', {}, 'In the lobby'), countPill),
        rosterSlot,
        h('p', { class: 'small muted' }, 'Don’t recognize someone? Use “Report a problem” below.'),
      ),
    ));
    leaveBtn.classList.add('btn-white');
    function upd() {
      clear(rosterSlot).append(rosterEl({ canKick: false }));
      countPill.textContent = `${members.length} joined`;
    }
    upd();
    return { update: upd };
  }

  // ------------------------------------------------------------------
  // Live: pick in secret
  // ------------------------------------------------------------------
  function mountLive() {
    const cd = countdown(ms(cls.revealAt), { label: 'Results drop in', light: true });
    const progressFill = h('div', { class: 'progress-fill' });
    const progressText = h('span');
    const myPickSlot = h('div');
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search classmates', 'aria-label': 'Search classmates', autocomplete: 'off' });
    const peopleSlot = h('div', { class: 'people', role: 'list' });

    bodySlot.append(h('div', { class: 'stack', style: { '--gap': '20px' } },
      h('div', { class: 'panel panel-ink' },
        cd.el,
        h('div', { class: 'progress' },
          h('div', { class: 'progress-track' }, progressFill),
          h('div', { class: 'progress-text' }, progressText, h('span', { class: 'muted' }, 'Who picked who stays sealed')),
        ),
      ),
      h('div', { class: 'panel' },
        h('div', { class: 'panel-title' }, h('h2', {}, 'Your pick')),
        myPickSlot,
        h('p', { class: 'lock-note' }, icon('lock'), h('span', {}, `Only you can see this. Change it as often as you like until ${fmt.full(cls.revealAt.toDate())}. Then it freezes.`)),
      ),
      h('div', { class: 'panel' },
        h('div', { class: 'panel-title' }, h('h2', {}, 'Choose one')),
        h('div', { class: 'search' }, icon('search'), search),
        peopleSlot,
      ),
    ));

    search.addEventListener('input', renderPeople);

    function targetMember() {
      return myPick ? members.find((x) => x.uid === myPick.target) : null;
    }

    async function choose(m) {
      if (myPick?.target === m.uid) return;
      const ok = await confirmDialog({
        title: myPick ? `Switch to ${m.displayName}?` : `Pick ${m.displayName}?`,
        message: `If ${firstName(m.displayName)} picks you too, you’ll both see it on reveal day. If not, they’ll never know.`,
        confirmText: myPick ? 'Switch pick' : `Lock in ${firstName(m.displayName)}`,
      });
      if (!ok) return;
      try {
        await data.savePick(classId, uid, m.uid, { hadPick: !!myPick, expireAt: cls.expireAt });
        toast('Locked in. Only you can see this.', 'ok');
      } catch (err) {
        if (err.code === 'permission-denied' && data.serverNow() >= ms(cls.revealAt) - 5000) toast('Too late! Picks are frozen for the reveal.', 'error');
        else toast(friendlyError(err), 'error');
      }
    }

    async function unpick() {
      const ok = await confirmDialog({ title: 'Remove your pick?', message: 'You won’t be matched with anyone unless you pick again before the reveal.', confirmText: 'Remove pick', danger: true });
      if (!ok) return;
      try {
        await data.removePick(classId, uid);
        toast('Pick removed.');
      } catch (err) { toast(friendlyError(err), 'error'); }
    }

    function renderMyPick() {
      clear(myPickSlot);
      if (myPick === undefined) {
        myPickSlot.append(h('div', { class: 'my-pick my-pick-none skeleton', style: { height: '90px' } }));
        return;
      }
      const t = targetMember();
      if (!myPick || !t) {
        myPickSlot.append(h('div', { class: 'my-pick my-pick-none' },
          h('div', {}, h('b', {}, 'No pick yet'), h('span', { class: 'small muted' }, 'Choose someone below. Nobody will see it.')),
        ));
        return;
      }
      const change = h('button', { class: 'btn btn-sm btn-ghost', type: 'button' }, 'Change');
      const remove = h('button', { class: 'btn btn-sm btn-quiet', type: 'button' }, 'Remove');
      change.addEventListener('click', () => { search.focus(); search.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
      remove.addEventListener('click', unpick);
      myPickSlot.append(h('div', { class: 'my-pick' },
        avatar(t.displayName, t.tone),
        h('div', {}, h('span', { class: 'small muted' }, 'You picked'), h('b', {}, t.displayName)),
        h('div', { class: 'actions' }, change, remove),
      ));
    }

    function renderPeople() {
      const q = search.value.trim().toLowerCase();
      clear(peopleSlot);
      const list = members.filter((x) => x.uid !== uid && (!q || x.displayName.toLowerCase().includes(q)));
      if (!list.length) {
        peopleSlot.append(h('p', { class: 'muted small' }, q ? 'No one by that name.' : 'No classmates yet.'));
        return;
      }
      for (const m of list) {
        const selected = myPick?.target === m.uid;
        const btn = h('button', {
          class: `person framed ${selected ? 'is-selected' : ''}`, type: 'button', role: 'listitem',
          'aria-pressed': String(selected), 'aria-label': selected ? `${m.displayName}, your pick` : `Pick ${m.displayName}`,
        },
        selected ? h('span', { class: 'badge' }, 'Your pick') : null,
        avatar(m.displayName, m.tone),
        h('span', { class: 'name' }, m.displayName));
        btn.addEventListener('click', () => choose(m));
        peopleSlot.append(btn);
      }
    }

    function upd() {
      const total = members.length;
      const count = Math.min(cls.pickCount || 0, total);
      progressFill.style.transform = `scaleX(${total ? count / total : 0})`;
      progressText.textContent = `${count} of ${total} locked in`;
      renderMyPick();
      renderPeople();
    }
    cd.update(data.serverNow());
    upd();
    return { update: upd, tick: (now) => cd.update(now) };
  }

  // ------------------------------------------------------------------
  // The few seconds right at the reveal moment
  // ------------------------------------------------------------------
  function mountRevealing() {
    bodySlot.append(h('div', { class: 'reveal-stage' },
      revealMark('sealed'),
      h('h2', { class: 'rv-title' }, 'Revealing…'),
      h('p', { class: 'rv-sub' }, 'Every pick just froze. Hang tight.'),
    ));
    return {};
  }

  // ------------------------------------------------------------------
  // Revealed
  // ------------------------------------------------------------------
  function mountRevealed() {
    const stage = h('div', { class: 'reveal-stage' });
    const wipeNote = h('p', { class: 'small muted', style: { textAlign: 'center', marginTop: '18px' } });
    bodySlot.append(stage, wipeNote);

    let result = null;
    let busy = false;

    function wipeText(now) {
      wipeNote.textContent = `This class disappears ${fmt.full(cls.expireAt.toDate())} (in ${relative(ms(cls.expireAt) - now)}).`;
    }

    function showSealed() {
      const btn = h('button', { class: 'btn btn-lg btn-red', type: 'button', 'data-magnetic': '0.2' }, 'Reveal my result');
      btn.addEventListener('click', () => reveal(btn));
      clear(stage).append(
        revealMark('sealed'),
        h('p', { class: 'eyebrow' }, 'Results are in'),
        h('h2', { class: 'rv-title' }, 'Ready?'),
        h('p', { class: 'rv-sub' }, 'Take a breath. Whatever it says, only you will see it.'),
        btn,
      );
      refreshMotion(stage);
    }

    async function reveal(btn, { animate = true } = {}) {
      if (busy) return;
      busy = true;
      try {
        if (btn) btn.setAttribute('aria-busy', 'true');
        result = await data.getResult(classId, uid);
        seen.set(uid, classId);
        dispatchEvent(new CustomEvent('lw:seen'));
        showResult(animate);
      } catch (err) {
        toast(friendlyError(err, 'Couldn’t load your result. Try again.'), 'error');
        btn?.removeAttribute('aria-busy');
      } finally {
        busy = false;
      }
    }

    function showResult(animate) {
      const kind = result.kind;
      const mark = revealMark(animate ? 'sealed' : kind === 'match' ? 'match' : kind === 'nomatch' ? 'miss' : 'none');
      const target = result.target ? members.find((x) => x.uid === result.target) : null;
      let title;
      let sub;
      let extra = null;
      if (kind === 'match') {
        title = h('h2', { class: 'rv-title is-match' }, 'It’s mutual.');
        sub = h('p', { class: 'rv-sub' }, `You and ${target ? firstName(target.displayName) : 'your crush'} picked each other. You both see this right now.`);
        extra = target ? h('div', { class: 'rv-who' }, avatar(target.displayName, target.tone), h('b', {}, target.displayName)) : null;
      } else if (kind === 'nomatch') {
        title = h('h2', { class: 'rv-title' }, 'No mutual match this round.');
        sub = h('p', { class: 'rv-sub' }, 'Your pick stays sealed forever. Nobody will ever know who you chose.');
      } else {
        title = h('h2', { class: 'rv-title' }, 'You didn’t pick anyone.');
        sub = h('p', { class: 'rv-sub' }, 'No pick, no match. Maybe next round.');
      }
      const again = h('a', { class: 'btn btn-ghost', href: '#/' }, 'Back to classes');
      clear(stage).append(h('div', { class: `stack ${animate ? 'rv-enter' : ''}`, style: { justifyItems: 'center', '--gap': '18px' } },
        mark, title, sub, extra, again,
      ));
      if (animate) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          mark.classList.remove('is-sealed');
          mark.classList.add(kind === 'match' ? 'is-match' : kind === 'nomatch' ? 'is-miss' : 'is-none');
        }));
        if (kind === 'match') {
          setTimeout(() => {
            const r = mark.getBoundingClientRect();
            burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 170 });
          }, 700);
        }
      }
    }

    if (seen.has(uid, classId)) {
      clear(stage).append(revealMark('sealed'), h('span', { class: 'spinner' }));
      reveal(null, { animate: false });
    } else {
      showSealed();
    }
    wipeText(data.serverNow());
    return {
      tick: (now) => wipeText(now),
      // Only redraw if the match's name wasn't loaded yet (never interrupt the animation).
      update: () => {
        if (result?.kind === 'match' && !stage.querySelector('.rv-who') && members.some((x) => x.uid === result.target)) showResult(false);
      },
    };
  }

  // ------------------------------------------------------------------
  // Report a problem
  // ------------------------------------------------------------------
  function reportLink() {
    const btn = h('button', { class: 'link small muted', type: 'button', style: { display: 'inline-flex', gap: '8px', alignItems: 'center' } }, icon('flag'), 'Report a problem');
    btn.addEventListener('click', openReport);
    return h('div', { style: { textAlign: 'center' } }, btn);
  }

  function openReport() {
    const reason = h('select', { class: 'select', id: 'rp-reason' },
      h('option', { value: 'inappropriate-name' }, 'Inappropriate name'),
      h('option', { value: 'impersonation' }, 'Someone is pretending to be someone else'),
      h('option', { value: 'harassment' }, 'Bullying or harassment'),
      h('option', { value: 'spam' }, 'Spam or fake account'),
      h('option', { value: 'other' }, 'Something else'),
    );
    const who = h('select', { class: 'select', id: 'rp-who' },
      h('option', { value: '' }, 'The class itself'),
      members.filter((m) => m.uid !== uid).map((m) => h('option', { value: m.uid }, m.displayName)),
    );
    const details = h('textarea', { class: 'textarea', id: 'rp-details', maxlength: '500', placeholder: 'What happened? (optional)' });
    const send = h('button', { class: 'btn', type: 'button' }, 'Send report');
    const cancel = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Cancel');
    const m = modal({
      title: 'Report a problem',
      body: h('div', { class: 'stack' },
        h('p', { class: 'muted small' }, 'Reports go privately to the Likewise moderators. The person you report won’t see who sent it.'),
        h('div', { class: 'field' }, h('label', { for: 'rp-reason' }, 'What’s wrong?'), reason),
        h('div', { class: 'field' }, h('label', { for: 'rp-who' }, 'Who is it about?'), who),
        h('div', { class: 'field' }, h('label', { for: 'rp-details' }, 'Details'), details),
      ),
      actions: [cancel, send],
    });
    cancel.addEventListener('click', () => m.close());
    send.addEventListener('click', () => withBusy(send, async () => {
      const target = members.find((x) => x.uid === who.value);
      try {
        await data.submitReport({
          uid, classId, className: cls?.name || membership()?.className,
          targetUid: target?.uid, targetName: target?.displayName,
          reason: reason.value, details: details.value.trim().slice(0, 500),
        });
        m.close();
        toast('Thanks. The moderators will take a look.', 'ok');
      } catch (err) { toast(friendlyError(err), 'error'); }
    }));
  }

  update();
  return root;
}
