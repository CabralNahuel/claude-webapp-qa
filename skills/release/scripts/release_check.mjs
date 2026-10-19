#!/usr/bin/env node
// release_check: everything that should be known before opening (or
// updating) the single release PR from the accumulation branch.
//
//   node release_check.mjs [--repo .] [--base origin/main] [--head HEAD] [--json]
//
// Reports:
//   - commits and changed files between base and head, grouped by area
//   - public files changed IN PLACE that browsers keep in cache (from the
//     host's Cache-Control headers): they need a new file name
//   - renamed/deleted public files still referenced by their old name
//   - a draft PR body (templates/pr-body.md filled in)
// Exit code is 0 even with warnings: it informs, it does not block.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = { repo: '.', head: 'HEAD' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') args.json = true
    else if (a === '--help') args.help = true
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i]
  }
  return args
}

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function tryGit(repo, ...args) {
  try {
    return git(repo, ...args)
  } catch {
    return null
  }
}

// The branch PRs go into: origin/HEAD if known, else main/master.
function defaultBase(repo) {
  const head = tryGit(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
  if (head) return head
  for (const b of ['origin/main', 'origin/master', 'main', 'master']) {
    if (tryGit(repo, 'rev-parse', '--verify', '--quiet', b)) return b
  }
  throw new Error('Could not find the base branch; pass --base.')
}

// ---------------------------------------------------------------- cache rules

// Minimal glob → RegExp for host header rules: **, *, ?, {a,b} and @(a|b).
function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') re += '('
    else if (c === '}') re += ')'
    else if (c === ',' && re.includes('(')) re += '|'
    else if (c === '@' && glob[i + 1] === '(') {
      re += '('
      i++
    } else if ('.+^$|()[]\\'.includes(c)) re += c === '|' || c === '(' || c === ')' ? c : '\\' + c
    else re += c
  }
  return new RegExp('^/?' + re.replace(/^\//, '') + '$')
}

function maxAgeOf(value) {
  if (!value) return null
  if (/no-store|no-cache/.test(value) && !/max-age=[1-9]/.test(value)) return 0
  const m = /(?:s-)?max-age=(\d+)/.exec(value)
  return m ? Number(m[1]) : null
}

// Returns { source, publicDir, rules: [{ pattern, maxAge, immutable }] }.
// Later rules win, as in Firebase Hosting.
function loadCacheRules(repo) {
  const rules = []
  let source = null
  let publicDir = null
  const fb = path.join(repo, 'firebase.json')
  if (fs.existsSync(fb)) {
    const conf = JSON.parse(fs.readFileSync(fb, 'utf8'))
    const hostings = [].concat(conf.hosting || [])
    for (const h of hostings) {
      for (const block of h.headers || []) {
        const cc = (block.headers || []).find((x) => x.key.toLowerCase() === 'cache-control')
        if (!cc) continue
        const pattern = block.source || block.glob || block.regex
        rules.push({
          pattern: block.regex ? new RegExp(block.regex) : globToRegExp(pattern),
          glob: pattern,
          maxAge: maxAgeOf(cc.value),
          immutable: /immutable/.test(cc.value),
        })
      }
    }
    source = 'firebase.json'
  }
  const vercel = path.join(repo, 'vercel.json')
  if (fs.existsSync(vercel)) {
    const conf = JSON.parse(fs.readFileSync(vercel, 'utf8'))
    for (const block of conf.headers || []) {
      const cc = (block.headers || []).find((x) => x.key.toLowerCase() === 'cache-control')
      if (!cc) continue
      // Vercel sources use path-to-regexp; treat (.*) and :param* as wildcards.
      const glob = block.source.replace(/\(\.\*\)/g, '**').replace(/:[a-z]+\*/gi, '**').replace(/:[a-z]+/gi, '*')
      rules.push({ pattern: globToRegExp(glob), glob: block.source, maxAge: maxAgeOf(cc.value), immutable: /immutable/.test(cc.value) })
    }
    source = source ? source + ' + vercel.json' : 'vercel.json'
  }
  for (const rel of ['public/_headers', 'static/_headers', '_headers']) {
    const file = path.join(repo, rel)
    if (!fs.existsSync(file)) continue
    // Netlify / Cloudflare Pages: a path line, then indented "Header: value" lines.
    let current = null
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (/^\S/.test(line)) current = line.trim()
      else if (current && /cache-control:/i.test(line)) {
        const value = line.split(':').slice(1).join(':')
        rules.push({ pattern: globToRegExp(current.replace(/\*/g, '**')), glob: current, maxAge: maxAgeOf(value), immutable: /immutable/.test(value) })
      }
    }
    source = source ? `${source} + ${rel}` : rel
  }
  for (const dir of ['public', 'static']) {
    if (fs.existsSync(path.join(repo, dir))) {
      publicDir = dir
      break
    }
  }
  return { source, publicDir, rules }
}

function cacheFor(rules, urlPath) {
  let hit = null
  for (const r of rules) if (r.pattern.test(urlPath)) hit = r
  return hit
}

const CACHEABLE = /\.(png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|otf|mp4|webm|mp3|pdf|json|webmanifest|js|css)$/i
const HASHED = /[.-][0-9a-f]{8,}\.[a-z0-9]+$|[.-][A-Za-z0-9_-]{8}\.(js|css)$/

// ---------------------------------------------------------------- analysis

function changedFiles(repo, base, head) {
  const out = git(repo, 'diff', '--name-status', '-M', `${base}...${head}`)
  return out
    ? out.split('\n').map((line) => {
        const [status, a, b] = line.split('\t')
        return { status: status[0], path: b || a, from: b ? a : null }
      })
    : []
}

function commits(repo, base, head) {
  const out = git(repo, 'log', '--no-merges', '--format=%h%x09%s', `${base}..${head}`)
  return out ? out.split('\n').map((l) => ({ sha: l.split('\t')[0], subject: l.split('\t').slice(1).join('\t') })) : []
}

// Group a commit under a heading: conventional-commit type when present,
// otherwise the top-level area of the files it touched.
const TYPE_TITLES = {
  feat: 'Features', fix: 'Fixes', perf: 'Performance', refactor: 'Refactors', style: 'Styling',
  docs: 'Docs', test: 'Tests', ci: 'CI', build: 'Build', chore: 'Chores',
}
function groupCommits(repo, list) {
  const groups = new Map()
  for (const c of list) {
    const m = /^(\w+)(\([^)]*\))?!?:\s*(.*)$/.exec(c.subject)
    let title
    if (m && TYPE_TITLES[m[1]]) title = TYPE_TITLES[m[1]]
    else {
      const files = (tryGit(repo, 'show', '--name-only', '--format=', c.sha) || '').split('\n').filter(Boolean)
      const top = files.map((f) => f.split('/')[0]).sort().filter((v, i, a) => a.indexOf(v) === i)
      title = top.length === 1 ? `\`${top[0]}\`` : 'Other changes'
    }
    if (!groups.has(title)) groups.set(title, [])
    groups.get(title).push(c)
  }
  const order = Object.values(TYPE_TITLES)
  const pos = (t) => (order.includes(t) ? order.indexOf(t) : t === 'Other changes' ? 999 : 500)
  return new Map([...groups].sort((a, b) => pos(a[0]) - pos(b[0])))
}

// Where is a public file referenced from? (source files, html, manifests)
function references(repo, needle) {
  const out = tryGit(repo, 'grep', '-n', '-F', '--', needle, '--', '.', ':!*.lock', ':!package-lock.json', ':!*.map')
  if (!out) return []
  // What ships first: the HTML shell, app source, build/PWA config, manifests.
  const rank = (line) =>
    /^(index\.html|src\/|app\/|pages\/|vite\.config|next\.config|.*manifest)/.test(line) ? 0 :
    /^(public|static)\//.test(line) ? 1 : 2
  const lines = out.split('\n').sort((a, b) => rank(a) - rank(b))
  return lines.length > 8 ? [...lines.slice(0, 8), `… and ${lines.length - 8} more`] : lines
}

function analyze(repo, base, head) {
  const files = changedFiles(repo, base, head)
  const list = commits(repo, base, head)
  const cache = loadCacheRules(repo)
  const warnings = []

  for (const f of files) {
    if (!cache.publicDir || !f.path.startsWith(cache.publicDir + '/')) continue
    const urlPath = '/' + f.path.slice(cache.publicDir.length + 1)
    if (!CACHEABLE.test(urlPath)) continue
    const rule = cacheFor(cache.rules, urlPath)
    const days = rule?.maxAge ? Math.round(rule.maxAge / 86400) : null

    if (f.status === 'M' && !HASHED.test(urlPath)) {
      if (rule && rule.maxAge > 0) {
        const ext = path.extname(urlPath)
        const stem = urlPath.slice(0, -ext.length)
        const vm = /-v(\d+)$/.exec(stem)
        const suggestion = vm ? `${stem.replace(/-v\d+$/, '')}-v${Number(vm[1]) + 1}${ext}` : `${stem}-v2${ext}`
        warnings.push({
          type: 'cached-asset-changed-in-place',
          severity: 'high',
          file: f.path,
          url: urlPath,
          cache: `${rule.glob} → max-age ${rule.maxAge}s (~${days} days)${rule.immutable ? ', immutable' : ''}`,
          message: `${urlPath} changed but kept its name. Browsers that already have it keep showing the old one for up to ${days} days. Rename it (e.g. ${suggestion}) and update every reference.`,
          suggestion,
          references: references(repo, path.basename(urlPath)),
        })
      } else if (!rule && cache.source == null) {
        warnings.push({
          type: 'cache-policy-unknown',
          severity: 'medium',
          file: f.path,
          url: urlPath,
          message: `${urlPath} changed in place and no host cache config was found (firebase.json, vercel.json, _headers). Check how long the host and CDN cache it; if it is cached, rename it.`,
        })
      }
    }
    if ((f.status === 'R' || f.status === 'D') && (f.from || f.path)) {
      const old = f.from || f.path
      const oldName = path.basename(old)
      const refs = references(repo, oldName).filter((r) => !r.startsWith(old))
      if (refs.length) {
        warnings.push({
          type: 'stale-reference',
          severity: 'high',
          file: old,
          message: `${old} was ${f.status === 'R' ? `renamed to ${f.path}` : 'deleted'} but "${oldName}" is still referenced.`,
          references: refs,
        })
      }
    }
  }

  // Generated or local files that should not ride along in a release.
  for (const f of files) {
    if (f.status === 'D') continue
    if (/(^|\/)(\.env(\..*)?|\.DS_Store|Thumbs\.db|npm-debug\.log.*|.*\.local)$/.test(f.path) || /(^|\/)(dist|build|coverage|node_modules)\//.test(f.path)) {
      warnings.push({ type: 'local-file', severity: 'high', file: f.path, message: `${f.path} looks local or generated; it should not be in the release.` })
    }
  }

  return { base, head, commits: list, groups: groupCommits(repo, list), files, cache, warnings }
}

// ---------------------------------------------------------------- output

function prBody(result, template) {
  const changes = [...result.groups]
    .map(([title, cs]) => `**${title}**\n${cs.map((c) => `- ${c.subject} (${c.sha})`).join('\n')}`)
    .join('\n\n')
  const counts = { A: 0, M: 0, D: 0, R: 0 }
  for (const f of result.files) counts[f.status] = (counts[f.status] || 0) + 1
  const risks = result.warnings.length
    ? result.warnings.map((w) => `- ⚠️ ${w.message}`).join('\n')
    : '- None detected by the release check.'
  return template
    .replace('{{CHANGES}}', changes || '_No commits._')
    .replace('{{STATS}}', `${result.commits.length} commits · ${result.files.length} files (${counts.A} added, ${counts.M} modified, ${counts.R} renamed, ${counts.D} deleted)`)
    .replace('{{RISKS}}', risks)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write('node release_check.mjs [--repo .] [--base origin/main] [--head HEAD] [--json]\n')
    return
  }
  const repo = path.resolve(args.repo)
  const base = args.base || defaultBase(repo)
  const result = analyze(repo, base, args.head)
  const template = fs.readFileSync(path.join(HERE, '..', 'templates', 'pr-body.md'), 'utf8')
  const body = prBody(result, template)
  if (args.json) {
    process.stdout.write(JSON.stringify({
      base, head: args.head,
      commits: result.commits,
      files: result.files,
      cacheSource: result.cache.source,
      publicDir: result.cache.publicDir,
      warnings: result.warnings,
      prBody: body,
    }, null, 2) + '\n')
    return
  }
  const out = [`Release check: ${base}...${args.head}`, '']
  out.push(`${result.commits.length} commits, ${result.files.length} files changed.`)
  out.push(`Cache rules: ${result.cache.source || 'none found'}${result.cache.publicDir ? ` · public dir: ${result.cache.publicDir}/` : ''}`, '')
  if (result.warnings.length) {
    out.push('Warnings:')
    for (const w of result.warnings) {
      out.push(`  [${w.severity}] ${w.message}`)
      if (w.cache) out.push(`      cache rule: ${w.cache}`)
      for (const r of w.references || []) out.push(`      ref: ${r}`)
    }
  } else out.push('No warnings.')
  out.push('', '--- PR body draft ---', body)
  process.stdout.write(out.join('\n') + '\n')
}

main()
