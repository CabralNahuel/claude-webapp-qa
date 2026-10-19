#!/usr/bin/env node
// Builds a throwaway web-app repo with a local bare "origin" for testing the
// release skill without GitHub.
//
//   node make_repo.mjs <dir> <scenario>
//
// Scenarios:
//   ship        master deploys on push; history shows the "proximo" convention;
//               the working copy has uncommitted changes, including
//               public/logo.svg edited in place (cached 30 days).
//   ci-fail     origin/proximo has a commit that breaks `npm test`; ci.log has
//               the CI output.
//   after-merge proximo was already merged into master; the working copy has
//               a new uncommitted fix.
//   ship-hard   like ship, plus og.png edited in place, the favicon renamed by
//               hand with references left behind, and an untracked .env.local.
//   clean-ok    proximo renames the favicon and updates every reference
//               (the release check should find nothing).
//
// Creates <dir>/origin.git (bare) and <dir>/app (clone).

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [dir, scenario = 'ship'] = process.argv.slice(2)
if (!dir) {
  console.error('usage: node make_repo.mjs <dir> <ship|ci-fail|after-merge|clean-ok>')
  process.exit(2)
}
const root = path.resolve(dir)
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root, { recursive: true })
const origin = path.join(root, 'origin.git')
const app = path.join(root, 'app')

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@example.com',
  GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@example.com',
}
const git = (...args) => execFileSync('git', ['-C', app, ...args], { env, stdio: 'pipe' }).toString().trim()
const write = (rel, content) => {
  const file = path.join(app, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

execFileSync('git', ['init', '-q', '--bare', '-b', 'master', origin])
execFileSync('git', ['init', '-q', '-b', 'master', app])
git('remote', 'add', 'origin', origin)

// ---- base app
write('package.json', JSON.stringify({
  name: 'demo-app', private: true, type: 'module',
  scripts: { lint: 'node scripts/lint.mjs', test: 'node --test', build: 'node scripts/build.mjs' },
}, null, 2) + '\n')
write('index.html', `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <link rel="icon" href="/favicon-v1.png">
  <meta property="og:image" content="https://demo.example/og.png">
  <title>Demo</title>
</head>
<body><img src="/logo.svg" alt="Demo"><script type="module" src="/src/app.js"></script></body>
</html>
`)
write('public/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#1f7fcc"/></svg>\n')
write('public/favicon-v1.png', 'PNG-v1\n')
write('public/og.png', 'PNG-og\n')
write('public/manifest.webmanifest', JSON.stringify({ name: 'Demo', icons: [{ src: '/favicon-v1.png', sizes: '96x96', type: 'image/png' }] }, null, 2) + '\n')
write('src/score.js', `// Points for a match: winners get the base points plus the bonus, rounded.
export function points(base, bonus) {
  return Math.round(base + bonus)
}
`)
write('src/app.js', `import { points } from './score.js'
document.title = 'Demo · ' + points(10, 2.5)
`)
write('test/score.test.js', `import test from 'node:test'
import assert from 'node:assert/strict'
import { points } from '../src/score.js'

test('adds the bonus and rounds', () => {
  assert.equal(points(10, 2.5), 13)
  assert.equal(points(7, 0.4), 7)
})
`)
write('scripts/lint.mjs', `// Fails on console.log left in src/.
import fs from 'node:fs'
let bad = 0
for (const f of fs.readdirSync('src')) {
  if (/console\\.log/.test(fs.readFileSync('src/' + f, 'utf8'))) { console.error('lint: console.log in src/' + f); bad++ }
}
process.exit(bad ? 1 : 0)
`)
write('scripts/build.mjs', `import fs from 'node:fs'
fs.rmSync('dist', { recursive: true, force: true })
fs.cpSync('public', 'dist', { recursive: true })
fs.cpSync('src', 'dist/src', { recursive: true })
fs.copyFileSync('index.html', 'dist/index.html')
console.log('built dist/')
`)
write('.gitignore', 'dist/\nnode_modules/\n')
write('firebase.json', JSON.stringify({
  hosting: {
    public: 'dist',
    headers: [
      { source: '**', headers: [{ key: 'Cache-Control', value: 'no-cache, max-age=0, must-revalidate' }] },
      { source: '**/*.@(webp|png|svg|jpg|jpeg|ico)', headers: [{ key: 'Cache-Control', value: 'public, max-age=2592000' }] },
    ],
  },
}, null, 2) + '\n')
write('.github/workflows/ci.yml', `name: CI
on:
  pull_request:
  push:
    branches-ignore: [master]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm run lint
      - run: npm test
      - run: npm run build
  # Preview per PR. Same production data: for looking at screens only.
  preview:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run build
      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: \${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: \${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          channelId: pr-\${{ github.event.number }}
          expires: 7d
`)
write('.github/workflows/deploy.yml', `name: Deploy (master)
# Every push to master is a production deploy.
on:
  push:
    branches: [master]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test && npm run build
      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: \${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: \${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          channelId: live
`)
git('add', '-A')
git('commit', '-qm', 'Initial app')

// History showing the accumulation-branch convention.
git('checkout', '-qb', 'proximo')
write('src/app.js', `import { points } from './score.js'
document.title = 'Demo · ' + points(10, 2.5) + ' pts'
`)
git('commit', '-qam', 'feat: show points in the title')
git('checkout', '-q', 'master')
git('merge', '-q', '--no-ff', 'proximo', '-m', 'Merge pull request #12 from acme/proximo')
git('push', '-q', 'origin', 'master')

if (scenario === 'ship') {
  git('branch', '-qD', 'proximo')
  // Uncommitted work: a new logo color (edited in place) and a copy tweak.
  write('public/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#e63946"/></svg>\n')
  write('src/app.js', `import { points } from './score.js'
document.title = 'Demo · ' + points(10, 2.5) + ' puntos'
`)
} else if (scenario === 'ship-hard') {
  git('branch', '-qD', 'proximo')
  // A realistic batch: new brand color everywhere, a favicon renamed by hand
  // (references left behind), and a local secrets file lying around.
  write('public/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#e63946"/></svg>\n')
  write('public/og.png', 'PNG-og-red\n')
  fs.renameSync(path.join(app, 'public/favicon-v1.png'), path.join(app, 'public/favicon-v2.png'))
  write('public/favicon-v2.png', 'PNG-v2-red\n')
  write('src/app.js', `import { points } from './score.js'
document.title = 'Demo · ' + points(10, 2.5) + ' puntos'
`)
  write('.env.local', 'VITE_MAPS_KEY=AIzaFAKE-local-only-key\n')
} else if (scenario === 'ci-fail') {
  git('branch', '-qD', 'proximo')
  git('checkout', '-qb', 'proximo')
  write('src/score.js', `// Points for a match: winners get the base points plus the bonus, rounded.
export function points(base, bonus) {
  return Math.floor(base + bonus)
}
`)
  git('commit', '-qam', 'refactor: simplify points rounding')
  git('push', '-q', 'origin', 'proximo')
  let log = ''
  try {
    execFileSync('npm', ['test'], { cwd: app, stdio: 'pipe' })
  } catch (err) {
    log = String(err.stdout) + String(err.stderr)
  }
  fs.writeFileSync(path.join(root, 'ci.log'), `Run npm test\n${log}\nError: Process completed with exit code 1.\n`)
} else if (scenario === 'after-merge') {
  // Local proximo still points at the merged commit; the PR is done.
  write('src/app.js', `import { points } from './score.js'
// Fix: title used the wrong bonus.
document.title = 'Demo · ' + points(10, 4) + ' pts'
`)
} else if (scenario === 'clean-ok') {
  git('branch', '-qD', 'proximo')
  git('checkout', '-qb', 'proximo')
  git('mv', 'public/favicon-v1.png', 'public/favicon-v2.png')
  write('public/favicon-v2.png', 'PNG-v2\n')
  for (const rel of ['index.html', 'public/manifest.webmanifest']) {
    write(rel, fs.readFileSync(path.join(app, rel), 'utf8').replace('favicon-v1.png', 'favicon-v2.png'))
  }
  git('commit', '-qam', 'feat: new favicon')
} else {
  console.error(`unknown scenario ${scenario}`)
  process.exit(2)
}
console.log(JSON.stringify({ origin, app, scenario }))
