// Client-side validation. These mirror firestore.rules so people get a
// friendly message *before* the server says no. The rules are the real
// enforcement: never trust the client.

// ---------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;
const CLASS_RE = /^[\p{L}\p{M}\p{N} .,'&#()!?:+-]+$/u;

export function cleanText(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateDisplayName(raw) {
  const name = cleanText(raw);
  const len = [...name].length;
  if (len < 2) return { name, error: 'Use at least 2 letters.' };
  if (len > 24) return { name, error: 'Keep it under 24 characters.' };
  if (!NAME_RE.test(name)) return { name, error: 'Letters, spaces, apostrophes and hyphens only.' };
  if (isOffensive(name)) return { name, error: 'Please choose a different name.' };
  return { name, error: null };
}

export function validateClassName(raw) {
  const name = cleanText(raw);
  const len = [...name].length;
  if (len < 2) return { name, error: 'Give your class a name (at least 2 characters).' };
  if (len > 40) return { name, error: 'Keep it under 40 characters.' };
  if (!CLASS_RE.test(name)) return { name, error: 'Letters, numbers, spaces and basic punctuation only.' };
  if (isOffensive(name)) return { name, error: 'Please choose a different class name.' };
  return { name, error: null };
}

// ---------------------------------------------------------------------
// Light profanity filter (ROT13 so the source isn't a wall of slurs).
// It's a first line of defence; the Report button + admins handle the rest.
// Add words with: rot13('word')
// ---------------------------------------------------------------------
const rot13 = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));

const SUBSTRINGS = [
  'shpx', 'fuvg', 'ovgpu', 'phag', 'avtt', 'snttbg', 'jubor', 'fyhg', 'chffl', 'cbea',
  'ergneq', 'cravf', 'intvan', 'qvyqb', 'jnax', 'onfgneq', 'nffubyr', 'xvyylbhefrys',
].map(rot13);

const WHOLE_WORDS = new Set([
  'nff', 'qvpx', 'pbpx', 'frk', 'encr', 'gvg', 'gvgf', 'phz', 'ubr', 'snt', 'xlf',
  'gjng', 'cevpx', 'cvff', 'anmv', 'zvys', 'fyhgf', 'ubrf',
].map(rot13));

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'l' };

function normalizeForFilter(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0134578@$!|]/g, (c) => LEET[c] ?? c);
}

export function isOffensive(text) {
  const norm = normalizeForFilter(text);
  const squashed = norm.replace(/[^a-z]/g, '').replace(/(.)\1{2,}/g, '$1$1');
  if (SUBSTRINGS.some((w) => squashed.includes(w))) return true;
  return norm.split(/[^a-z]+/).some((w) => WHOLE_WORDS.has(w));
}

// ---------------------------------------------------------------------
// Class codes: 6 chars, no look-alikes (no I, O, 0, 1)
// ---------------------------------------------------------------------
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols
export const CODE_LENGTH = 6;

export function randomCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  // 256 is a multiple of 32, so masking is perfectly uniform.
  return [...bytes].map((b) => CODE_ALPHABET[b & 31]).join('');
}

export function normalizeCode(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

export function isValidCode(code) {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

// ---------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------
const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123',
  'qwertyuiop', 'iloveyou', 'iloveyou1', 'letmein1', 'welcome1', 'abc12345', 'football1',
  'baseball1', 'princess1', 'sunshine1', 'likewise', 'likewise1', 'crush123', '11111111',
  'asdfghjk', 'trustno1', 'monkey123', 'dragon123', 'school123', 'minecraft', 'fortnite1',
]);

export function passwordCheck(pw, { email = '', name = '' } = {}) {
  const lower = pw.toLowerCase();
  const checks = {
    length: pw.length >= 8,
    letter: /[a-z]/i.test(pw),
    number: /\d/.test(pw),
  };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length >= 16) score++;
  const local = email.split('@')[0]?.toLowerCase();
  const weakSource =
    COMMON.has(lower) ||
    /^(.)\1+$/.test(pw) ||
    (local && local.length >= 4 && lower.includes(local)) ||
    (name && name.length >= 4 && lower.includes(name.toLowerCase().replace(/\s/g, '')));
  if (weakSource) score = Math.min(score, 1);
  score = Math.min(score, 4);
  const ok = checks.length && checks.letter && checks.number && !weakSource;
  const label = ['Too weak', 'Weak', 'Okay', 'Strong', 'Very strong'][score];
  return { ok, score, label, checks, common: weakSource };
}

export function validateEmail(raw) {
  const email = String(raw ?? '').trim();
  if (!email) return { email, error: 'Enter your email.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { email, error: 'That doesn’t look like an email address.' };
  return { email, error: null };
}
