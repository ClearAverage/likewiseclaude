// Screens shown before the app opens: verify your email, pick your name.
import { h, icon, clear, toast, withBusy, fieldError, friendlyError, confirmDialog } from '../ui.js';
import { validateDisplayName } from '../validate.js';
import { sendVerification, verifyLog, emailSender } from '../email.js';

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function verifyGate(ctx, { onVerified }) {
  const { authMod, usingEmulators } = ctx.fb;
  const user = ctx.session.user;
  let cooldown = 0;
  let cooldownTimer;

  const resend = h('button', { class: 'btn btn-ghost btn-block', type: 'button' }, 'Send a new link');
  const check = h('button', { class: 'btn btn-block btn-lg', type: 'button' }, 'I’ve verified, let me in');
  const signOut = h('button', { class: 'link small', type: 'button' }, 'Sign out');
  const restart = h('button', { class: 'link small', type: 'button' }, 'Typo in your email? Start over');
  const status = h('div', { 'aria-live': 'polite' });

  // Show exactly what happened with the last email, instead of guessing.
  function showStatus() {
    const rec = verifyLog.get(user.uid);
    clear(status);
    if (!rec) {
      status.append(h('p', { class: 'hint' }, 'No email showing up? Send a new link below.'));
    } else if (rec.ok) {
      status.append(h('p', { class: 'form-ok small' },
        `Sent at ${timeFmt.format(new Date(rec.at))}. It usually arrives within a minute or two.`));
    } else {
      status.append(h('p', { class: 'form-error' },
        `The email didn’t send: ${friendlyError({ code: rec.code }, 'Firebase refused the request.')} (${rec.code})`));
    }
  }

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
      resend.textContent = cooldown > 0 ? `Send again in ${cooldown}s` : 'Send a new link';
      if (cooldown <= 0) { clearInterval(cooldownTimer); resend.disabled = false; }
    }, 1000);
    resend.textContent = `Send again in ${cooldown}s`;
  }

  check.addEventListener('click', () => withBusy(check, () => tryEnter()));
  resend.addEventListener('click', () => withBusy(resend, async () => {
    try {
      await sendVerification(authMod, user);
      toast('Sent! Check your inbox, and Spam too.', 'ok');
      startCooldown(60);
    } catch (err) {
      toast(friendlyError(err), 'error', 8000);
      if (err.code === 'auth/too-many-requests') startCooldown(300);
    }
    showStatus();
  }));
  signOut.addEventListener('click', () => authMod.signOut(ctx.fb.auth));

  // Wrong address typed at sign-up: delete this unverified account and redo it.
  restart.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Start over?',
      message: `This deletes the unverified account for ${user.email} so you can sign up again with the right address.`,
      confirmText: 'Delete and start over', danger: true,
    });
    if (!ok) return;
    stop();
    try { sessionStorage.setItem('lw:startOver', '1'); } catch { /* ignore */ }
    try { await ctx.data.deleteMyData(user.uid); } catch { /* nothing saved yet */ }
    try {
      await authMod.deleteUser(user);
    } catch {
      await authMod.signOut(ctx.fb.auth).catch(() => {});
    }
    location.replace('auth.html?mode=signup');
  });

  // Last send was within the cooldown? Keep the button honest.
  const last = verifyLog.get(user.uid);
  if (last?.ok && Date.now() - last.at < 60000) startCooldown(Math.ceil((60000 - (Date.now() - last.at)) / 1000));
  showStatus();

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
      h('p', { class: 'lede' }, 'Tap the link we emailed to ', h('b', {}, user.email), ', then come back here. This page notices by itself.'),
      status,
      h('div', { class: 'gate-actions' }, check, resend),
      h('div', { class: 'gate-tips' },
        h('b', {}, 'Not there?'),
        h('ul', {},
          h('li', {}, h('span', {}, 'Look in ', h('b', {}, 'Spam'), ', ', h('b', {}, 'Junk'), ' and ', h('b', {}, 'Promotions'), ', or search your email for “Likewise”.')),
          h('li', {}, h('span', {}, 'It comes from ', h('b', { style: { overflowWrap: 'anywhere' } }, emailSender), '. Mark it “Not spam” so the next one lands in your inbox.')),
          h('li', {}, h('span', {}, 'School email accounts often block outside emails. A personal email (like Gmail) works best.')),
          h('li', {}, h('span', {}, 'Always use the newest email if you sent more than one.')),
        ),
      ),
      usingEmulators
        ? h('p', { class: 'form-ok small' }, 'Test mode: the email isn’t really sent. Open the Emulator UI (127.0.0.1:4000/auth) to see the link.')
        : null,
      h('div', { class: 'row', style: { justifyContent: 'center', '--gap': '20px' } }, restart, signOut),
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
