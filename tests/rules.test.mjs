// Likewise: security rules test suite.
//
// Every test here is an attack (or a legit action) a student could try
// straight from the browser console. Run against the local emulator:
//
//   npm install
//   npm test
//
// (needs Java 21+ for the Firestore emulator)

import { test, describe, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where,
  writeBatch, serverTimestamp, Timestamp, increment, arrayUnion,
} from 'firebase/firestore';

const here = dirname(fileURLToPath(import.meta.url));
const RULES = process.env.RULES_PATH || resolve(here, '../firestore.rules');
const DAY = 24 * 60 * 60 * 1000;
const PEOPLE = ['host', 'alice', 'bob', 'carol', 'dave', 'eve'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

let env;

before(async () => {
  // Host/port come from FIRESTORE_EMULATOR_HOST, which `firebase emulators:exec` sets.
  env = await initializeTestEnvironment({
    projectId: 'demo-likewise',
    firestore: { rules: readFileSync(RULES, 'utf8') },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------
function as(uid, { verified = true } = {}) {
  return env
    .authenticatedContext(uid, { email: `${uid}@test.dev`, email_verified: verified })
    .firestore();
}

function anon() {
  return env.unauthenticatedContext().firestore();
}

async function seedUsers() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    for (const u of PEOPLE) {
      await setDoc(doc(fs, `users/${u}`), { displayName: cap(u), createdAt: Timestamp.now() });
    }
  });
}

/**
 * Seed a class in any state, bypassing rules.
 * revealIn: ms from now until the reveal (negative = already revealed)
 */
async function seedClass({
  id = 'class1',
  status = 'live',
  revealIn = DAY,
  members = PEOPLE,
  picks = {},
  code = 'ABC234',
  host = 'host',
  kicked = [],
} = {}) {
  await seedUsers();
  const now = Date.now();
  const revealAt = Timestamp.fromMillis(now + revealIn);
  const expireAt = Timestamp.fromMillis(now + revealIn + 3 * DAY);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    const data = {
      name: 'Period 3 Chem', hostUid: host, hostName: cap(host), code, status,
      createdAt: Timestamp.now(), revealAt, expireAt,
      pickCount: Object.keys(picks).length, kicked,
    };
    if (status === 'live') data.startedAt = Timestamp.now();
    await setDoc(doc(fs, `classes/${id}`), data);
    if (status === 'lobby') {
      await setDoc(doc(fs, `joinCodes/${code}`), {
        classId: id, className: 'Period 3 Chem', hostName: cap(host), revealAt, expireAt,
      });
    }
    for (const m of members) {
      await setDoc(doc(fs, `classes/${id}/members/${m}`), {
        displayName: cap(m), code, tone: 1, joinedAt: Timestamp.now(), expireAt,
      });
    }
    for (const [from, to] of Object.entries(picks)) {
      await setDoc(doc(fs, `classes/${id}/picks/${from}`), {
        target: to, updatedAt: Timestamp.now(), expireAt,
      });
    }
  });
  return { revealAt, expireAt, code, id };
}

function createClass(fs, uid, {
  classId = 'newclass', code = 'XYZ789', name = 'Bio Period 2',
  revealMs = Date.now() + 2 * DAY, hostName = cap(uid),
  classOverrides = {}, skip = [],
} = {}) {
  const revealAt = Timestamp.fromMillis(revealMs);
  const expireAt = Timestamp.fromMillis(revealMs + 3 * DAY);
  const b = writeBatch(fs);
  b.set(doc(fs, `classes/${classId}`), {
    name, hostUid: uid, hostName, code, status: 'lobby', createdAt: serverTimestamp(),
    revealAt, expireAt, pickCount: 0, kicked: [], ...classOverrides,
  });
  if (!skip.includes('code')) {
    b.set(doc(fs, `joinCodes/${code}`), { classId, className: name, hostName, revealAt, expireAt });
  }
  if (!skip.includes('member')) {
    b.set(doc(fs, `classes/${classId}/members/${uid}`), {
      displayName: hostName, code, tone: 3, joinedAt: serverTimestamp(), expireAt,
    });
  }
  if (!skip.includes('membership')) {
    b.set(doc(fs, `users/${uid}/memberships/${classId}`), {
      className: name, role: 'host', revealAt, expireAt, joinedAt: serverTimestamp(),
    });
  }
  return b.commit();
}

function join(fs, uid, seed, { code = seed.code, displayName = cap(uid), role = 'member', tone = 2 } = {}) {
  const b = writeBatch(fs);
  b.set(doc(fs, `classes/${seed.id}/members/${uid}`), {
    displayName, code, tone, joinedAt: serverTimestamp(), expireAt: seed.expireAt,
  });
  b.set(doc(fs, `users/${uid}/memberships/${seed.id}`), {
    className: 'Period 3 Chem', role, revealAt: seed.revealAt, expireAt: seed.expireAt,
    joinedAt: serverTimestamp(),
  });
  return b.commit();
}

function pick(fs, uid, target, seed, { counter = 1 } = {}) {
  const b = writeBatch(fs);
  b.set(doc(fs, `classes/${seed.id}/picks/${uid}`), {
    target, updatedAt: serverTimestamp(), expireAt: seed.expireAt,
  });
  if (counter !== 0) b.update(doc(fs, `classes/${seed.id}`), { pickCount: increment(counter) });
  return b.commit();
}

function unpick(fs, uid, seed) {
  const b = writeBatch(fs);
  b.delete(doc(fs, `classes/${seed.id}/picks/${uid}`));
  b.update(doc(fs, `classes/${seed.id}`), { pickCount: increment(-1) });
  return b.commit();
}

const pickRef = (fs, seed, who) => doc(fs, `classes/${seed.id}/picks/${who}`);

// ==================================================================
describe('profiles', () => {
  test('you can create and read your own profile', async () => {
    const fs = as('alice', { verified: false });
    await assertSucceeds(setDoc(doc(fs, 'users/alice'), { displayName: 'Alice', createdAt: serverTimestamp() }));
    await assertSucceeds(getDoc(doc(fs, 'users/alice')));
  });

  test('accented names work', async () => {
    const fs = as('alice');
    await assertSucceeds(setDoc(doc(fs, 'users/alice'), { displayName: "Zoë O'Neil-Núñez", createdAt: serverTimestamp() }));
  });

  test('you cannot read or write someone else\'s profile', async () => {
    await seedUsers();
    await assertFails(getDoc(doc(as('bob'), 'users/alice')));
    await assertFails(setDoc(doc(as('bob'), 'users/alice'), { displayName: 'Hacked', createdAt: serverTimestamp() }));
    await assertFails(getDocs(collection(as('bob'), 'users')));
  });

  test('bad names are rejected', async () => {
    const fs = as('alice');
    for (const bad of ['<script>', 'A', ' Alice', 'Alice ', 'Al  ice', 'x'.repeat(25), 'Alice123', '😀😀']) {
      await assertFails(setDoc(doc(fs, 'users/alice'), { displayName: bad, createdAt: serverTimestamp() }));
    }
  });

  test('extra fields are rejected', async () => {
    await assertFails(setDoc(doc(as('alice'), 'users/alice'), {
      displayName: 'Alice', createdAt: serverTimestamp(), isAdmin: true,
    }));
  });

  test('you can rename yourself', async () => {
    await seedUsers();
    await assertSucceeds(updateDoc(doc(as('alice'), 'users/alice'), { displayName: 'Ally', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as('alice'), 'users/alice'), { displayName: 'Ally', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });

  test('you can list your own classes (memberships) only', async () => {
    const s = await seedClass({ status: 'lobby', members: ['host'] });
    await assertSucceeds(join(as('alice'), 'alice', s));
    await assertSucceeds(getDocs(collection(as('alice'), 'users/alice/memberships')));
    await assertFails(getDocs(collection(as('bob'), 'users/alice/memberships')));
  });

  test('signed-out users get nothing', async () => {
    await seedClass();
    await assertFails(getDoc(doc(anon(), 'users/alice')));
    await assertFails(getDoc(doc(anon(), 'classes/class1')));
    await assertFails(getDoc(doc(anon(), 'joinCodes/ABC234')));
  });
});

// ==================================================================
describe('creating a class', () => {
  beforeEach(seedUsers);

  test('a verified user can host a class', async () => {
    await assertSucceeds(createClass(as('alice'), 'alice'));
  });

  test('unverified emails cannot host', async () => {
    await assertFails(createClass(as('alice', { verified: false }), 'alice'));
  });

  test('reveal must be 10 min to 60 days out', async () => {
    await assertFails(createClass(as('alice'), 'alice', { revealMs: Date.now() + 60 * 1000 }));
    await assertFails(createClass(as('alice'), 'alice', { revealMs: Date.now() - DAY }));
    await assertFails(createClass(as('alice'), 'alice', { revealMs: Date.now() + 61 * DAY }));
  });

  test('expiry must be exactly reveal + 3 days', async () => {
    const revealMs = Date.now() + 2 * DAY;
    await assertFails(createClass(as('alice'), 'alice', {
      revealMs, classOverrides: { expireAt: Timestamp.fromMillis(revealMs + 30 * DAY) },
    }));
  });

  test('cannot start live, pre-load picks, or pre-kick', async () => {
    await assertFails(createClass(as('alice'), 'alice', { classOverrides: { status: 'live' } }));
    await assertFails(createClass(as('alice'), 'alice', { classOverrides: { pickCount: 5 } }));
    await assertFails(createClass(as('alice'), 'alice', { classOverrides: { kicked: ['bob'] } }));
  });

  test('cannot host as someone else or fake the host name', async () => {
    await assertFails(createClass(as('alice'), 'alice', { classOverrides: { hostUid: 'bob' } }));
    await assertFails(createClass(as('alice'), 'alice', { hostName: 'Principal' }));
  });

  test('host must join + reserve the code in the same batch', async () => {
    await assertFails(createClass(as('alice'), 'alice', { skip: ['member'] }));
    await assertFails(createClass(as('alice'), 'alice', { skip: ['code'] }));
  });

  test('cannot hijack an existing join code', async () => {
    await seedClass({ status: 'lobby', code: 'ABC234' });
    await assertFails(createClass(as('alice'), 'alice', { code: 'ABC234' }));
  });

  test('bad codes and class names are rejected', async () => {
    await assertFails(createClass(as('alice'), 'alice', { code: 'abc234' }));
    await assertFails(createClass(as('alice'), 'alice', { code: 'ABC10O' }));
    await assertFails(createClass(as('alice'), 'alice', { name: '<img src=x onerror=alert(1)>' }));
    await assertFails(createClass(as('alice'), 'alice', { name: 'x'.repeat(41) }));
  });
});

// ==================================================================
describe('joining', () => {
  test('anyone verified can look up a code, but not list codes', async () => {
    await seedClass({ status: 'lobby' });
    await assertSucceeds(getDoc(doc(as('zed'), 'joinCodes/ABC234')));
    await assertFails(getDoc(doc(as('zed', { verified: false }), 'joinCodes/ABC234')));
    await assertFails(getDocs(collection(as('zed'), 'joinCodes')));
  });

  test('can join a lobby with the right code', async () => {
    const s = await seedClass({ status: 'lobby', members: ['host'] });
    await assertSucceeds(join(as('alice'), 'alice', s));
  });

  test('wrong code, wrong name, or someone else\'s seat = denied', async () => {
    const s = await seedClass({ status: 'lobby', members: ['host'] });
    await assertFails(join(as('alice'), 'alice', s, { code: 'ZZZ999' }));
    await assertFails(join(as('alice'), 'alice', s, { displayName: 'Bob' }));
    await assertFails(join(as('alice'), 'bob', s));
    await assertFails(join(as('alice'), 'alice', s, { role: 'host' }));
    await assertFails(join(as('alice'), 'alice', s, { tone: 99 }));
  });

  test('cannot join once the class has started', async () => {
    const s = await seedClass({ status: 'live', members: ['host'] });
    await assertFails(join(as('alice'), 'alice', s));
  });

  test('kicked people cannot rejoin', async () => {
    const s = await seedClass({ status: 'lobby', members: ['host'], kicked: ['alice'] });
    await assertFails(join(as('alice'), 'alice', s));
  });

  test('unverified users cannot join', async () => {
    const s = await seedClass({ status: 'lobby', members: ['host'] });
    await assertFails(join(as('alice', { verified: false }), 'alice', s));
  });

  test('membership index cannot be faked', async () => {
    const s = await seedClass({ status: 'lobby', members: ['host'] });
    await assertFails(setDoc(doc(as('alice'), `users/alice/memberships/${s.id}`), {
      className: 'Period 3 Chem', role: 'member', revealAt: s.revealAt, expireAt: s.expireAt,
      joinedAt: serverTimestamp(),
    }));
    await assertFails(getDocs(collection(as('bob'), 'users/alice/memberships')));
  });

  test('outsiders cannot read the class or roster; members can', async () => {
    await seedClass();
    await assertFails(getDoc(doc(as('zed'), 'classes/class1')));
    await assertFails(getDocs(collection(as('zed'), 'classes/class1/members')));
    await assertFails(getDocs(collection(as('zed'), 'classes')));
    await assertSucceeds(getDoc(doc(as('alice'), 'classes/class1')));
    await assertSucceeds(getDocs(collection(as('alice'), 'classes/class1/members')));
  });
});

// ==================================================================
describe('lobby: host controls', () => {
  test('host can kick (and ban) a member', async () => {
    await seedClass({ status: 'lobby' });
    const fs = as('host');
    const b = writeBatch(fs);
    b.delete(doc(fs, 'classes/class1/members/eve'));
    b.update(doc(fs, 'classes/class1'), { kicked: arrayUnion('eve') });
    await assertSucceeds(b.commit());
  });

  test('members cannot kick each other or edit the kicked list', async () => {
    await seedClass({ status: 'lobby' });
    await assertFails(deleteDoc(doc(as('alice'), 'classes/class1/members/bob')));
    await assertFails(updateDoc(doc(as('alice'), 'classes/class1'), { kicked: arrayUnion('bob') }));
  });

  test('a member can leave the lobby', async () => {
    await seedClass({ status: 'lobby' });
    await assertSucceeds(deleteDoc(doc(as('alice'), 'classes/class1/members/alice')));
  });

  test('the host cannot just walk out of their own lobby (they cancel instead)', async () => {
    await seedClass({ status: 'lobby' });
    await assertFails(deleteDoc(doc(as('host'), 'classes/class1/members/host')));
  });

  test('nobody can leave or be kicked once live', async () => {
    await seedClass({ status: 'live' });
    await assertFails(deleteDoc(doc(as('alice'), 'classes/class1/members/alice')));
    await assertFails(deleteDoc(doc(as('host'), 'classes/class1/members/alice')));
  });

  test('host can start; others cannot', async () => {
    await seedClass({ status: 'lobby' });
    await assertFails(updateDoc(doc(as('alice'), 'classes/class1'), { status: 'live', startedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as('host'), 'classes/class1'), { status: 'live', startedAt: serverTimestamp() }));
  });

  test('only the host can retire an active join code (when starting)', async () => {
    await seedClass({ status: 'lobby' });
    await assertFails(deleteDoc(doc(as('alice'), 'joinCodes/ABC234')));
    const fs = as('host');
    const b = writeBatch(fs);
    b.update(doc(fs, 'classes/class1'), { status: 'live', startedAt: serverTimestamp() });
    b.delete(doc(fs, 'joinCodes/ABC234'));
    await assertSucceeds(b.commit());
  });

  test('the reveal date can NEVER be moved', async () => {
    await seedClass({ status: 'lobby' });
    const fs = as('host');
    const soon = Timestamp.fromMillis(Date.now() + 60 * 1000);
    await assertFails(updateDoc(doc(fs, 'classes/class1'), { revealAt: soon }));
    await assertFails(updateDoc(doc(fs, 'classes/class1'), { status: 'live', startedAt: serverTimestamp(), revealAt: soon }));
    await assertFails(updateDoc(doc(fs, 'classes/class1'), { expireAt: Timestamp.fromMillis(Date.now() + 99 * DAY) }));
    await assertFails(updateDoc(doc(fs, 'classes/class1'), { name: 'Renamed' }));
  });

  test('a live class cannot go back to lobby or be deleted by the host', async () => {
    await seedClass({ status: 'live' });
    await assertFails(updateDoc(doc(as('host'), 'classes/class1'), { status: 'lobby' }));
    await assertFails(deleteDoc(doc(as('host'), 'classes/class1')));
  });

  test('host can cancel a lobby', async () => {
    await seedClass({ status: 'lobby', members: ['host'] });
    await assertSucceeds(deleteDoc(doc(as('host'), 'joinCodes/ABC234')));
    await assertSucceeds(deleteDoc(doc(as('host'), 'classes/class1')));
    await assertSucceeds(deleteDoc(doc(as('host'), 'classes/class1/members/host')));
  });

  test('cannot start after the reveal date has passed', async () => {
    await seedClass({ status: 'lobby', revealIn: -60 * 1000 });
    await assertFails(updateDoc(doc(as('host'), 'classes/class1'), { status: 'live', startedAt: serverTimestamp() }));
  });
});

// ==================================================================
describe('picking (before reveal)', () => {
  test('you can pick a classmate', async () => {
    const s = await seedClass();
    await assertSucceeds(pick(as('alice'), 'alice', 'bob', s));
  });

  test('you can check your own (empty) pick slot', async () => {
    const s = await seedClass();
    await assertSucceeds(getDoc(pickRef(as('alice'), s, 'alice')));
  });

  test('you can change and remove your pick', async () => {
    const s = await seedClass({ picks: { alice: 'bob' } });
    const fs = as('alice');
    await assertSucceeds(updateDoc(pickRef(fs, s, 'alice'), { target: 'carol', updatedAt: serverTimestamp() }));
    await assertSucceeds(getDoc(pickRef(fs, s, 'alice')));
    await assertSucceeds(unpick(fs, 'alice', s));
  });

  test('picks are impossible in the lobby', async () => {
    const s = await seedClass({ status: 'lobby' });
    await assertFails(pick(as('alice'), 'alice', 'bob', s));
  });

  test('no picking yourself, outsiders, or garbage', async () => {
    const s = await seedClass();
    await assertFails(pick(as('alice'), 'alice', 'alice', s));
    await assertFails(pick(as('alice'), 'alice', 'zed', s));
    await assertFails(pick(as('alice'), 'alice', '../../users/bob', s));
  });

  test('no picking on someone else\'s behalf', async () => {
    const s = await seedClass();
    await assertFails(pick(as('alice'), 'bob', 'alice', s));
  });

  test('outsiders cannot pick', async () => {
    const s = await seedClass({ members: ['host', 'bob'] });
    await assertFails(pick(as('alice'), 'alice', 'bob', s));
  });

  test('the counter cannot be skipped or abused', async () => {
    const s = await seedClass();
    await assertFails(pick(as('alice'), 'alice', 'bob', s, { counter: 0 }));
    await assertFails(pick(as('alice'), 'alice', 'bob', s, { counter: 2 }));
    await assertFails(updateDoc(doc(as('alice'), 'classes/class1'), { pickCount: increment(1) }));
    await assertFails(updateDoc(doc(as('alice'), 'classes/class1'), { pickCount: 0 }));
  });

  test('only one pick per person: a second "create" is just an update', async () => {
    const s = await seedClass({ picks: { alice: 'bob' } });
    await assertFails(pick(as('alice'), 'alice', 'carol', s));
  });

  test('NOBODY can read your pick before the reveal: not even if it\'s mutual', async () => {
    const s = await seedClass({ picks: { alice: 'bob', bob: 'alice' } });
    await assertFails(getDoc(pickRef(as('bob'), s, 'alice')));
    await assertFails(getDoc(pickRef(as('host'), s, 'alice')));
    await assertFails(getDoc(pickRef(as('carol'), s, 'alice')));
  });

  test('picks can never be listed or queried', async () => {
    const s = await seedClass({ picks: { alice: 'bob' } });
    await assertFails(getDocs(collection(as('host'), 'classes/class1/picks')));
    await assertFails(getDocs(query(collection(as('bob'), 'classes/class1/picks'), where('target', '==', 'bob'))));
  });

  test('no editing someone else\'s pick', async () => {
    const s = await seedClass({ picks: { alice: 'bob' } });
    await assertFails(updateDoc(pickRef(as('carol'), s, 'alice'), { target: 'carol', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(pickRef(as('carol'), s, 'alice')));
  });

  test('cannot sneak extra fields into a pick', async () => {
    const s = await seedClass();
    const fs = as('alice');
    const b = writeBatch(fs);
    b.set(pickRef(fs, s, 'alice'), { target: 'bob', updatedAt: serverTimestamp(), expireAt: s.expireAt, note: 'hi' });
    b.update(doc(fs, 'classes/class1'), { pickCount: increment(1) });
    await assertFails(b.commit());
  });
});

// ==================================================================
describe('reveal day', () => {
  const revealed = { revealIn: -60 * 1000 };

  test('MUTUAL: both sides can read each other\'s pick', async () => {
    const s = await seedClass({ ...revealed, picks: { alice: 'bob', bob: 'alice' } });
    await assertSucceeds(getDoc(pickRef(as('alice'), s, 'bob')));
    await assertSucceeds(getDoc(pickRef(as('bob'), s, 'alice')));
  });

  test('ONE-SIDED: alice -> bob, bob -> carol. Alice learns nothing', async () => {
    const s = await seedClass({ ...revealed, picks: { alice: 'bob', bob: 'carol' } });
    await assertFails(getDoc(pickRef(as('alice'), s, 'bob')));
  });

  test('SECRET ADMIRER STAYS SECRET: carol -> alice, alice -> bob', async () => {
    const s = await seedClass({ ...revealed, picks: { carol: 'alice', alice: 'bob' } });
    await assertFails(getDoc(pickRef(as('alice'), s, 'carol')));
  });

  test('you can still see your own pick after the reveal', async () => {
    const s = await seedClass({ ...revealed, picks: { alice: 'bob' } });
    await assertSucceeds(getDoc(pickRef(as('alice'), s, 'alice')));
  });

  test('no pick = see nothing', async () => {
    const s = await seedClass({ ...revealed, picks: { carol: 'dave' } });
    await assertFails(getDoc(pickRef(as('dave'), s, 'carol')));
  });

  test('host and bystanders cannot see a mutual match', async () => {
    const s = await seedClass({ ...revealed, picks: { alice: 'bob', bob: 'alice' } });
    await assertFails(getDoc(pickRef(as('host'), s, 'alice')));
    await assertFails(getDoc(pickRef(as('carol'), s, 'bob')));
    await assertFails(getDocs(collection(as('alice'), 'classes/class1/picks')));
  });

  test('picks are frozen: no switching to probe other people', async () => {
    const s = await seedClass({ ...revealed, picks: { alice: 'bob', carol: 'alice' } });
    const fs = as('alice');
    await assertFails(updateDoc(pickRef(fs, s, 'alice'), { target: 'carol', updatedAt: serverTimestamp() }));
    await assertFails(unpick(fs, 'alice', s));
    await assertFails(pick(as('dave'), 'dave', 'alice', s));
  });

  test('outsiders cannot read even a mutual pick', async () => {
    const s = await seedClass({ ...revealed, picks: { alice: 'bob', bob: 'alice' } });
    await assertFails(getDoc(pickRef(as('zed'), s, 'alice')));
  });
});

// ==================================================================
describe('3 days after reveal', () => {
  const expired = { revealIn: -4 * DAY };

  test('the class is gone: nothing readable, not even your own pick', async () => {
    const s = await seedClass({ ...expired, picks: { alice: 'bob', bob: 'alice' } });
    await assertFails(getDoc(doc(as('alice'), 'classes/class1')));
    await assertFails(getDoc(pickRef(as('alice'), s, 'alice')));
    await assertFails(getDoc(pickRef(as('alice'), s, 'bob')));
  });

  test('members can sweep everything away', async () => {
    const s = await seedClass({ ...expired, picks: { alice: 'bob', bob: 'alice' } });
    const fs = as('carol');
    await assertSucceeds(deleteDoc(pickRef(fs, s, 'alice')));
    await assertSucceeds(deleteDoc(pickRef(fs, s, 'bob')));
    await assertSucceeds(deleteDoc(pickRef(fs, s, 'dave')));
    await assertSucceeds(deleteDoc(doc(fs, 'classes/class1/members/alice')));
    await assertSucceeds(deleteDoc(doc(fs, 'classes/class1')));
    await assertSucceeds(deleteDoc(doc(fs, 'classes/class1/members/carol')));
  });

  test('outsiders cannot sweep', async () => {
    const s = await seedClass({ ...expired, picks: { alice: 'bob' } });
    await assertFails(deleteDoc(pickRef(as('zed'), s, 'alice')));
    await assertFails(deleteDoc(doc(as('zed'), 'classes/class1')));
  });

  test('before expiry, deleting others\' picks is blocked (no existence probing)', async () => {
    const s = await seedClass({ picks: { alice: 'bob' } });
    await assertFails(deleteDoc(pickRef(as('carol'), s, 'alice')));
    await assertFails(deleteDoc(pickRef(as('carol'), s, 'dave')));
  });
});

// ==================================================================
describe('reports & admins', () => {
  test('members can report; nobody but admins can read reports', async () => {
    await seedClass();
    const fs = as('alice');
    const ref = doc(collection(fs, 'reports'));
    await assertSucceeds(setDoc(ref, {
      reporterUid: 'alice', classId: 'class1', className: 'Period 3 Chem',
      targetUid: 'eve', targetName: 'Eve', reason: 'impersonation',
      details: 'Not a real student', createdAt: serverTimestamp(),
    }));
    await assertFails(getDoc(doc(as('alice'), `reports/${ref.id}`)));
    await assertFails(getDocs(collection(as('host'), 'reports')));
  });

  test('cannot report on behalf of others or for classes you are not in', async () => {
    await seedClass({ members: ['host', 'alice'] });
    await assertFails(setDoc(doc(collection(as('alice'), 'reports')), {
      reporterUid: 'bob', classId: 'class1', reason: 'spam', details: '', createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(collection(as('bob'), 'reports')), {
      reporterUid: 'bob', classId: 'class1', reason: 'spam', details: '', createdAt: serverTimestamp(),
    }));
  });

  test('nobody can make themselves an admin', async () => {
    await assertFails(setDoc(doc(as('alice'), 'admins/alice'), { role: 'admin' }));
  });

  test('admins can read reports but still cannot read picks', async () => {
    const s = await seedClass({ revealIn: -60 * 1000, picks: { alice: 'bob', bob: 'alice' } });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'admins/mod'), { since: Timestamp.now() });
    });
    await assertSucceeds(getDocs(collection(as('mod'), 'reports')));
    await assertFails(getDoc(pickRef(as('mod'), s, 'alice')));
    await assertFails(getDocs(collection(as('mod'), 'classes/class1/picks')));
  });
});
