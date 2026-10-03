// Screens shown before the app opens: verify your email, pick your name.
import { h, icon, toast, withBusy, fieldError, friendlyError } from '../ui.js';
import { validateDisplayName } from '../validate.js';
import { sendWithContinue } from '../config.js';

export function verifyGate(ctx, { onVerified }) {
  const { authMod, usingEmulators } = ctx.fb;
  const user = ctx.session.user;
  let cooldown = 0;
  let cooldownTimer;

  const resend = h('button', { class: 'btn btn-ghost btn-block', type: 'button' }, 'Resend email');
  const check = h('button', { class: 'btn btn-block btn-lg', type: 'button' }, 'I’ve verified, let me in');
  const signOut = h('button', { class: 'link small', type: 'button' }, 'Wrong email? Sign out');

  async function tryEnter({ quiet = false } = {}) {
    try {
      await user.reload();
      if (user.emailVerified) {
        await user.getIdToken(true); // refresh so the rules see email_verified = true
        stop();
        onVerified();
        return true;
      }
      if (!quiet) toast('Not verified yet. Tap the link in the email first.', 'error');
    } catch (err) {
      if (!quiet) toast(friendlyError(err), 'error');
    }
    return false;
  }

  function startCooldown(s) {
    cooldown = s;
    resend.disabled = true;
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      cooldown--;
      resend.textContent = cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email';
      if (cooldown <= 0) { clearInterval(cooldownTimer); resend.disabled = false; }
    }, 1000);
    resend.textContent = `Resend in ${cooldown}s`;
  }

  check.addEventListener('click', () => withBusy(check, () => tryEnter()));
  resend.addEventListener('click', () => withBusy(resend, async () => {
    try {
      await sendWithContinue((s) => authMod.sendEmailVerification(user, s), 'app.html');
      toast('Sent! Check your inbox (and spam).', 'ok');
      startCooldown(60);
    } catch (err) {
      toast(friendlyError(err), 'error');
      if (err.code === 'auth/too-many-requests') startCooldown(120);
    }
  }));
  signOut.addEventListener('click', () => authMod.signOut(ctx.fb.auth));

  // Auto-continue when they verify on another device/tab.
  const poll = setInterval(() => { if (!document.hidden) tryEnter({ quiet: true }); }, 4000);
  const onFocus = () => tryEnter({ quiet: true });
  addEventListener('focus', onFocus);
  function stop() {
    clearInterval(poll);
    clearInterval(cooldownTimer);
    removeEventListener('focus', onFocus);
  }
  ctx.onCleanup(stop);

  return h('section', { class: 'gate view' },
    h('div', { class: 'gate-card' },
      h('div', { class: 'mail-art', 'aria-hidden': 'true' }, h('span', { class: 'env' }), h('span', { class: 'flag' })),
      h('p', { class: 'eyebrow' }, 'One last step'),
      h('h1', { class: 'display display-m' }, 'Check your inbox.'),
      h('p', { class: 'lede' }, 'We sent a verification link to ', h('b', {}, user.email), '. Tap it, then come back here. This page will notice by itself.'),
      h('div', { class: 'gate-actions' }, check, resend),
      h('p', { class: 'hint' }, 'Can’t find it? Check Spam or Promotions. Verifying keeps fake accounts out of your class.'),
      usingEmulators
        ? h('p', { class: 'form-ok small' }, 'Dev mode: open the Emulator UI at 127.0.0.1:4000/auth to see the verification link.')
        : null,
      signOut,
    ),
  );
}

export function profileGate(ctx, { onDone }) {
  const input = h('input', { class: 'input', id: 'pg-name', maxlength: '24', autocomplete: 'nickname', required: true, value: ctx.session.user.displayName || '' });
  const submit = h('button', { class: 'btn btn-lg btn-block', type: 'submit' }, 'Continue', icon('arrow', 'icon arrow'));
  const form = h('form', { novalidate: true },
    h('div', { class: 'field' },
      h('label', { for: 'pg-name' }, 'Your name'),
      input,
      h('p', { class: 'hint' }, 'Use the name your classmates know you by, like “Maya J.” You can change it later.'),
    ),
    submit,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { name, error } = validateDisplayName(input.value);
    fieldError(input, error);
    if (error) return;
    withBusy(submit, async () => {
      try {
        await ctx.data.createProfile(ctx.session.user.uid, name);
        onDone({ displayName: name });
      } catch (err) {
        toast(err.code === 'permission-denied'
          ? 'The database refused to save your profile. Site owner: publish the Firestore security rules (Setup guide, Step 2).'
          : friendlyError(err), 'error', 9000);
      }
    });
  });
  setTimeout(() => input.focus(), 100);

  return h('section', { class: 'gate view' },
    h('div', { class: 'gate-card' },
      h('p', { class: 'eyebrow' }, 'Almost there'),
      h('h1', { class: 'display display-m' }, 'What do classmates call you?'),
      form,
    ),
  );
}
