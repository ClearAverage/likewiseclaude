// The Likewise app shell: auth gate → verify gate → profile gate → router.
import { frameGuard, $, $$, h, clear, toast, avatar, friendlyError } from './ui.js';
import { initMotion, refreshMotion } from './motion.js';

if (!frameGuard()) boot();

async function boot() {
  initMotion({ cursor: true });
  const viewRoot = $('[data-view]');

  let fb;
  let data;
  let views;
  try {
    fb = await import('./firebase.js');
    data = await import('./db.js');
    views = await import('./views/index.js');
  } catch (err) {
    console.error(err);
    clear(viewRoot).append(h('div', { class: 'gate' }, h('div', { class: 'gate-card' },
      h('h1', { class: 'display display-s' }, 'Couldn’t load Likewise.'),
      h('p', { class: 'muted' }, 'Check your internet connection. If you use an ad or script blocker, allow www.gstatic.com for this site.'),
      h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Try again'),
    )));
    return;
  }
  const { auth, authMod, usingEmulators } = fb;

  if (usingEmulators) document.body.append(h('div', { class: 'emu-badge' }, 'Local emulators'));

  const session = { user: null, profile: null, memberships: [] };
  let unsubMemberships = null;
  let routerOn = false;
  let renderId = 0;
  let cleanups = [];

  // ------------------------------------------------------------------
  // Chrome (header + tab bar)
  // ------------------------------------------------------------------
  function showChrome(on) {
    $$('[data-chrome]').forEach((el) => { el.hidden = !on; });
    document.body.classList.toggle('has-tabbar', on);
  }

  function refreshUser() {
    if (!session.profile) return;
    $('[data-user-name]').textContent = session.profile.displayName;
    const fresh = avatar(session.profile.displayName, 0);
    fresh.setAttribute('data-user-avatar', '');
    $('[data-user-avatar]').replaceWith(fresh);
  }

  function setActiveTab(tab) {
    $$('[data-tab]').forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const ink = $('[data-tab-ink]');
    const active = $(`.app-tabs [data-tab="${tab}"]`);
    if (ink && active) {
      ink.style.width = `${active.offsetWidth}px`;
      ink.style.transform = `translateX(${active.offsetLeft}px)`;
      ink.style.opacity = '1';
    } else if (ink) ink.style.opacity = '0';
  }

  function updateResultsDot() {
    const now = data.serverNow();
    const uid = session.user?.uid;
    const anyNew = session.memberships.some((m) =>
      now >= data.toMillis(m.revealAt) + data.REVEAL_GRACE_MS && now < data.toMillis(m.expireAt) &&
      !localStorageSafe(`lw:seen:${uid}:${m.id}`));
    $$('[data-results-dot]').forEach((d) => { d.hidden = !anyNew; });
  }
  addEventListener('lw:seen', updateResultsDot);
  setInterval(() => session.user && updateResultsDot(), 15000);

  function localStorageSafe(key) {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
  }

  // ------------------------------------------------------------------
  // Router
  // ------------------------------------------------------------------
  const ROUTES = [
    { re: /^\/?$/, view: views.dashboard, tab: 'classes', title: 'Your classes' },
    { re: /^\/new\/?$/, view: views.createView, tab: 'classes', title: 'Host a class' },
    { re: /^\/join(?:\/([A-Za-z0-9]{0,12}))?\/?$/, view: views.joinView, tab: 'classes', title: 'Join a class' },
    { re: /^\/c\/([A-Za-z0-9_-]{1,64})\/screen\/?$/, view: views.screenView, tab: 'classes', title: 'Big screen' },
    { re: /^\/c\/([A-Za-z0-9_-]{1,64})\/?$/, view: views.classView, tab: 'classes', title: 'Class' },
    { re: /^\/results\/?$/, view: views.resultsView, tab: 'results', title: 'Results' },
    { re: /^\/account\/?$/, view: views.accountView, tab: 'account', title: 'Account' },
  ];

  function runCleanups() {
    const list = cleanups;
    cleanups = [];
    for (const fn of list) { try { fn(); } catch { /* ignore */ } }
  }

  function makeCtx(id) {
    return {
      session, data, fb,
      navigate: (hash) => { if (location.hash === hash) route(); else location.hash = hash; },
      onCleanup: (fn) => { if (id === renderId) cleanups.push(fn); else fn(); },
      refreshUser,
      stopListening: () => { unsubMemberships?.(); unsubMemberships = null; runCleanups(); },
    };
  }

  async function route() {
    const id = ++renderId;
    runCleanups();
    const path = decodeURIComponent((location.hash || '#/').slice(1)) || '/';
    let match = null;
    for (const r of ROUTES) {
      const m = path.match(r.re);
      if (m) { match = { r, params: m.slice(1) }; break; }
    }
    if (!match) { location.replace('#/'); return; }
    setActiveTab(match.r.tab);
    document.title = `${match.r.title} · Likewise`;
    const ctx = makeCtx(id);
    let node;
    try {
      node = await match.r.view(ctx, ...match.params);
    } catch (err) {
      console.error(err);
      node = h('div', { class: 'gate view' }, h('div', { class: 'gate-card' },
        h('h1', { class: 'display display-s' }, 'Something went wrong.'),
        h('p', { class: 'muted' }, friendlyError(err)),
        h('a', { class: 'btn', href: '#/' }, 'Back to classes'),
      ));
    }
    if (id !== renderId) return; // user navigated away mid-load
    clear(viewRoot).append(node);
    refreshMotion(viewRoot);
    window.scrollTo({ top: 0, behavior: 'instant' });
    $('#main').focus({ preventScroll: true });
  }

  function showGate(build) {
    runCleanups();
    const id = ++renderId;
    showChrome(false);
    const node = build(makeCtx(id));
    clear(viewRoot).append(node);
    refreshMotion(viewRoot);
  }

  // ------------------------------------------------------------------
  // Auth flow
  // ------------------------------------------------------------------
  async function enter(user) {
    session.user = user;
    try { localStorage.setItem('lw:signedIn', '1'); } catch { /* ignore */ }

    if (!user.emailVerified) {
      document.title = 'Verify your email · Likewise';
      showGate((ctx) => views.verifyGate(ctx, { onVerified: () => enter(auth.currentUser) }));
      return;
    }
    // Make sure the ID token the rules see says email_verified = true.
    try {
      const tok = await user.getIdTokenResult();
      if (!tok.claims.email_verified) await user.getIdToken(true);
    } catch { /* offline */ }
    await data.syncClock();

    try {
      session.profile = await data.getProfile(user.uid);
    } catch (err) {
      toast(err.code === 'permission-denied'
        ? 'The database refused to load your profile. Site owner: publish the Firestore security rules (Setup guide, Step 2).'
        : friendlyError(err), 'error', 9000);
    }
    if (!session.profile) {
      document.title = 'Your name · Likewise';
      showGate((ctx) => views.profileGate(ctx, {
        onDone: (profile) => { session.profile = profile; enter(user); },
      }));
      return;
    }
    startApp();
  }

  function startApp() {
    showChrome(true);
    refreshUser();
    if (!unsubMemberships) {
      let first = true;
      unsubMemberships = data.watchMemberships(session.user.uid, (list) => {
        session.memberships = list;
        updateResultsDot();
        if (first) { first = false; startRouter(); } else dispatchEvent(new CustomEvent('lw:memberships'));
      }, (err) => {
        console.warn('memberships', err);
        if (!routerOn) startRouter();
      });
    } else startRouter();
  }

  function startRouter() {
    if (!routerOn) {
      routerOn = true;
      addEventListener('hashchange', route);
      addEventListener('resize', () => setActiveTab($('[aria-current="page"]')?.dataset.tab));
    }
    route();
  }

  authMod.onAuthStateChanged(auth, (user) => {
    if (!user) {
      try { localStorage.removeItem('lw:signedIn'); } catch { /* ignore */ }
      unsubMemberships?.();
      runCleanups();
      const next = `app.html${location.hash || ''}`;
      location.replace(`auth.html?next=${encodeURIComponent(next)}`);
      return;
    }
    if (session.user?.uid === user.uid && session.profile) return; // token refresh etc.
    enter(user);
  });
}
