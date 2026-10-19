---
name: release
description: Ship web app changes as ONE pull request from an accumulation branch (e.g. "proximo") instead of a deploy per change — collect the commits there, run a release check, open or update a single PR with a grouped summary, follow CI and fix what fails, share the preview link, and warn when a public image or file changed without a new name (browsers keep the old one cached for weeks). Use it whenever the user says "subilo", "hacé el release", "abrí el PR", "publicá", "mandalo a producción", "juntá estos cambios", asks to deploy or ship, or has finished a change in a repo whose merges to main deploy automatically — even if they never say "release".
---

# Release

Merging to the default branch usually deploys. If every small change goes
straight there, every change is a production deploy, a CI run and a
cache refresh for users. The pattern this skill follows instead:

```
small change → commit on the accumulation branch (no deploy)
             → small change → commit …
ready        → ONE PR: accumulation branch → default branch
             → CI + preview URL → fix until green → user merges → one deploy
```

You drive it end to end: the user should only have to look at the preview
and say "merge".

## 1. Learn how this repo ships

Read before acting; most of it is in `.github/workflows/` and the host config.

- **Default branch** — `git symbolic-ref refs/remotes/origin/HEAD` (often
  `main` or `master`).
- **What happens on merge** — find the workflow with `on: push: branches:
  [<default>]`. That is the production deploy. Note what else it does
  (database rules, migrations): they ship with the merge too.
- **Accumulation branch** — reuse the repo's convention. Look at recent
  merge commits (`git log --merges --oneline -20 origin/<default>`): "Merge
  pull request #95 from user/proximo" means the branch is `proximo`. If
  there is none, use `proximo` and say so once.
- **CI** — which checks run on pull requests and what they run (lint, test,
  build, rules tests). You will run the same commands locally.
- **Preview** — a job that deploys PRs to a temporary URL (Firebase
  `action-hosting-deploy` with a `channelId`, Vercel/Netlify bots, a
  `deployments` environment). Note its expiry and caveats written in the
  workflow comments (e.g. "the preview uses the production database").
  Host details: `references/hosts.md`.
- **Cache policy for public files** — `firebase.json` / `vercel.json` /
  `_headers`. The release check reads it for you.

## 2. Put the changes on the accumulation branch

```bash
git fetch origin <default> <accum>
```

- **Branch exists and its last PR is still open** → add commits to it and
  push. The open PR updates itself; do not open another.
- **Branch exists but its PR was merged** → that PR is finished. Restart the
  branch from the default branch, keeping any commits that were not merged:
  `git checkout -B <accum> origin/<default>` then cherry-pick/rebase the
  unmerged ones. Push with `--force-with-lease` (only merged history is
  being replaced).
- **No branch** → `git checkout -b <accum> origin/<default>`.

Never commit or push directly to the default branch: that is exactly the
per-change deploy this skill avoids. One focused commit per change, with a
message that will read well in the PR summary (`fix(ranking): …`,
`feat: …` group nicely).

While the user is still collecting changes ("después sumo otra cosa"),
push to the branch and stop there: pushes to it do not deploy.

## 3. Release check

```bash
node <skill-dir>/scripts/release_check.mjs --base origin/<default>
```

(`--json` for machine-readable output.) It lists the commits grouped by
type or area, drafts the PR body from `templates/pr-body.md`, and warns
about:

- **Cached public files changed in place** — e.g. `public/logo.svg`
  modified, served with `max-age=2592000`: everyone who opened the app in
  the last 30 days keeps seeing the old logo, and the new one only shows up
  for new visitors. Build tools hash files they bundle (`/assets/x.3f9a.js`),
  but files in `public/` keep their name. The fix is a new file name
  (`logo-v2.svg`, or bump `-v2` → `-v3`) and updating every reference the
  check lists (HTML `<link>`s, manifest icons, PWA `includeAssets`, CSS,
  components). Do it on the accumulation branch, mention it in the PR, and
  tell the user in plain words: "cambiaste el logo sin cambiarle el nombre;
  los que ya entraron lo seguirían viendo viejo hasta 30 días: lo renombré a
  logo-v2.svg". Social preview images (`og:image`) are cached by WhatsApp,
  Facebook, etc. regardless of headers: they need the new name too.
- **Renamed/deleted public files still referenced** by the old name —
  a broken icon or 404 in production.
- **Local or generated files** in the diff (`.env*`, `dist/`, `.DS_Store`) —
  remove them from the branch.

## 4. Verify locally, then push

Run what CI runs (from step 1), in the same order: typically `npm ci`,
lint, tests, build, plus special suites (e.g. `npm run test:rules`). A
red CI costs a cycle and the user's trust; a local run costs a minute. If a
suite cannot run here (no Java for an emulator, no secrets), say which one
was left to CI.

## 5. One PR

If an open PR from the accumulation branch exists, update its body. If not,
open one: accumulation branch → default branch. Follow the repo's PR
template if there is one (`.github/pull_request_template.md`), otherwise
the drafted body. Write the summary in the user's language and for a
human reader: what changes for the people who use the app, not a list of
files. Title: the repo's convention from recent PRs, else a short summary
of the batch.

Opening a PR is visible to others: if the user did not ask to ship
(they only said "commit this"), push to the accumulation branch and ask
before opening it. "Subilo", "hacé el release", "abrí el PR" are a yes.

Use whatever GitHub access the session has: the GitHub MCP tools
(`create_pull_request`, `pull_request_read`, check runs and job logs), or
`gh pr create` / `gh pr checks` / `gh run view --log-failed`.

## 6. Follow CI until it is green

If the session can subscribe to PR activity, subscribe and wait for events
instead of polling. Otherwise check the PR's check runs after each push.

On a failure:

1. Read the failing job's log (the step and the first real error, not the
   last line).
2. Reproduce it locally with the same command. If it passes locally, look
   for what differs: Node version, a missing env var, a file not committed
   (`git status`), case-sensitive paths on Linux.
3. Fix the cause on the accumulation branch, rerun locally, push. The PR
   picks it up.
4. Repeat until green. Never skip, disable or loosen a test to get there.
   A flaky failure gets at most one re-run, and only after a fix attempt
   showed it is not caused by the change.

If the failure is not caused by this batch (it is red on the default
branch too), say so with the evidence and the failing check's name.

## 7. Preview link

When the preview job finishes, get the URL — usually a bot comment on the
PR (patterns per host in `references/hosts.md`) or the deployment's
environment URL. Give it to the user with what to look at ("abrilo en el
celular: Inicio y Ranking cambiaron"), its expiry, and any caveat from the
workflow (shared production data, auth domains that do not work on preview
URLs). If the user has the responsive-check skill, offer to run it against
the preview URL.

## 8. Merge and after

Merge only when the user says so; remind them it deploys to production and
what else rides along (e.g. "también publica las reglas de Firestore").
After the merge, watch the deploy workflow to its end and report it. The
accumulation branch is then done: the next change restarts it from the
default branch (step 2).

## Report

Keep the user's view short. After opening/updating the PR:

```
**Release #96 abierto** — proximo → master · 7 commits
- Ranking: racha visible, flechas de movimiento
- Arreglos: chips de banca centrados, contraste de avatares
⚠️ public/logo.svg cambió sin cambiar de nombre (caché 30 días): lo renombré a logo-v2.svg y actualicé index.html y el manifest.
CI: lint ✓ tests ✓ build ✓ reglas ⏳
```

Then one line per event that matters: CI green (or what failed and what you
pushed), the preview link, the merge and the deploy result.
