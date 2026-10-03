// Join with a code.
import { h, icon, clear, toast, withBusy, friendlyError, fmt } from '../ui.js';
import { normalizeCode, isValidCode, CODE_LENGTH } from '../validate.js';
import { pageHead, backLink } from './common.js';

export function joinView(ctx, codeParam = '') {
  const { session, data } = ctx;
  const uid = session.user.uid;

  const tiles = Array.from({ length: CODE_LENGTH }, () => h('div', { class: 'code-tile', 'aria-hidden': 'true' }));
  const input = h('input', {
    class: 'code-input-real', id: 'join-code', maxlength: '12', autocomplete: 'one-time-code',
    autocapitalize: 'characters', spellcheck: 'false', inputmode: 'text', 'aria-label': 'Class code, 6 characters',
  });
  const tileWrap = h('div', { class: 'code-tiles' }, tiles, input);
  const hint = h('p', { class: 'hint' }, 'Codes are 6 characters. They never use O, I, 0 or 1, so no mix-ups.');
  const status = h('div', { 'aria-live': 'polite' });
  let lastLooked = '';
  let lookupToken = 0;

  function paint() {
    const code = normalizeCode(input.value);
    const focused = document.activeElement === input;
    tiles.forEach((t, i) => {
      const ch = code[i] || '';
      if (t.textContent !== ch) {
        t.textContent = ch;
        t.classList.toggle('is-filled', !!ch);
      }
      t.classList.toggle('is-active', focused && i === Math.min(code.length, CODE_LENGTH - 1) && code.length < CODE_LENGTH);
    });
    return code;
  }

  async function onChange() {
    const code = paint();
    input.value = code;
    tileWrap.classList.remove('is-error', 'is-ok');
    if (code.length < CODE_LENGTH) {
      if (lastLooked) { clear(status); lastLooked = ''; }
      return;
    }
    if (!isValidCode(code)) {
      tileWrap.classList.add('is-error');
      showError('That code has a character codes never use (O, I, 0 or 1). Double-check it.');
      return;
    }
    if (code === lastLooked) return;
    lastLooked = code;
    const token = ++lookupToken;
    clear(status).append(h('div', { class: 'row muted' }, h('span', { class: 'spinner' }), 'Looking for that class…'));
    try {
      const info = await data.lookupCode(code);
      if (token !== lookupToken) return;
      if (!info) {
        tileWrap.classList.add('is-error');
        showError('No open class with that code. It might be mistyped, or the host already pressed Start.');
        return;
      }
      if (session.memberships.some((m) => m.id === info.classId)) {
        toast('You’re already in this class.');
        ctx.navigate(`#/c/${info.classId}`);
        return;
      }
      tileWrap.classList.add('is-ok');
      showPreview(info);
    } catch (err) {
      if (token !== lookupToken) return;
      lastLooked = '';
      showError(friendlyError(err));
    }
  }

  function showError(msg) {
    clear(status).append(h('p', { class: 'form-error' }, msg));
  }

  function showPreview(info) {
    const joinBtn = h('button', { class: 'btn btn-lg btn-red', type: 'button' }, 'Join class', icon('arrow', 'icon arrow'));
    joinBtn.addEventListener('click', () => withBusy(joinBtn, async () => {
      try {
        await data.joinClass(uid, session.profile, info);
        toast('You’re in! Waiting for the host to start.', 'ok');
        ctx.navigate(`#/c/${info.classId}`);
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
    }));
    clear(status).append(h('div', { class: 'preview-card' },
      h('p', { class: 'eyebrow' }, 'Found it'),
      h('h2', {}, info.className),
      h('div', { class: 'class-meta' },
        h('span', {}, icon('user'), `Hosted by ${info.hostName}`),
        h('span', {}, icon('clock'), `Results ${fmt.full(info.revealAt.toDate())}`),
      ),
      h('p', { class: 'small muted' }, `You’ll join as `, h('b', { style: { color: 'var(--ink)' } }, session.profile.displayName), '. Classmates will see this name in the class list.'),
      h('div', { class: 'row' }, joinBtn),
    ));
    setTimeout(() => joinBtn.focus(), 100);
  }

  input.addEventListener('input', onChange);
  input.addEventListener('focus', paint);
  input.addEventListener('blur', paint);
  tileWrap.addEventListener('click', () => input.focus());

  if (codeParam) {
    input.value = normalizeCode(codeParam);
    setTimeout(onChange, 50);
  }
  setTimeout(() => input.focus(), 150);

  return h('section', { class: 'view container-sm', style: { width: '100%' } },
    backLink(),
    pageHead({ eyebrow: 'Join', title: 'Got a code?', lede: 'Type the 6-character code your host shared. You can only join before they press Start.' }),
    h('div', { class: 'form-card' },
      h('label', { class: 'label', for: 'join-code' }, 'Class code'),
      tileWrap,
      hint,
      status,
    ),
  );
}
