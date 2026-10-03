// Host a class.
import { h, icon, toast, withBusy, fieldError, friendlyError, fmt, pad2, relative } from '../ui.js';
import { validateClassName } from '../validate.js';
import { settings } from '../config.js';
import { pageHead, backLink } from './common.js';

const DAY = 86400000;
const toDateInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toTimeInput = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
function fromInputs(dateStr, timeStr) {
  if (!dateStr) return NaN;
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '15:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}
function daysFromNowAt(days, hour = 15) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export function createView(ctx) {
  const { session, data } = ctx;

  const nameInput = h('input', { class: 'input', id: 'cc-name', maxlength: '40', autocomplete: 'off', placeholder: 'e.g. Period 3 Chemistry', required: true });
  const count = h('span', { class: 'count' }, '0/40');
  nameInput.addEventListener('input', () => { count.textContent = `${[...nameInput.value].length}/40`; });

  const now = new Date();
  const dateInput = h('input', { class: 'input', id: 'cc-date', type: 'date', required: true, min: toDateInput(now), max: toDateInput(new Date(Date.now() + settings.maxRevealDays * DAY)) });
  const timeInput = h('input', { class: 'input', id: 'cc-time', type: 'time', required: true, step: '300' });

  const presets = [
    ['Tomorrow', 1], ['In 3 days', 3], ['In 1 week', 7], ['In 2 weeks', 14],
  ];
  const chips = presets.map(([label, days]) => {
    const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false' }, label);
    b.addEventListener('click', () => {
      const d = daysFromNowAt(days);
      dateInput.value = toDateInput(d);
      timeInput.value = toTimeInput(d);
      chips.forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
      update();
    });
    return b;
  });

  const sumReveal = h('b');
  const sumWipe = h('b');
  const sumIn = h('span', { class: 'muted' });
  const revealError = h('p', { class: 'error-text', hidden: true });
  const summary = h('div', { class: 'summary', 'aria-live': 'polite' },
    h('div', { class: 'summary-row' }, h('span', {}, 'Results drop'), sumReveal),
    h('div', { class: 'summary-row' }, h('span', {}, 'Class is wiped'), sumWipe),
    sumIn,
  );

  function revealMs() {
    return fromInputs(dateInput.value, timeInput.value);
  }

  function checkReveal() {
    const t = revealMs();
    const nowMs = data.serverNow();
    if (Number.isNaN(t)) return 'Pick a date and time.';
    if (t < nowMs + settings.minRevealMinutes * 60000) return `Pick a time at least ${settings.minRevealMinutes} minutes from now.`;
    if (t > nowMs + settings.maxRevealDays * DAY) return `Pick a date within ${settings.maxRevealDays} days.`;
    return null;
  }

  function update() {
    const t = revealMs();
    const err = checkReveal();
    revealError.hidden = !err;
    revealError.textContent = err || '';
    if (Number.isNaN(t)) {
      sumReveal.textContent = '—';
      sumWipe.textContent = '—';
      sumIn.textContent = '';
      return;
    }
    sumReveal.textContent = fmt.full(new Date(t));
    sumWipe.textContent = fmt.full(new Date(t + settings.keepDaysAfterReveal * DAY));
    sumIn.textContent = err ? '' : `That’s ${relative(t - data.serverNow())} from now. Picking opens when you press Start.`;
  }
  dateInput.addEventListener('input', () => { chips.forEach((c) => c.setAttribute('aria-pressed', 'false')); update(); });
  timeInput.addEventListener('input', () => { chips.forEach((c) => c.setAttribute('aria-pressed', 'false')); update(); });

  // default: one week from now at 3 PM
  const def = daysFromNowAt(7);
  dateInput.value = toDateInput(def);
  timeInput.value = toTimeInput(def);
  chips[2].setAttribute('aria-pressed', 'true');
  update();

  const submit = h('button', { class: 'btn btn-lg btn-red', type: 'submit' }, 'Create class', icon('arrow', 'icon arrow'));

  const form = h('form', { class: 'form-card', novalidate: true },
    h('div', { class: 'field' },
      h('label', { for: 'cc-name' }, 'Class name'),
      nameInput,
      count,
    ),
    h('div', { class: 'field' },
      h('span', { class: 'label', id: 'cc-when' }, 'When do results drop?'),
      h('div', { class: 'chips', role: 'group', 'aria-labelledby': 'cc-when' }, chips),
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { class: 'small muted', for: 'cc-date' }, 'Date'), dateInput),
        h('div', { class: 'field' }, h('label', { class: 'small muted', for: 'cc-time' }, 'Time'), timeInput),
      ),
      revealError,
    ),
    summary,
    h('p', { class: 'lock-note' }, icon('lock'),
      h('span', {}, 'The reveal date is locked once you create the class. Nobody can change it, not even you. That’s what keeps it fair.')),
    h('div', { class: 'row' }, submit, h('a', { class: 'btn btn-ghost btn-lg', href: '#/' }, 'Cancel')),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { name, error } = validateClassName(nameInput.value);
    fieldError(nameInput, error);
    const revealErr = checkReveal();
    update();
    if (error) { nameInput.focus(); return; }
    if (revealErr) { dateInput.focus(); return; }
    nameInput.value = name;
    withBusy(submit, async () => {
      try {
        const { id } = await data.createClass(session.user.uid, session.profile, { name, revealMs: revealMs() });
        toast('Class created. Share the code!', 'ok');
        ctx.navigate(`#/c/${id}`);
      } catch (err) {
        toast(friendlyError(err, 'Couldn’t create the class. Check the details and try again.'), 'error');
      }
    });
  });

  setTimeout(() => nameInput.focus(), 150);

  return h('section', { class: 'view container-sm', style: { width: '100%' } },
    backLink(),
    pageHead({
      eyebrow: 'Host',
      title: 'Roll up your class.',
      lede: 'You’ll get a 6-letter code to share. You’re a member too, so you can pick like everyone else. Hosting doesn’t let you see anything extra.',
    }),
    form,
  );
}
