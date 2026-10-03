// =====================================================================
//  Likewise configuration
// ---------------------------------------------------------------------
//  The Firebase web config below is NOT a secret. It only identifies
//  your project. What protects the data is firestore.rules (deploy it!)
//  plus the optional App Check key below. See FIREBASE SETUP doc.
// =====================================================================

export const firebaseConfig = {
  apiKey: 'AIzaSyC-rDUHC_YT_Rtitj4AOcCzA2AbO0UGx0Q',
  authDomain: 'likewise-64c33.firebaseapp.com',
  projectId: 'likewise-64c33',
  storageBucket: 'likewise-64c33.firebasestorage.app',
  messagingSenderId: '546117452698',
  appId: '1:546117452698:web:63ce706544447c44063023',
  measurementId: 'G-DRPG4HZHHH',
};

// Firebase JS SDK version loaded from Google's CDN.
export const SDK = '12.19.0';
export const sdk = (name) => `https://www.gstatic.com/firebasejs/${SDK}/firebase-${name}.js`;

export const settings = {
  // Optional but recommended: reCAPTCHA v3 *site* key for Firebase App Check.
  // Leave empty to turn App Check off. (Setup doc, step 9.)
  appCheckSiteKey: '',

  // Google Analytics page views (never on localhost, never with crush data).
  analytics: true,

  // false = localhost talks to your REAL Firebase project (like the live site).
  // To test with the fake local Firebase Emulator Suite instead, open the site
  // once with ?emulator in the address (e.g. http://localhost:5173/?emulator),
  // or set this to true. ?live switches back.
  useEmulatorsOnLocalhost: false,
  // Must match firebase.json "emulators" (and the CSP connect-src in the HTML files).
  emulators: { auth: 'http://127.0.0.1:9099', firestore: '127.0.0.1:8080' },

  // Product rules (the security rules enforce the hard limits too).
  minRevealMinutes: 15,   // rules allow >= 10 min; UI asks for 15 to absorb clock drift
  maxRevealDays: 60,
  keepDaysAfterReveal: 3,
  minMembersToStart: 3,
  maxMembers: 200,
};

/** Should this page use the local emulators? Only ever true on localhost. */
export function wantsEmulators() {
  const h = location.hostname;
  const local = h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
  if (!local) return false;
  const p = new URLSearchParams(location.search);
  try {
    if (p.has('emulator')) sessionStorage.setItem('lw:emulator', '1');
    if (p.has('live')) sessionStorage.removeItem('lw:emulator');
    if (sessionStorage.getItem('lw:emulator') === '1') return true;
  } catch { /* storage blocked */ }
  return settings.useEmulatorsOnLocalhost && !p.has('live');
}

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
      console.warn('Add this domain to Firebase Authorized domains for branded links.');
      return send(undefined);
    }
    throw err;
  }
}
