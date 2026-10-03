// Custom handler for Firebase email links: verify email, reset password,
// recover email. Set it as the "Action URL" in Firebase (setup doc).
import { firebaseConfig, settings, sdk, wantsEmulators } from './config.js';
import { frameGuard, $, h, clear, withBusy, fieldError, friendlyError, icon } from './ui.js';
import { initMotion } from './motion.js';
import { passwordCheck } from './validate.js';
import { burst } from './confetti.js';

if (!frameGuard()) start();

async function start() {
  initMotion({ cursor: true });
  const card = $('[data-action]');

  // Read the one-time code, then scrub it from the address bar & history.
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode');
  const oobCode = params.get('oobCode');
  const lang = params.get('lang');
  const emulators = wantsEmulators(); // decide before the URL is scrubbed
  history.replaceState(null, '', `${location.pathname}?mode=${encodeURIComponent(mode || '')}`);

  const [{ initializeApp }, authMod] = await Promise.all([import(sdk('app')), import(sdk('auth'))]);
  const app = initializeApp(firebaseConfig);
  const auth = authMod.initializeAuth(app, { persistence: [authMod.indexedDBLocalPersistence, authMod.browserLocalPersistence] });
  if (emulators) {
    authMod.connectAuthEmulator(auth, settings.emulators.auth, { disableWarnings: true });
  }
  if (lang) auth.languageCode = lang;

  const mark = (state) => h('div', { class: `rv-mark is-${state}`, 'aria-hidden': 'true' }, h('span', { class: 'rv-red' }), h('span', { class: 'rv-ink' }));

  function show({ state = 'match', title, text, actions = [], extra = null }) {
    const m = mark('sealed');
    clear(card).append(...[
      m,
      h('h1', { class: 'display display-s' }, title),
      text ? h('p', { class: 'muted' }, text) : null,
      extra,
      actions.length ? h('div', { class: 'row' }, actions) : null,
    ].filter(Boolean));
    requestAnimationFrame(() => requestAnimationFrame(() => { m.className = `rv-mark is-${state}`; }));
    return m;
  }

  function fail(err) {
    const expired = err?.code === 'auth/expired-action-code';
    show({
      state: 'miss',
      title: expired ? 'This link expired.' : 'This link doesn’t work.',
      text: expired
        ? 'Links only work for a limited time. Request a new one and use it right away.'
        : 'It may have already been used, or it was copied incompletely. Request a fresh one.',
      actions: [
        h('a', { class: 'btn', href: 'auth.html?mode=forgot' }, 'Get a new reset link'),
        h('a', { class: 'btn btn-ghost', href: 'app.html' }, 'Open Likewise'),
      ],
    });
  }

  if (!mode || !oobCode) { fail(); return; }

  try {
    if (mode === 'verifyEmail') {
      await authMod.applyActionCode(auth, oobCode);
      const m = show({
        title: 'Email verified.',
        text: 'You’re all set. Head back to Likewise. If it’s open in another tab, it will continue by itself.',
        actions: [h('a', { class: 'btn btn-red', href: 'app.html' }, 'Open Likewise', icon('arrow', 'icon arrow'))],
      });
      setTimeout(() => { const r = m.getBoundingClientRect(); burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 90 }); }, 900);
      return;
    }

    if (mode === 'verifyAndChangeEmail') {
      await authMod.applyActionCode(auth, oobCode);
      show({
        title: 'Email updated.',
        text: 'Your new email is confirmed. Sign in again using it.',
        actions: [h('a', { class: 'btn', href: 'auth.html?mode=signin' }, 'Sign in')],
      });
      return;
    }

    if (mode === 'recoverEmail') {
      const info = await authMod.checkActionCode(auth, oobCode);
      const restored = info?.data?.email;
      await authMod.applyActionCode(auth, oobCode);
      const resetBtn = h('button', { class: 'btn', type: 'button' }, 'Send me a password reset');
      resetBtn.addEventListener('click', () => withBusy(resetBtn, async () => {
        try {
          await authMod.sendPasswordResetEmail(auth, restored);
          resetBtn.textContent = 'Sent. Check your inbox';
          resetBtn.disabled = true;
        } catch (err) { resetBtn.textContent = friendlyError(err); }
      }));
      show({
        title: 'Email restored.',
        text: `Your sign-in email is back to ${restored}. If you didn’t ask for the change, reset your password now to keep your account safe.`,
        actions: [resetBtn, h('a', { class: 'btn btn-ghost', href: 'auth.html' }, 'Sign in')],
      });
      return;
    }

    if (mode === 'resetPassword') {
      const email = await authMod.verifyPasswordResetCode(auth, oobCode);
      renderReset(email);
      return;
    }

    fail();
  } catch (err) {
    console.warn(err.code);
    fail(err);
  }

  function renderReset(email) {
    const input = h('input', { class: 'input', id: 'np', type: 'password', autocomplete: 'new-password', required: true });
    const toggle = h('button', { class: 'suffix', type: 'button', 'aria-controls': 'np' }, 'Show');
    toggle.addEventListener('click', () => {
      const s = input.type === 'password';
      input.type = s ? 'text' : 'password';
      toggle.textContent = s ? 'Hide' : 'Show';
    });
    const meter = h('div', { class: 'pw-meter', 'data-score': '0', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
    const label = h('span', { class: 'hint' }, 'At least 8 characters, with a letter and a number.');
    input.addEventListener('input', () => {
      const r = passwordCheck(input.value, { email });
      meter.dataset.score = input.value ? String(Math.max(1, r.score)) : '0';
      label.textContent = input.value ? (r.common ? 'Too easy to guess.' : `Strength: ${r.label}`) : 'At least 8 characters, with a letter and a number.';
    });
    const submit = h('button', { class: 'btn btn-lg btn-block', type: 'submit' }, 'Save new password');
    const form = h('form', { class: 'stack', novalidate: true },
      h('div', { class: 'field' }, h('label', { for: 'np' }, 'New password'), h('div', { class: 'input-wrap' }, input, toggle), meter, label),
      submit,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const r = passwordCheck(input.value, { email });
      fieldError(input, r.ok ? null : 'Use 8+ characters with a letter and a number (and nothing too easy to guess).');
      if (!r.ok) return;
      withBusy(submit, async () => {
        try {
          await authMod.confirmPasswordReset(auth, oobCode, input.value);
          show({
            title: 'Password saved.',
            text: 'You can sign in with your new password now.',
            actions: [h('a', { class: 'btn btn-red', href: 'auth.html?mode=signin' }, 'Sign in', icon('arrow', 'icon arrow'))],
          });
        } catch (err) {
          if (['auth/expired-action-code', 'auth/invalid-action-code'].includes(err.code)) fail(err);
          else fieldError(input, friendlyError(err));
        }
      });
    });
    clear(card).append(
      mark('sealed'),
      h('p', { class: 'eyebrow' }, 'Reset password'),
      h('h1', { class: 'display display-s' }, 'Choose a new password.'),
      h('p', { class: 'muted' }, 'For ', h('b', { style: { color: 'var(--ink)' } }, email)),
      form,
    );
    setTimeout(() => input.focus(), 100);
  }
}
