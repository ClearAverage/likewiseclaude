// Sending Firebase Authentication emails, with honest status reporting.
import { firebaseConfig, settings } from './config.js';

/** The address Firebase sends from (or your own, if you set up SMTP). */
export const emailSender = settings.emailFrom || `noreply@${firebaseConfig.authDomain}`;

/**
 * Send an auth email with a "continue" link back to this site. If this domain
 * isn't in Firebase's Authorized domains yet, send it without the link
 * instead of failing (the email still works).
 */
export async function sendWithContinue(send, path) {
  try {
    return await send({ url: new URL(path, location.href).href });
  } catch (err) {
    if (['auth/unauthorized-continue-uri', 'auth/invalid-continue-uri', 'auth/unauthorized-domain'].includes(err.code)) {
      console.warn('Add this domain to Firebase Authorized domains for links back to the site.');
      return send(undefined);
    }
    throw err;
  }
}

// What happened the last time we asked Firebase to send a verification
// email for this account (per device; just for showing status).
export const verifyLog = {
  key: (uid) => `lw:verify:${uid}`,
  get(uid) {
    try { return JSON.parse(localStorage.getItem(this.key(uid)) || 'null'); } catch { return null; }
  },
  set(uid, value) {
    try { localStorage.setItem(this.key(uid), JSON.stringify(value)); } catch { /* storage blocked */ }
  },
};

/** Ask Firebase to email a verification link. Records the outcome, rethrows errors. */
export async function sendVerification(authMod, user) {
  try {
    await sendWithContinue((s) => authMod.sendEmailVerification(user, s), 'app.html');
    const rec = { ok: true, at: Date.now() };
    verifyLog.set(user.uid, rec);
    return rec;
  } catch (err) {
    console.warn('Verification email failed:', err.code, err.message);
    verifyLog.set(user.uid, { ok: false, code: err.code || 'unknown', at: Date.now() });
    throw err;
  }
}
