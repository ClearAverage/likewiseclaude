// Firebase bootstrap: one place that creates the app, auth and Firestore.
import { firebaseConfig, settings, sdk, wantsEmulators } from './config.js';

const { initializeApp } = await import(sdk('app'));
const authMod = await import(sdk('auth'));
const fsMod = await import(sdk('firestore'));

const host = location.hostname;
export const isLocalhost =
  host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');

export const usingEmulators = wantsEmulators();

export const app = initializeApp(firebaseConfig);

// App Check must start before any other Firebase call goes out.
if (settings.appCheckSiteKey && !usingEmulators) {
  try {
    const { initializeAppCheck, ReCaptchaV3Provider } = await import(sdk('app-check'));
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(settings.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn('App Check failed to start', err);
  }
}

// Email/password only, so no popup/redirect resolver (no third-party iframe).
export const auth = authMod.initializeAuth(app, {
  persistence: [authMod.indexedDBLocalPersistence, authMod.browserLocalPersistence, authMod.browserSessionPersistence],
});

// Memory-only cache: nothing about your picks is written to the device's disk.
export const db = fsMod.initializeFirestore(app, { localCache: fsMod.memoryLocalCache() });

if (usingEmulators) {
  const [fsHost, fsPort] = settings.emulators.firestore.split(':');
  authMod.connectAuthEmulator(auth, settings.emulators.auth, { disableWarnings: true });
  fsMod.connectFirestoreEmulator(db, fsHost, Number(fsPort));
  document.documentElement.dataset.emulator = 'on';
  console.info('%cLikewise is using the local Firebase emulators', 'color:#EC3013;font-weight:700');
}

if (settings.analytics && !isLocalhost) {
  const start = async () => {
    try {
      const { isSupported, getAnalytics } = await import(sdk('analytics'));
      if (await isSupported()) getAnalytics(app);
    } catch { /* blocked by an ad blocker: fine */ }
  };
  ('requestIdleCallback' in window) ? requestIdleCallback(start, { timeout: 4000 }) : setTimeout(start, 2000);
}

export { authMod, fsMod };
