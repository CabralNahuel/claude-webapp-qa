# Hosts: previews and caching

## Firebase Hosting

- **Preview**: `FirebaseExtended/action-hosting-deploy` with
  `channelId: pr-${{ github.event.number }}` (or no channelId on PRs) deploys
  a preview channel. The action comments on the PR:
  > Visit the preview URL for this PR (updated for commit abc123):
  > https://SITE--pr-96-xxxxxxxx.web.app
  Regex: `https://[a-z0-9-]+--[a-z0-9-]+\.web\.app` (also `.firebaseapp.com`).
  Channels expire (`expires: 7d`, default 7 days).
- **Production**: `channelId: live`, usually on push to the default branch.
- **Caveats**: preview channels talk to the same Firestore/Auth project as
  production unless the build points elsewhere. Google sign-in redirects may
  fail on preview domains not listed in Authentication → Settings → Authorized
  domains.
- **Cache**: `firebase.json` → `hosting.headers[]` with `source` globs
  (`**/*.@(png|svg)`) and `Cache-Control`. Later entries win. The CDN also
  caches: a deploy purges it, browsers are not purged.

## Vercel

- **Preview**: every push to a non-production branch gets a deployment; the
  Vercel bot comments with a table containing "Preview" and a URL like
  `https://PROJECT-git-BRANCH-TEAM.vercel.app` (stable per branch) and a
  per-commit URL. Also exposed as the GitHub deployment `environment_url`.
- **Cache**: `vercel.json` → `headers[]` with `source` (path-to-regexp) and
  `Cache-Control`. Files in `public/` default to `public, max-age=0,
  must-revalidate` unless configured — in-place changes are safe by default,
  not when someone added long max-age.

## Netlify

- **Preview**: "Deploy Preview" per PR; the bot comments
  `https://deploy-preview-96--SITE.netlify.app`.
- **Cache**: `_headers` file in the publish dir or `[[headers]]` in
  `netlify.toml`. Default for static files is `max-age=0, must-revalidate`.

## Cloudflare Pages

- **Preview**: per-branch `https://BRANCH.PROJECT.pages.dev` and per-commit
  `https://HASH.PROJECT.pages.dev`; the GitHub integration comments them.
- **Cache**: `_headers` file, same format as Netlify.

## GitHub Pages

- No PR previews out of the box. Cache is fixed at `max-age=600` (10 min):
  in-place changes appear quickly, renaming is not needed.

## Why rename instead of "clearing the cache"

`Cache-Control: max-age=N` lets every browser reuse its copy for N seconds
without asking the server. A deploy refreshes the CDN, but it cannot reach
into users' browsers. The only way to make them fetch the new image right
away is a URL they have never seen: a new file name (`logo-v2.svg`) or a
query string (`logo.svg?v=2`, weaker: some CDNs ignore it). Bundled assets
(`/assets/*.[hash].js`) already get a new name on every build; files in
`public/` do not.

Service workers (PWA) add a second cache: if the app precaches public files
(`vite-plugin-pwa` `includeAssets`, Workbox globs), list the new name there
too, or the old file keeps being served offline.
