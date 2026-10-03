# Likewise

**Secret crush matching for your class. Mutual or nothing.**

One student hosts a class and picks a reveal date. Classmates join with a 6-letter code. The host checks the roster and presses Start. Everyone secretly picks one person. On reveal day, if your crush picked you too, you both see **"It's mutual."** If not, you see **"No mutual match this round."** and nobody ever finds out. Three days later the class is locked and wiped.

- **Frontend:** plain HTML/CSS/JS (no build step), hosted on **GitHub Pages**
- **Backend:** **Firebase Authentication** (email/password) + **Cloud Firestore**
- **Works on the free Firebase Spark plan.** No Cloud Functions needed. The matching is enforced by Firestore security rules.

---

## How the privacy works (the short version)

Each pick is stored at `classes/{classId}/picks/{yourUid}` with one field: `target`.

- Nobody can **list** or **query** picks. Ever.
- You can read **your own** pick.
- You can read **someone else's** pick only if **all** of these are true:
  1. the reveal time has passed (server clock, can't be faked),
  2. their pick points at **you**,
  3. **your** pick points at **them**.

So a read only succeeds when it's mutual. One pick per person, frozen at reveal, means nobody can switch picks to "probe" classmates. The reveal date can't be moved, not even by the host. All of this is enforced on Google's servers by [`firestore.rules`](firestore.rules) and covered by 65 automated attack tests in [`tests/rules.test.mjs`](tests/rules.test.mjs).

---

## Folder structure

```
index.html              Landing page
auth.html               Sign in / create account / forgot password
app.html                The app (classes, host, join, pick, results, account)
action.html             Branded handler for email links (verify / reset password)
privacy.html, terms.html, 404.html
manifest.webmanifest    "Add to home screen" support
assets/
  css/                  base.css (design system), landing.css, app.css
  js/
    config.js           Firebase config + settings  ← edit this
    firebase.js         Firebase setup (+ local emulator mode)
    db.js               Every Firestore read/write (mirrors the rules)
    app.js              App shell + router
    views/              Dashboard, create, join, class, results, account…
    motion.js           Animations (scroll reveals, cursor, tilt, parallax)
  img/                  Logo, icons, social preview image
firestore.rules         Security rules (deploy these!)
firestore.indexes.json  Index config (no custom indexes needed)
firebase.json           For the Firebase CLI + local emulators
tests/rules.test.mjs    Security rules test suite
```

---

## Setup

Follow the **Firebase Setup** document step by step. In short:

1. In Firebase: enable **Email/Password** sign-in and turn on **email enumeration protection**.
2. Create a **Firestore** database (production mode).
3. Paste [`firestore.rules`](firestore.rules) into **Firestore → Rules** and publish.
4. Push this folder to a GitHub repo and enable **GitHub Pages** (branch `main`, folder `/root`).
5. Add `YOUR-USERNAME.github.io` to **Authentication → Settings → Authorized domains**.
6. (Recommended) Point the email **action URL** at `action.html`, restrict your API key, and turn on App Check.
7. (Recommended) Make verification emails land in the inbox instead of Spam: **Authentication → Templates → SMTP settings** with a Gmail App Password (setup guide, Step 5b), then set `emailFrom` in `assets/js/config.js`.

---

## Running it on your computer (optional)

**Don't double-click `index.html`.** Browsers block the sign-in and database code on pages opened as files (`file://`), so you can't create accounts that way. Use GitHub Pages, or a tiny local server:

```bash
npx serve
```

Then open http://localhost:3000. On `localhost` the site talks to your **real** Firebase project, exactly like the live site (`localhost` is already an authorized domain).

### Testing with fake data instead (Firebase Emulator Suite)

Requirements: Node.js 20+ and Java 21+.

```bash
npm install
```

```bash
npm run emulators
```

Then in a second terminal:

```bash
npm run serve
```

Open http://localhost:5173/?emulator. The `?emulator` switch is remembered for that browser tab, and `?live` switches back to the real project. The Emulator UI (fake inboxes, users, data) is at http://127.0.0.1:4000.

### Run the security tests

```bash
npm test
```

### Deploy rules from the command line (instead of copy-pasting)

```bash
npx firebase login
```

```bash
npm run deploy:rules
```

---

## Customizing

- **Settings** (minimum people to start, reveal limits, analytics, App Check key): `assets/js/config.js`
- **Colors & fonts:** the `:root` tokens at the top of `assets/css/base.css`
- **Moderators:** create a document `admins/{their-uid}` in the Firestore console. They can then read `reports`. Admins still **cannot** read picks.

## License

Your project, your call. Add a license if you want others to reuse it.
