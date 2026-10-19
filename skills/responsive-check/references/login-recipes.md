# Getting past the login

Try these in order; the first that works is usually the cheapest to keep.

## 1. A demo or sandbox mode in the app

Search the source before asking for credentials:

```bash
grep -rniE "demo|sandbox|mock(User|Auth)|guest" src --include=*.{js,jsx,ts,tsx} | head -40
grep -rn "localStorage.setItem" src | head -40
```

Typical shapes:

- Firebase apps that run in **demo mode when Firebase is not configured**
  (`npm run dev` without keys) and read a fake user from localStorage.
  Example from a React + Vite + Firebase app:

  ```json
  "auth": { "localStorage": { "padel.demoUser": { "uid": "demo-user", "displayName": "Martín", "demo": true } } }
  ```

- A `?demo=1` / `?sandbox=1` query flag: put it in each route (`"/ranking?sandbox=1"`)
  or set the flag the app stores in localStorage.
- An env var (`VITE_DEMO=1`, `NEXT_PUBLIC_MOCK_AUTH=1`): prefix the start
  command, e.g. `"command": "VITE_DEMO=1 npm run dev"`.

Demo data uses invented names, which also keeps screenshots shareable.

## 2. A token or session the user gives you

- Cookie session: `auth.cookies: [{ "name": "session", "value": "..." }]`.
- JWT in storage: `auth.localStorage: { "token": "..." }`.

Never commit these values; keep the config with secrets out of the repo
(`qa-report/` is a good place, and should be gitignored).

## 3. A real login form

Write a small `auth.script`:

```js
// login.mjs
export default async function login(page) {
  await page.goto('http://localhost:3000/login')
  await page.fill('input[type=email]', process.env.QA_EMAIL)
  await page.fill('input[type=password]', process.env.QA_PASSWORD)
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'))
}
```

It runs once per viewport × theme; the session then carries over to every
route in that context.

## How to tell it did not work

The report warns when a route ends on a different path (`/ranking redirected
to /login`). Screenshots of a login page at every route mean the same thing.
Fix the setup and rerun; do not report layout findings from the wrong page.
