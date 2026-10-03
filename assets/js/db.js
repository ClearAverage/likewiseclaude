// Every Firestore read/write the app makes lives here, shaped to match
// firestore.rules exactly. If you change one, change the other (and run
// the rules tests).
import { db, auth, fsMod } from './firebase.js';
import { settings } from './config.js';
import { randomCode } from './validate.js';
import { UserError } from './ui.js';

const {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, writeBatch,
  serverTimestamp, Timestamp, increment, arrayUnion, onSnapshot,
} = fsMod;

const DAY = 24 * 60 * 60 * 1000;

export const ref = {
  user: (uid) => doc(db, 'users', uid),
  memberships: (uid) => collection(db, 'users', uid, 'memberships'),
  membership: (uid, cid) => doc(db, 'users', uid, 'memberships', cid),
  code: (code) => doc(db, 'joinCodes', code),
  cls: (cid) => doc(db, 'classes', cid),
  members: (cid) => collection(db, 'classes', cid, 'members'),
  member: (cid, uid) => doc(db, 'classes', cid, 'members', uid),
  pick: (cid, uid) => doc(db, 'classes', cid, 'picks', uid),
};

const ms = (ts) => (ts?.toMillis ? ts.toMillis() : Number(ts) || 0);
export { ms as toMillis };
const randomTone = () => crypto.getRandomValues(new Uint8Array(1))[0] % 8;

// ---------------------------------------------------------------------
// Server clock. The reveal is decided by the SERVER's clock. If a phone's
// clock runs fast, asking too early would look like "no match", so we
// estimate the offset from a freshly issued ID token.
// ---------------------------------------------------------------------
let clockOffset = 0;
export async function syncClock() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const t0 = Date.now();
    const res = await user.getIdTokenResult(true);
    const t1 = Date.now();
    const issued = Date.parse(res.issuedAtTime) + 500; // 1s resolution: aim for the middle
    const off = issued - (t0 + t1) / 2;
    clockOffset = Math.abs(off) < 1500 ? 0 : off;
  } catch { /* offline: keep local time */ }
}
export const serverNow = () => Date.now() + clockOffset;

// A little buffer so we never ask for a result a hair before the server allows it.
export const REVEAL_GRACE_MS = 4000;

export function phaseOf({ status, revealAt, expireAt }, now = serverNow()) {
  if (now >= ms(expireAt)) return 'expired';
  if (status === 'lobby') return now >= ms(revealAt) ? 'stale' : 'lobby';
  if (now >= ms(revealAt) + REVEAL_GRACE_MS) return 'revealed';
  if (now >= ms(revealAt)) return 'revealing';
  return 'live';
}

// ---------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------
export async function getProfile(uid) {
  const snap = await getDoc(ref.user(uid));
  return snap.exists() ? snap.data() : null;
}

export async function createProfile(uid, displayName) {
  await setDoc(ref.user(uid), { displayName, createdAt: serverTimestamp() });
}

export async function updateDisplayName(uid, displayName) {
  await updateDoc(ref.user(uid), { displayName, updatedAt: serverTimestamp() });
}

// ---------------------------------------------------------------------
// Memberships ("my classes")
// ---------------------------------------------------------------------
export function watchMemberships(uid, cb, onError) {
  return onSnapshot(
    ref.memberships(uid),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}

export async function listMemberships(uid) {
  const snap = await getDocs(ref.memberships(uid));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------
export async function getClass(cid) {
  const snap = await getDoc(ref.cls(cid));
  return snap.exists() ? { id: cid, ...snap.data() } : null;
}

export function watchClass(cid, cb, onError) {
  return onSnapshot(ref.cls(cid), (s) => cb(s.exists() ? { id: s.id, ...s.data() } : null), onError);
}

export function watchMembers(cid, cb, onError) {
  return onSnapshot(ref.members(cid), (s) => cb(s.docs.map((d) => ({ uid: d.id, ...d.data() }))), onError);
}

export function watchMyPick(cid, uid, cb, onError) {
  return onSnapshot(ref.pick(cid, uid), (s) => cb(s.exists() ? s.data() : null), onError);
}

export async function createClass(uid, profile, { name, revealMs }) {
  const revealAt = Timestamp.fromMillis(revealMs);
  const expireAt = Timestamp.fromMillis(revealMs + settings.keepDaysAfterReveal * DAY);

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode();
    const taken = await getDoc(ref.code(code));
    if (taken.exists()) continue;

    const classRef = doc(collection(db, 'classes'));
    const cid = classRef.id;
    const b = writeBatch(db);
    b.set(classRef, {
      name, hostUid: uid, hostName: profile.displayName, code, status: 'lobby',
      createdAt: serverTimestamp(), revealAt, expireAt, pickCount: 0, kicked: [],
    });
    b.set(ref.code(code), { classId: cid, className: name, hostName: profile.displayName, revealAt, expireAt });
    b.set(ref.member(cid, uid), {
      displayName: profile.displayName, code, tone: randomTone(), joinedAt: serverTimestamp(), expireAt,
    });
    b.set(ref.membership(uid, cid), { className: name, role: 'host', revealAt, expireAt, joinedAt: serverTimestamp() });
    try {
      await b.commit();
      return { id: cid, code };
    } catch (err) {
      // Retry only if someone grabbed the same code a split second earlier.
      const raced = err.code === 'permission-denied' && (await getDoc(ref.code(code)).then((s) => s.exists(), () => false));
      if (raced) continue;
      throw err;
    }
  }
  throw new UserError('Couldn’t reserve a class code. Please try again.');
}

export async function lookupCode(code) {
  const snap = await getDoc(ref.code(code));
  return snap.exists() ? { code, ...snap.data() } : null;
}

export async function joinClass(uid, profile, info) {
  const existing = await getDoc(ref.membership(uid, info.classId));
  if (existing.exists()) return { already: true };
  const b = writeBatch(db);
  b.set(ref.member(info.classId, uid), {
    displayName: profile.displayName, code: info.code, tone: randomTone(),
    joinedAt: serverTimestamp(), expireAt: info.expireAt,
  });
  b.set(ref.membership(uid, info.classId), {
    className: info.className, role: 'member', revealAt: info.revealAt, expireAt: info.expireAt,
    joinedAt: serverTimestamp(),
  });
  try {
    await b.commit();
  } catch (err) {
    if (err.code === 'permission-denied') {
      throw new UserError('You can’t join this class. The doors may have closed, or the host removed you.');
    }
    throw err;
  }
  return { already: false };
}

// ---------------------------------------------------------------------
// Host controls (lobby)
// ---------------------------------------------------------------------
export async function kickMember(cid, memberUid) {
  const b = writeBatch(db);
  b.delete(ref.member(cid, memberUid));
  b.update(ref.cls(cid), { kicked: arrayUnion(memberUid) });
  await b.commit();
}

export async function startClass(cid, code) {
  const b = writeBatch(db);
  b.update(ref.cls(cid), { status: 'live', startedAt: serverTimestamp() });
  b.delete(ref.code(code));
  await b.commit();
}

export async function cancelClass(cid, uid, code, memberUids) {
  // Others first: the rules need the class doc to still exist for kicks.
  await Promise.allSettled(memberUids.filter((u) => u !== uid).map((u) => deleteDoc(ref.member(cid, u))));
  await deleteDoc(ref.code(code)).catch(() => {});
  await deleteDoc(ref.cls(cid));
  await deleteDoc(ref.member(cid, uid)).catch(() => {});
  await deleteDoc(ref.membership(uid, cid)).catch(() => {});
}

export async function leaveClass(cid, uid) {
  await deleteDoc(ref.member(cid, uid));
  await deleteDoc(ref.membership(uid, cid)).catch(() => {});
}

// ---------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------
export async function savePick(cid, uid, target, { hadPick, expireAt }) {
  if (hadPick) {
    await updateDoc(ref.pick(cid, uid), { target, updatedAt: serverTimestamp() });
    return;
  }
  const b = writeBatch(db);
  b.set(ref.pick(cid, uid), { target, updatedAt: serverTimestamp(), expireAt });
  b.update(ref.cls(cid), { pickCount: increment(1) });
  await b.commit();
}

export async function removePick(cid, uid) {
  const b = writeBatch(db);
  b.delete(ref.pick(cid, uid));
  b.update(ref.cls(cid), { pickCount: increment(-1) });
  await b.commit();
}

/**
 * The reveal. We read our own pick, then try to read our crush's pick.
 * The rules only allow that second read if it points back at us, so a
 * denial simply means "not mutual". There is no other way to learn it.
 */
export async function getResult(cid, uid) {
  const mine = await getDoc(ref.pick(cid, uid));
  if (!mine.exists()) return { kind: 'none' };
  const target = mine.data().target;
  try {
    const theirs = await getDoc(ref.pick(cid, target));
    if (theirs.exists() && theirs.data().target === uid) return { kind: 'match', target };
  } catch (err) {
    if (err.code !== 'permission-denied') throw err;
  }
  return { kind: 'nomatch', target };
}

// ---------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------
// After expiry, any member wipes the whole class (in case the TTL policy
// isn't enabled on the free plan). Deleting reveals nothing.
export async function sweepClass(cid, uid) {
  try {
    let code = null;
    try {
      const me = await getDoc(ref.member(cid, uid));
      code = me.exists() ? me.data().code : null;
    } catch { /* ignore */ }
    let others = [];
    try {
      const snap = await getDocs(ref.members(cid));
      others = snap.docs.map((d) => d.id).filter((id) => id !== uid);
    } catch { /* not a member anymore */ }
    await Promise.allSettled([...others, uid].map((u) => deleteDoc(ref.pick(cid, u))));
    await Promise.allSettled(others.map((u) => deleteDoc(ref.member(cid, u))));
    if (code) await deleteDoc(ref.code(code)).catch(() => {});
    await deleteDoc(ref.cls(cid)).catch(() => {});
    await deleteDoc(ref.member(cid, uid)).catch(() => {});
  } finally {
    await deleteDoc(ref.membership(uid, cid)).catch(() => {});
  }
}

// The class was cancelled or we were removed: tidy our own leftovers.
export async function forgetClass(cid, uid) {
  await deleteDoc(ref.member(cid, uid)).catch(() => {});
  await deleteDoc(ref.membership(uid, cid)).catch(() => {});
}

// ---------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------
export async function submitReport({ uid, classId, className, targetUid, targetName, reason, details }) {
  const data = { reporterUid: uid, classId, reason, details: details || '', createdAt: serverTimestamp() };
  if (className) data.className = className.slice(0, 40);
  if (targetUid) {
    data.targetUid = targetUid;
    if (targetName) data.targetName = targetName.slice(0, 24);
  }
  await setDoc(doc(collection(db, 'reports')), data);
}

// ---------------------------------------------------------------------
// Account deletion: remove everything we're allowed to, then the profile.
// ---------------------------------------------------------------------
export async function deleteMyData(uid) {
  let memberships = [];
  try { memberships = await listMemberships(uid); } catch { /* ignore */ }
  const now = serverNow();
  for (const m of memberships) {
    try {
      if (now >= ms(m.expireAt)) { await sweepClass(m.id, uid); continue; }
      let cls = null;
      try { cls = await getClass(m.id); } catch { cls = null; }
      if (!cls) { await forgetClass(m.id, uid); continue; }
      if (cls.status === 'lobby') {
        if (cls.hostUid === uid) {
          const snap = await getDocs(ref.members(m.id));
          await cancelClass(m.id, uid, cls.code, snap.docs.map((d) => d.id));
        } else {
          await leaveClass(m.id, uid);
        }
        continue;
      }
      if (now < ms(cls.revealAt)) {
        const p = await getDoc(ref.pick(m.id, uid));
        if (p.exists()) await removePick(m.id, uid);
      }
      await deleteDoc(ref.membership(uid, m.id));
    } catch (err) {
      console.warn('Cleanup skipped for a class', err);
    }
  }
  await deleteDoc(ref.user(uid)).catch(() => {});
}
