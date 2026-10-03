// Landing page interactions.
import { initMotion, scrub, onFrame, pointer, reduceMotion, finePointer, scrollState } from './motion.js';
import { normalizeCode, isValidCode } from './validate.js';
import { firebaseConfig, settings, sdk } from './config.js';
import { frameGuard } from './ui.js';
import { burst } from './confetti.js';

if (!frameGuard()) start();

function start() {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  initMotion({ cursor: true, hideNativeCursor: true });

  // ------------------------------------------------------------------
  // Signed-in hint (set by the app). Just a UI nicety, not security.
  // ------------------------------------------------------------------
  let signedIn = false;
  try { signedIn = localStorage.getItem('lw:signedIn') === '1'; } catch { /* storage blocked */ }
  if (signedIn) {
    $$('[data-auth-link]').forEach((a) => a.remove());
    $$('[data-start-link]').forEach((a) => { a.href = 'app.html'; a.textContent = 'Open app'; });
    $$('[data-host-link]').forEach((a) => { a.href = 'app.html#/new'; });
    $$('[data-join-link]').forEach((a) => { a.href = 'app.html#/join'; });
  }

  // ------------------------------------------------------------------
  // Mobile menu
  // ------------------------------------------------------------------
  const toggle = $('[data-menu-toggle]');
  const menu = $('[data-menu]');
  const nav = $('[data-nav]');
  function setMenu(open) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.classList.toggle('is-open', open);
    nav.classList.toggle('menu-open', open);
    menu.setAttribute('aria-hidden', String(!open));
    if (open) menu.removeAttribute('inert'); else menu.setAttribute('inert', '');
    document.body.style.overflow = open ? 'hidden' : '';
  }
  toggle?.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  $$('[data-menu-link]').forEach((a) => a.addEventListener('click', () => setMenu(false)));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
  matchMedia('(min-width: 901px)').addEventListener('change', (e) => { if (e.matches) setMenu(false); });

  // ------------------------------------------------------------------
  // Hero: brackets spring together, follow the pointer, part on scroll
  // ------------------------------------------------------------------
  const hero = $('[data-hero]');
  const stage = $('[data-ha-stage]');
  const red = $('[data-ha-red]');
  const ink = $('[data-ha-ink]');
  const glow = $('.hero-glow');
  const chips = $$('.ha-chip').map((el) => ({ el, depth: parseFloat(getComputedStyle(el).getPropertyValue('--depth')) || 1 }));

  let sep = reduceMotion ? 0 : 170;
  let vel = 0;
  let locked = reduceMotion;
  let unit = stage.offsetWidth / 540;
  addEventListener('resize', () => { unit = stage.offsetWidth / 540; });
  setTimeout(() => stage.classList.add('is-ready'), 120);

  onFrame(() => {
    const y = scrollState.y;
    const h = hero.offsetHeight;
    if (y > h * 1.1) return;
    const target = clamp(y / (h * 0.85)) * 110;
    if (reduceMotion) sep = target;
    else {
      vel = vel * 0.8 + (target - sep) * 0.065;
      sep += vel;
    }
    if (!locked && Math.abs(sep) < 1.5 && Math.abs(vel) < 0.6) {
      locked = true;
      stage.classList.add('is-locked');
    }
    const s = sep * unit;
    const px = pointer.sx * 16 * unit;
    const py = pointer.sy * 16 * unit;
    const rot = pointer.sx * 2.5;
    red.style.transform = `translate3d(${(s + px).toFixed(2)}px, ${(-s + py).toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg)`;
    ink.style.transform = `translate3d(${(-s - px).toFixed(2)}px, ${(s - py).toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg)`;
    if (finePointer && !reduceMotion) {
      for (const c of chips) {
        c.el.style.translate = `${(pointer.sx * 22 * c.depth).toFixed(1)}px ${(pointer.sy * 22 * c.depth - y * 0.08 * c.depth).toFixed(1)}px`;
      }
      glow.style.transform = `translate3d(${pointer.scx.toFixed(1)}px, ${(pointer.scy + y).toFixed(1)}px, 0)`;
    }
  });

  // Notification card that cycles through the story
  const toastEl = $('[data-ha-toast]');
  const toastTitle = $('[data-ha-toast-title]');
  const toastText = $('[data-ha-toast-text]');
  const stories = [
    ['It’s mutual.', 'You & Sam picked each other.'],
    ['Locked in.', 'Only you can see your pick.'],
    ['Results drop Friday.', 'The host can’t move the date.'],
    ['No mutual match.', 'And nobody will ever know.'],
  ];
  let storyIndex = 0;
  if (!reduceMotion) {
    setInterval(() => {
      if (document.hidden || scrollState.y > hero.offsetHeight) return;
      toastEl.classList.add('is-swapping');
      setTimeout(() => {
        storyIndex = (storyIndex + 1) % stories.length;
        [toastTitle.textContent, toastText.textContent] = stories[storyIndex];
        toastEl.classList.remove('is-swapping');
      }, 450);
    }, 3800);
  }

  // Join-by-code form
  const form = $('[data-code-form]');
  const codeInput = $('#hero-code');
  codeInput.addEventListener('input', () => {
    const pos = codeInput.selectionStart;
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    codeInput.setSelectionRange(pos, pos);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = normalizeCode(codeInput.value);
    if (!isValidCode(code)) {
      form.classList.remove('is-shake');
      void form.offsetWidth;
      form.classList.add('is-shake');
      codeInput.focus();
      codeInput.placeholder = '6 LETTERS';
      return;
    }
    location.href = `app.html#/join/${code}`;
  });

  // ------------------------------------------------------------------
  // Marquee: speed and skew react to scroll velocity
  // ------------------------------------------------------------------
  const rows = $$('[data-mq]').map((row) => ({ row, track: $('.mq-track', row), dir: Number(row.dataset.mq), x: 0, w: 0 }));
  const measure = () => rows.forEach((r) => { r.w = r.track.scrollWidth / 2; });
  measure();
  addEventListener('resize', measure);
  document.fonts?.ready.then(measure);
  let mqVisible = false;
  new IntersectionObserver(([e]) => { mqVisible = e.isIntersecting; }).observe($('.marquee'));
  if (!reduceMotion) {
    onFrame(() => {
      if (!mqVisible) return;
      const v = scrollState.velocity;
      const speed = 0.7 + Math.min(14, Math.abs(v) * 0.35);
      const skew = clamp(-v * 0.25, -8, 8);
      for (const r of rows) {
        r.x -= speed * r.dir * (v < -0.5 ? -1 : 1);
        if (r.x <= -r.w) r.x += r.w;
        if (r.x > 0) r.x -= r.w;
        r.track.style.transform = `translate3d(${r.x.toFixed(1)}px, 0, 0) skewX(${skew.toFixed(2)}deg)`;
      }
    });
  }

  // ------------------------------------------------------------------
  // Manifesto: words light up as you read
  // ------------------------------------------------------------------
  const manifesto = $('[data-words]');
  const words = [];
  (function wrap(node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        for (const part of child.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.append(' '); continue; }
          const span = document.createElement('span');
          span.className = 'mw';
          span.textContent = part;
          if (node.classList?.contains('red')) span.classList.add('is-red');
          words.push(span);
          frag.append(span);
        }
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE) wrap(child);
    }
  })(manifesto);
  if (reduceMotion) words.forEach((w) => w.classList.add('is-lit'));
  else {
    scrub(manifesto, (_p, r) => {
      const vh = innerHeight;
      const t = clamp((vh * 0.82 - r.top) / (r.height + vh * 0.2));
      const lit = Math.round(t * words.length);
      words.forEach((w, i) => w.classList.toggle('is-lit', i < lit));
    });
  }

  // ------------------------------------------------------------------
  // How it works: sticky phone follows the steps
  // ------------------------------------------------------------------
  const phone = $('[data-phone]');
  const steps = $$('.how-step');
  const stepIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const n = e.target.dataset.step;
      phone.dataset.step = n;
      steps.forEach((s) => s.classList.toggle('is-active', s === e.target));
    }
  }, { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((s) => stepIO.observe(s));
  steps[0].classList.add('is-active');

  // Mobile: clone each phone screen into its step
  $$('[data-mini]').forEach((mini) => {
    const screen = $(`.ps[data-ps="${mini.dataset.mini}"]`, phone).cloneNode(true);
    mini.append(screen);
  });
  const miniIO = new IntersectionObserver((entries) => {
    for (const e of entries) e.target.firstElementChild?.classList.toggle('is-on', e.isIntersecting);
  }, { threshold: 0.5 });
  $$('[data-mini]').forEach((m) => miniIO.observe(m));

  if (finePointer && !reduceMotion) {
    onFrame(() => {
      phone.style.transform = `perspective(1400px) rotateY(${(pointer.sx * -7).toFixed(2)}deg) rotateX(${(pointer.sy * 5).toFixed(2)}deg)`;
    });
  }

  // ------------------------------------------------------------------
  // Demo: mutual or nothing
  // ------------------------------------------------------------------
  const demo = $('[data-demo]');
  const mark = $('[data-demo-mark]');
  const resultEl = $('[data-demo-result]');
  const subEl = $('[data-demo-sub]');
  const revealBtn = $('[data-demo-reveal]');
  const picks = { you: null, sam: null };

  $$('.demo-choices', demo).forEach((group) => {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.demo-choice');
      if (!btn) return;
      const side = group.dataset.side;
      picks[side] = btn.dataset.pick;
      $$('.demo-choice', group).forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-selected', on);
        b.setAttribute('aria-checked', String(on));
      });
      mark.classList.remove('is-match', 'is-miss');
      resultEl.classList.remove('is-match');
      const ready = picks.you && picks.sam;
      revealBtn.disabled = !ready;
      resultEl.textContent = ready ? 'Ready.' : 'Make both picks.';
      subEl.textContent = ready ? 'Hit reveal to see what each of you would see.' : ' ';
    });
  });

  revealBtn.addEventListener('click', () => {
    const youPickedSam = picks.you === 'sam';
    const samPickedYou = picks.sam === 'you';
    mark.classList.remove('is-match', 'is-miss');
    void mark.offsetWidth;
    if (youPickedSam && samPickedYou) {
      mark.classList.add('is-match');
      resultEl.classList.add('is-match');
      resultEl.textContent = 'It’s mutual.';
      subEl.textContent = 'You both picked each other, so you both see this on reveal day.';
      setTimeout(() => {
        const r = mark.getBoundingClientRect();
        burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 120 });
      }, 650);
    } else {
      mark.classList.add('is-miss');
      resultEl.classList.remove('is-match');
      resultEl.textContent = 'No mutual match this round.';
      subEl.textContent = youPickedSam
        ? 'Sam will never find out you picked them.'
        : samPickedYou
          ? 'And you’ll never know Sam picked you. That’s the deal.'
          : 'Nobody finds out who picked who.';
    }
  });

  // ------------------------------------------------------------------
  // Terminal: a "curious classmate" gets denied
  // ------------------------------------------------------------------
  const termBody = $('[data-term-body]');
  const lines = [
    ['t-note', '// a curious classmate opens DevTools…'],
    ['t-in', 'await getDoc(doc(db, "classes/p3chem/picks/sam"))'],
    ['t-err', 'FirebaseError: Missing or insufficient permissions.'],
    ['t-in', 'await getDocs(collection(db, "classes/p3chem/picks"))'],
    ['t-err', 'FirebaseError: Missing or insufficient permissions.'],
    ['t-in', 'await updateDoc(doc(db, "classes/p3chem"), { revealAt: now })'],
    ['t-err', 'FirebaseError: Missing or insufficient permissions.'],
    ['t-note', '// nice try. picks only unlock when it’s mutual.'],
  ];
  function renderTerminalInstant() {
    termBody.textContent = '';
    for (const [cls, text] of lines) {
      const line = document.createElement('div');
      line.className = cls;
      line.textContent = text;
      termBody.append(line);
    }
  }
  if (reduceMotion) renderTerminalInstant();
  else {
    let started = false;
    new IntersectionObserver(async ([e], obs) => {
      if (!e.isIntersecting || started) return;
      started = true;
      obs.disconnect();
      const caret = document.createElement('span');
      caret.className = 'term-caret';
      for (const [cls, text] of lines) {
        const line = document.createElement('div');
        line.className = cls;
        termBody.append(line);
        if (cls === 't-in') {
          for (let i = 1; i <= text.length; i++) {
            line.textContent = text.slice(0, i);
            line.append(caret);
            await wait(14 + Math.random() * 22);
          }
          await wait(380);
        } else {
          line.textContent = text;
          line.append(caret);
          await wait(cls === 't-err' ? 520 : 420);
        }
      }
    }, { threshold: 0.4 }).observe(termBody);
  }

  // ------------------------------------------------------------------
  // FAQ accordion
  // ------------------------------------------------------------------
  $$('.faq-q').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const open = !item.classList.contains('is-open');
      item.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
  });

  // ------------------------------------------------------------------
  // CTA: brackets assemble as you scroll in
  // ------------------------------------------------------------------
  const ctaMark = $('[data-cta-mark]');
  const ctaRed = $('.ha-red', ctaMark);
  const ctaInk = $('.ha-ink', ctaMark);
  ctaRed.style.opacity = ctaInk.style.opacity = '1';
  scrub(ctaMark, (_p, r) => {
    const vh = innerHeight;
    const t = reduceMotion ? 1 : ease(clamp((vh * 0.95 - r.top) / (vh * 0.65)));
    const d = (1 - t) * r.width * 0.42;
    const rot = (1 - t) * 18;
    ctaRed.style.transform = `translate3d(${d}px, ${-d}px, 0) rotate(${rot}deg)`;
    ctaInk.style.transform = `translate3d(${-d}px, ${d}px, 0) rotate(${rot}deg)`;
    ctaMark.classList.toggle('is-locked', t > 0.995);
  });

  // ------------------------------------------------------------------
  // Footer year + analytics (lazy, never on localhost)
  // ------------------------------------------------------------------
  $$('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (settings.analytics && !local) {
    const go = async () => {
      try {
        const [{ initializeApp }, { isSupported, getAnalytics }] = await Promise.all([import(sdk('app')), import(sdk('analytics'))]);
        if (await isSupported()) getAnalytics(initializeApp(firebaseConfig));
      } catch { /* blocked */ }
    };
    ('requestIdleCallback' in window) ? requestIdleCallback(go, { timeout: 5000 }) : setTimeout(go, 3000);
  }
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
