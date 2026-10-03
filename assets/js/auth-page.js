// Sign in / create account / forgot password.
import { frameGuard, $, $$, toast, withBusy, fieldError, friendlyError, safeNext } from './ui.js';
import { initMotion } from './motion.js';
import { validateDisplayName, validateEmail, passwordCheck } from './validate.js';
import { sendWithContinue, sendVerification } from './email.js';

if (!frameGuard()) start();

async function start() {
  initMotion({ cursor: true });

  // Start loading Firebase now, but don't wait for it to draw the page.
  const firebaseReady = import('./firebase.js');

  // Never let a form submit natively (that would put the password in the URL).
  document.querySelectorAll('form').forEach((f) => f.addEventListener('submit', (e) => e.preventDefault()));

  const params = new URLSearchParams(location.search);
  const next = safeNext(params.get('next'));
  let busy = false; // suppress auto-redirect while we're mid sign-up

  // ------------------------------------------------------------------
  // View switching
  // ------------------------------------------------------------------
  const tabs = $('[data-tabs]');
  const ink = $('[data-tab-ink]');
  const forms = Object.fromEntries($$('[data-form]').map((f) => [f.dataset.form, f]));

  let current = 'signin';
  function positionInk() {
    const tabMode = current === 'signup' ? 'signup' : 'signin';
    const active = $(`[data-tab="${tabMode}"]`, tabs);
    ink.style.width = `${active.offsetWidth}px`;
    ink.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  function show(mode, { push = true } = {}) {
    if (!forms[mode]) mode = 'signin';
    current = mode;
    for (const [name, el] of Object.entries(forms)) el.hidden = name !== mode;
    const tabMode = mode === 'signup' ? 'signup' : 'signin';
    tabs.hidden = mode === 'forgot' || mode === 'sent';
    $$('[data-tab]', tabs).forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tabMode)));
    requestAnimationFrame(positionInk);
    const card = $('[data-auth-card]');
    card.classList.remove('is-switching');
    void card.offsetWidth;
    card.classList.add('is-switching');
    document.title = { signin: 'Sign in', signup: 'Create account', forgot: 'Reset password', sent: 'Check your inbox' }[mode] + ' · Likewise';
    if (push && mode !== 'sent') {
      const url = new URL(location.href);
      url.searchParams.set('mode', mode);
      history.replaceState(null, '', url);
    }
    const first = forms[mode].querySelector('input');
    if (first && matchMedia('(pointer: fine)').matches) setTimeout(() => first.focus(), 60);
  }

  $$('[data-tab]').forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const target = $('[aria-selected="false"]', tabs);
    target.focus();
    show(target.dataset.tab);
  });
  show(params.get('mode') || 'signin', { push: false });
  addEventListener('resize', positionInk);

  // Show/hide password
  $$('[data-show-pw]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.getAttribute('aria-controls'));
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? 'Show' : 'Hide';
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  });

  let fb;
  try {
    fb = await firebaseReady;
  } catch (err) {
    // Firebase couldn't load (offline, or a blocker stopping www.gstatic.com).
    console.error(err);
    const msg = 'Can’t connect to Likewise right now. Check your internet, and if you use an ad or script blocker, allow www.gstatic.com for this site. Then reload.';
    $$('[data-form-error]').forEach((el) => { el.textContent = msg; el.hidden = false; });
    $$('form button[type="submit"]').forEach((b) => { b.disabled = true; });
    return;
  }
  const { auth, authMod, db, fsMod } = fb;
  const {
    onAuthStateChanged, setPersistence, browserLocalPersistence, browserSessionPersistence,
    signInWithEmailAndPassword, createUserWithEmailAndPassword,
    sendPasswordResetEmail, updateProfile, validatePassword,
  } = authMod;
  auth.useDeviceLanguage();

  // Already signed in? Go straight to the app.
  onAuthStateChanged(auth, (user) => {
    if (user && !busy) location.replace(next);
  });

  function formError(form, message) {
    const el = $('[data-form-error]', form);
    el.hidden = !message;
    el.textContent = message || '';
  }

  // ------------------------------------------------------------------
  // Sign in
  // ------------------------------------------------------------------
  forms.signin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = forms.signin;
    formError(f, '');
    const { email, error } = validateEmail(f.email.value);
    fieldError(f.email, error);
    fieldError(f.password, f.password.value ? null : 'Enter your password.');
    if (error || !f.password.value) return;
    await withBusy($('button[type="submit"]', f), async () => {
      try {
        await setPersistence(auth, f.remember.checked ? browserLocalPersistence : browserSessionPersistence);
        await signInWithEmailAndPassword(auth, email, f.password.value);
        try { localStorage.setItem('lw:signedIn', '1'); } catch { /* ignore */ }
        location.replace(next);
      } catch (err) {
        formError(f, friendlyError(err));
        f.password.select();
      }
    });
  });

  // ------------------------------------------------------------------
  // Sign up
  // ------------------------------------------------------------------
  const pwInput = forms.signup.password;
  const meter = $('[data-pw-meter]');
  const pwLabel = $('[data-pw-label]');
  pwInput.addEventListener('input', () => {
    const r = passwordCheck(pwInput.value, { email: forms.signup.email.value, name: forms.signup.name.value });
    meter.dataset.score = pwInput.value ? String(Math.max(1, r.score)) : '0';
    pwLabel.textContent = pwInput.value
      ? (r.common ? 'Too easy to guess. Avoid common passwords and your name or email.' : `Strength: ${r.label}`)
      : 'At least 8 characters, with a letter and a number.';
    for (const [k, ok] of Object.entries(r.checks)) $(`[data-check="${k}"]`).classList.toggle('is-ok', ok);
  });

  forms.signup.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = forms.signup;
    formError(f, '');
    const nameR = validateDisplayName(f.name.value);
    const emailR = validateEmail(f.email.value);
    const pwR = passwordCheck(f.password.value, { email: emailR.email, name: nameR.name });
    fieldError(f.name, nameR.error);
    fieldError(f.email, emailR.error);
    fieldError(f.password, pwR.ok ? null : pwR.common ? 'That password is too easy to guess.' : 'Use 8+ characters with at least one letter and one number.');
    if (!f.terms.checked) formError(f, 'Please confirm you’re 13 or older and agree to the Terms.');
    if (nameR.error || emailR.error || !pwR.ok || !f.terms.checked) {
      $('[aria-invalid="true"]', f)?.focus();
      return;
    }
    f.name.value = nameR.name;

    await withBusy($('button[type="submit"]', f), async () => {
      busy = true;
      try {
        // Respect the project's server-side password policy if one is set.
        try {
          const status = await validatePassword(auth, f.password.value);
          if (!status.isValid) {
            fieldError(f.password, 'That password doesn’t meet this site’s requirements. Try a longer one with a mix of characters.');
            busy = false;
            return;
          }
        } catch { /* no policy configured / emulator: fine */ }

        await setPersistence(auth, browserLocalPersistence);
        const { user } = await createUserWithEmailAndPassword(auth, emailR.email, f.password.value);
        try {
          await fsMod.setDoc(fsMod.doc(db, 'users', user.uid), {
            displayName: nameR.name,
            createdAt: fsMod.serverTimestamp(),
          });
        } catch (err) {
          console.warn('Profile will be completed in the app', err);
        }
        updateProfile(user, { displayName: nameR.name }).catch(() => {});
        // The next screen shows whether this worked (and why not), with a resend button.
        await sendVerification(authMod, user).catch(() => {});
        try { localStorage.setItem('lw:signedIn', '1'); } catch { /* ignore */ }
        location.replace(next);
      } catch (err) {
        busy = false;
        if (err.code === 'auth/email-already-in-use') fieldError(f.email, friendlyError(err));
        else if (err.code === 'auth/weak-password' || err.code === 'auth/password-does-not-meet-requirements') fieldError(f.password, friendlyError(err));
        else formError(f, friendlyError(err));
      }
    });
  });

  // ------------------------------------------------------------------
  // Forgot password
  // ------------------------------------------------------------------
  let lastEmail = '';
  let cooldownTimer;
  const resendBtn = $('[data-resend]');

  async function sendReset(email) {
    try {
      await sendWithContinue((s) => sendPasswordResetEmail(auth, email, s), 'auth.html?mode=signin');
    } catch (err) {
      // With email-enumeration protection Firebase doesn't reveal if the account
      // exists. We show the same screen either way, except for real errors.
      if (!['auth/user-not-found', 'auth/invalid-email'].includes(err.code)) throw err;
    }
  }

  function startCooldown(seconds = 60) {
    clearInterval(cooldownTimer);
    let left = seconds;
    resendBtn.disabled = true;
    resendBtn.textContent = `Resend in ${left}s`;
    cooldownTimer = setInterval(() => {
      left--;
      if (left <= 0) {
        clearInterval(cooldownTimer);
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend';
      } else resendBtn.textContent = `Resend in ${left}s`;
    }, 1000);
  }

  forms.forgot.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = forms.forgot;
    formError(f, '');
    const { email, error } = validateEmail(f.email.value);
    fieldError(f.email, error);
    if (error) return;
    await withBusy($('button[type="submit"]', f), async () => {
      try {
        await sendReset(email);
        lastEmail = email;
        $('[data-sent-email]').textContent = email;
        show('sent');
        forms.sent.focus();
        startCooldown();
      } catch (err) {
        formError(f, friendlyError(err));
      }
    });
  });

  resendBtn.addEventListener('click', () => withBusy(resendBtn, async () => {
    try {
      await sendReset(lastEmail);
      toast('Sent again. Check your inbox and spam folder.', 'ok');
      startCooldown(90);
    } catch (err) {
      toast(friendlyError(err), 'error');
    }
  }));

  // Prefill email between forms
  const emails = [forms.signin.email, forms.signup.email, forms.forgot.email];
  emails.forEach((input) => input.addEventListener('change', () => {
    emails.forEach((other) => { if (other !== input && !other.value) other.value = input.value; });
  }));
}
