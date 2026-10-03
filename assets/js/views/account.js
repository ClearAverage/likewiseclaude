// Account settings.
import { h, icon, toast, withBusy, fieldError, friendlyError, avatar, fmt, confirmDialog } from '../ui.js';
import { validateDisplayName, validateEmail, passwordCheck } from '../validate.js';
import { pageHead } from './common.js';
import { sendWithContinue } from '../email.js';

export function accountView(ctx) {
  const { session, data, fb } = ctx;
  const { auth, authMod } = fb;
  const user = session.user;

  const nameEl = h('h2', {}, session.profile.displayName);
  const avatarSlot = h('div', {}, avatar(session.profile.displayName, 0));

  async function reauth(password) {
    const cred = authMod.EmailAuthProvider.credential(user.email, password);
    await authMod.reauthenticateWithCredential(user, cred);
  }

  function pwField(id, label, autocomplete = 'current-password') {
    const input = h('input', { class: 'input', id, type: 'password', autocomplete, required: true });
    const toggle = h('button', { class: 'suffix', type: 'button', 'aria-controls': id, 'aria-label': 'Show password' }, 'Show');
    toggle.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Hide' : 'Show';
    });
    return { input, el: h('div', { class: 'field' }, h('label', { for: id }, label), h('div', { class: 'input-wrap' }, input, toggle)) };
  }

  function setting({ iconName, title, sub, body, danger = false, open = false }) {
    return h('details', { class: `setting ${danger ? 'setting-danger' : ''}`, open },
      h('summary', {}, icon(iconName), h('div', {}, h('b', {}, title), h('span', {}, sub))),
      h('div', { class: 'setting-body' }, body),
    );
  }

  // --- Name -----------------------------------------------------------
  const nameInput = h('input', { class: 'input', id: 'ac-name', maxlength: '24', value: session.profile.displayName, autocomplete: 'nickname' });
  const nameBtn = h('button', { class: 'btn', type: 'submit' }, 'Save name');
  const nameForm = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'ac-name' }, 'Display name'), nameInput,
      h('p', { class: 'hint' }, 'Used for classes you join from now on. Names in classes that already started stay as they were, so nobody can switch identities mid-round.')),
    h('div', {}, nameBtn),
  );
  nameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const { name, error } = validateDisplayName(nameInput.value);
    fieldError(nameInput, error);
    if (error) return;
    withBusy(nameBtn, async () => {
      try {
        await data.updateDisplayName(user.uid, name);
        session.profile.displayName = name;
        authMod.updateProfile(user, { displayName: name }).catch(() => {});
        nameEl.textContent = name;
        avatarSlot.replaceChildren(avatar(name, 0));
        ctx.refreshUser();
        toast('Name saved.', 'ok');
      } catch (err) { toast(friendlyError(err), 'error'); }
    });
  });

  // --- Email ----------------------------------------------------------
  const newEmail = h('input', { class: 'input', id: 'ac-email', type: 'email', autocomplete: 'email', inputmode: 'email' });
  const emailPw = pwField('ac-email-pw', 'Current password');
  const emailBtn = h('button', { class: 'btn', type: 'submit' }, 'Send confirmation');
  const emailForm = h('form', { class: 'stack', novalidate: true },
    h('p', { class: 'small muted' }, 'Current email: ', h('b', { style: { color: 'var(--ink)' } }, user.email)),
    h('div', { class: 'field' }, h('label', { for: 'ac-email' }, 'New email'), newEmail),
    emailPw.el,
    h('p', { class: 'hint' }, 'We’ll send a link to the new address. Your email only changes after you click it, and you’ll be asked to sign in again.'),
    h('div', {}, emailBtn),
  );
  emailForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const { email, error } = validateEmail(newEmail.value);
    fieldError(newEmail, error || (email.toLowerCase() === user.email.toLowerCase() ? 'That’s already your email.' : null));
    fieldError(emailPw.input, emailPw.input.value ? null : 'Enter your current password.');
    if (error || !emailPw.input.value || email.toLowerCase() === user.email.toLowerCase()) return;
    withBusy(emailBtn, async () => {
      try {
        await reauth(emailPw.input.value);
        await sendWithContinue((s) => authMod.verifyBeforeUpdateEmail(user, email, s), 'auth.html?mode=signin');
        emailForm.reset();
        toast(`Check ${email} to confirm the change.`, 'ok', 7000);
      } catch (err) {
        if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') fieldError(emailPw.input, 'That password isn’t right.');
        else toast(friendlyError(err), 'error');
      }
    });
  });

  // --- Password -------------------------------------------------------
  const curPw = pwField('ac-cur-pw', 'Current password');
  const nextPw = pwField('ac-new-pw', 'New password', 'new-password');
  const meter = h('div', { class: 'pw-meter', 'data-score': '0', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
  const meterLabel = h('span', { class: 'hint' }, 'At least 8 characters, with a letter and a number.');
  nextPw.el.append(meter, meterLabel);
  nextPw.input.addEventListener('input', () => {
    const r = passwordCheck(nextPw.input.value, { email: user.email, name: session.profile.displayName });
    meter.dataset.score = nextPw.input.value ? String(Math.max(1, r.score)) : '0';
    meterLabel.textContent = nextPw.input.value ? (r.common ? 'Too easy to guess.' : `Strength: ${r.label}`) : 'At least 8 characters, with a letter and a number.';
  });
  const pwBtn = h('button', { class: 'btn', type: 'submit' }, 'Change password');
  const resetBtn = h('button', { class: 'link small', type: 'button' }, 'Forgot your current password? Email me a reset link');
  const pwForm = h('form', { class: 'stack', novalidate: true }, curPw.el, nextPw.el, h('div', { class: 'row' }, pwBtn), resetBtn);
  pwForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const r = passwordCheck(nextPw.input.value, { email: user.email, name: session.profile.displayName });
    fieldError(curPw.input, curPw.input.value ? null : 'Enter your current password.');
    fieldError(nextPw.input, r.ok ? null : 'Use 8+ characters with a letter and a number (and nothing too easy to guess).');
    if (!curPw.input.value || !r.ok) return;
    withBusy(pwBtn, async () => {
      try {
        await reauth(curPw.input.value);
        await authMod.updatePassword(user, nextPw.input.value);
        pwForm.reset();
        meter.dataset.score = '0';
        toast('Password changed.', 'ok');
      } catch (err) {
        if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') fieldError(curPw.input, 'That password isn’t right.');
        else toast(friendlyError(err), 'error');
      }
    });
  });
  resetBtn.addEventListener('click', () => withBusy(resetBtn, async () => {
    try {
      await sendWithContinue((s) => authMod.sendPasswordResetEmail(auth, user.email, s), 'auth.html?mode=signin');
      toast(`Reset link sent to ${user.email}.`, 'ok');
    } catch (err) { toast(friendlyError(err), 'error'); }
  }));

  // --- Sign out -------------------------------------------------------
  const outBtn = h('button', { class: 'btn btn-ghost', type: 'button' }, icon('logout'), 'Sign out');
  outBtn.addEventListener('click', async () => {
    try { localStorage.removeItem('lw:signedIn'); } catch { /* ignore */ }
    await authMod.signOut(auth);
    location.replace('index.html');
  });

  // --- Delete ---------------------------------------------------------
  const delPw = pwField('ac-del-pw', 'Your password');
  const confirmInput = h('input', { class: 'input', id: 'ac-del-confirm', autocomplete: 'off', placeholder: 'DELETE' });
  const delBtn = h('button', { class: 'btn btn-red', type: 'submit' }, 'Delete my account');
  const delForm = h('form', { class: 'stack', novalidate: true },
    h('p', { class: 'small muted' }, 'This removes your account, your profile and any picks that can still be changed. Classes already in progress keep your name in their list until they’re wiped (at most 3 days after their reveal). This can’t be undone.'),
    delPw.el,
    h('div', { class: 'field' }, h('label', { for: 'ac-del-confirm' }, 'Type DELETE to confirm'), confirmInput),
    h('div', {}, delBtn),
  );
  delForm.addEventListener('submit', (e) => {
    e.preventDefault();
    fieldError(confirmInput, confirmInput.value.trim() === 'DELETE' ? null : 'Type DELETE in capitals.');
    fieldError(delPw.input, delPw.input.value ? null : 'Enter your password.');
    if (confirmInput.value.trim() !== 'DELETE' || !delPw.input.value) return;
    withBusy(delBtn, async () => {
      try {
        await reauth(delPw.input.value);
      } catch (err) {
        fieldError(delPw.input, err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' ? 'That password isn’t right.' : friendlyError(err));
        return;
      }
      const ok = await confirmDialog({ title: 'Last chance', message: 'Delete your Likewise account for good?', confirmText: 'Delete forever', danger: true });
      if (!ok) return;
      try {
        ctx.stopListening();
        await data.deleteMyData(user.uid);
        await authMod.deleteUser(user);
        try { localStorage.clear(); } catch { /* ignore */ }
        location.replace('index.html');
      } catch (err) { toast(friendlyError(err), 'error'); }
    });
  });

  const created = user.metadata?.creationTime ? new Date(user.metadata.creationTime) : null;

  return h('section', { class: 'view' },
    pageHead({ eyebrow: 'Account', title: 'You.', lede: 'Your name, sign-in details and privacy controls.' }),
    h('div', { class: 'account-grid' },
      h('aside', { class: 'panel profile-card' },
        avatarSlot,
        nameEl,
        h('p', { class: 'muted', style: { overflowWrap: 'anywhere' } }, user.email),
        h('div', { class: 'row' },
          h('span', { class: 'pill pill-ok' }, icon('check', 'icon'), 'Email verified'),
          created ? h('span', { class: 'pill' }, `Since ${fmt.short(created)}`) : null,
        ),
        h('div', { class: 'divider', style: { width: '100%' } }),
        h('p', { class: 'small muted' }, 'Your picks are sealed by the database rules. Not even your own account can read someone else’s pick unless it’s mutual.'),
        outBtn,
      ),
      h('div', { class: 'settings' },
        setting({ iconName: 'user', title: 'Display name', sub: 'What classmates see', body: nameForm, open: true }),
        setting({ iconName: 'mail', title: 'Email', sub: user.email, body: emailForm }),
        setting({ iconName: 'key', title: 'Password', sub: 'Change it or get a reset link', body: pwForm }),
        setting({ iconName: 'trash', title: 'Delete account', sub: 'Remove your account and data', body: delForm, danger: true }),
      ),
    ),
  );
}
