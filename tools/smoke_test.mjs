#!/usr/bin/env node
// Smoke test for the plugin: validates the manifests and every SKILL.md, then
// runs responsive-check against the fixtures in tools/fixtures and checks it
// finds the planted bugs (and nothing on the clean page).
//
//   node tools/smoke_test.mjs            # skips the browser part if Playwright is missing
//   node tools/smoke_test.mjs --browser  # fail if Playwright is missing

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requireBrowser = process.argv.includes('--browser')
let failures = 0

function check_(ok, message) {
  return check(ok, message)
}

function check(ok, message) {
  console.log(`${ok ? '✓' : '✗'} ${message}`)
  if (!ok) failures++
}

function readJson(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
  } catch (err) {
    check(false, `${rel} is valid JSON (${err.message})`)
    return null
  }
}

function frontmatter(file) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(file, 'utf8'))
  if (!m) return null
  const out = {}
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z_-]+):\s*(.*)$/.exec(line)
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
  }
  return out
}

// ---- manifests
const plugin = readJson('.claude-plugin/plugin.json')
if (plugin) {
  check(typeof plugin.name === 'string' && /^[a-z0-9-]+$/.test(plugin.name), 'plugin.json has a kebab-case name')
  check(Boolean(plugin.description && plugin.version), 'plugin.json has description and version')
}
const market = readJson('.claude-plugin/marketplace.json')
if (market) {
  check(Array.isArray(market.plugins) && market.plugins.length > 0, 'marketplace.json lists plugins')
  check(market.plugins?.some((p) => p.name === plugin?.name), 'marketplace.json includes this plugin')
}

// ---- skills
const skillsDir = path.join(ROOT, 'skills')
const skills = fs.readdirSync(skillsDir).filter((d) => fs.existsSync(path.join(skillsDir, d, 'SKILL.md')))
check(skills.length > 0, `found ${skills.length} skill(s): ${skills.join(', ')}`)
for (const name of skills) {
  const file = path.join(skillsDir, name, 'SKILL.md')
  const fm = frontmatter(file)
  check(fm?.name === name, `${name}/SKILL.md frontmatter name matches its folder`)
  check((fm?.description || '').length >= 40, `${name}/SKILL.md has a real description`)
  const body = fs.readFileSync(file, 'utf8')
  check(body.split('\n').length < 500, `${name}/SKILL.md stays under 500 lines`)
  // Every file the skill points to must exist.
  for (const [, rel] of body.matchAll(/\]\(((?:scripts|references|templates)\/[^)#]+)\)/g)) {
    check(fs.existsSync(path.join(skillsDir, name, rel)), `${name}: linked file ${rel} exists`)
  }
}

// ---- evals
const evals = readJson('evals/evals.json')
if (evals) {
  const list = evals.skills ? evals.skills.flatMap((s) => s.evals.map((e) => ({ ...e, skill: s.skill_name }))) : []
  check(list.length > 0, `evals/evals.json has ${list.length} eval(s)`)
  for (const e of list) {
    check(skills.includes(e.skill), `eval ${e.skill}#${e.id} points to an existing skill`)
    check(Boolean(e.prompt && e.expected_output), `eval ${e.skill}#${e.id} has prompt and expected_output`)
  }
}

// ---- responsive-check against fixtures
const require = createRequire(import.meta.url)
let hasPlaywright = false
for (const c of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean)) {
  try {
    require.resolve(c)
    hasPlaywright = true
    break
  } catch {}
}
if (!hasPlaywright) {
  check(!requireBrowser, 'Playwright available for the browser smoke test')
  if (!requireBrowser) console.log('  (skipping the browser part: Playwright not installed)')
} else {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'webapp-qa-smoke-'))
  const port = String(4700 + Math.floor(Math.random() * 200))
  execFileSync(
    process.execPath,
    [
      path.join(skillsDir, 'responsive-check/scripts/responsive_check.mjs'),
      '--url', `http://localhost:${port}`,
      '--start', `"${process.execPath}" "${path.join(ROOT, 'tools/fixtures/serve.mjs')}" ${port}`,
      '--routes', '/broken,/ok',
      '--viewports', 'phone-small,desktop',
      '--out', out,
      '--wait', '100',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  const report = JSON.parse(fs.readFileSync(path.join(out, 'issues.json'), 'utf8'))
  const at = (route, width, theme = 'light') =>
    report.screens.find((s) => s.route === route && s.viewport.width === width && s.theme === theme)
  const types = (screen) => new Set(screen.issues.map((i) => i.type))

  const small = at('/broken', 360)
  check(small?.page.horizontalScroll === true, '360px: detects horizontal scroll')
  for (const t of ['overflow-viewport', 'text-clipped', 'text-overflows-box', 'overlap', 'low-contrast', 'cramped-text', 'text-truncated', 'control-wraps', 'small-tap-target']) {
    check(types(small).has(t), `360px: detects ${t}`)
  }
  check(
    small.issues.some((i) => i.type === 'control-wraps' && i.selector.includes('streak')),
    '360px: detects a badge broken onto several lines',
  )
  check(
    !small.issues.some((i) => i.selector.includes('scroller')),
    '360px: does not flag the intentional horizontal scroller',
  )
  const wide = at('/broken', 1280)
  check(wide?.page.horizontalScroll === false, '1280px: no horizontal scroll on the wide viewport')
  check(at('/broken', 360, 'dark')?.shots.length > 0, 'dark theme screens are captured')
  const ok = at('/ok', 360)
  check(ok?.issues.length === 0, `/ok has no findings (got ${ok?.issues.map((i) => i.type).join(', ') || 'none'})`)
  check(fs.existsSync(path.join(out, 'report.html')) && fs.existsSync(path.join(out, 'report.md')), 'writes report.html and report.md')
  const shot = small.shots[0] && path.join(out, small.shots[0].file)
  check(Boolean(shot && fs.statSync(shot).size > 1000), 'writes annotated screenshots')
  fs.rmSync(out, { recursive: true, force: true })

  // Stress mode + layout rules (from tools/fixtures/qa.config.json).
  const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'webapp-qa-stress-'))
  const port2 = String(Number(port) + 1)
  execFileSync(
    process.execPath,
    [
      path.join(skillsDir, 'responsive-check/scripts/responsive_check.mjs'),
      '--config', path.join(ROOT, 'tools/fixtures/qa.config.json'),
      '--url', `http://localhost:${port2}`,
      '--start', `"${process.execPath}" "${path.join(ROOT, 'tools/fixtures/serve.mjs')}" ${port2}`,
      '--viewports', 'phone-small',
      '--themes', 'light',
      '--out', out2,
      '--wait', '100',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  const stress = JSON.parse(fs.readFileSync(path.join(out2, 'issues.json'), 'utf8'))
  const sf = stress.stressFindings || []
  check(stress.screens.some((x) => x.variant === 'stress'), 'stress: screens are re-measured with grown content')
  check(
    sf.some((f) => f.type === 'overflow-viewport' && f.selector.includes('chips')),
    'stress: chips without flex-wrap overflow once there are more of them',
  )
  check(
    sf.some((f) => f.type === 'layout-rule' && f.selector === '.chips' && /overflow instead of wrapping/.test(f.seen[0].detail.problem)),
    'stress: the "chips wrap" rule reports items that do not wrap',
  )
  check(
    stress.findings.some((f) => f.type === 'layout-rule' && f.selector === '.tags-left'),
    'layout rule: left-aligned tags break the "centered" rule',
  )
  check(
    ![...stress.findings, ...sf].some((f) => f.routes.includes('/ok')),
    '/ok stays clean under stress and its centered chips pass the rule',
  )
  fs.rmSync(out2, { recursive: true, force: true })
}

// ---- release: release_check on throwaway repos
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webapp-qa-release-'))
  const make = (name, scenario) => {
    execFileSync(process.execPath, [path.join(ROOT, 'tools/fixtures/release/make_repo.mjs'), path.join(tmp, name), scenario], { stdio: 'pipe' })
    return path.join(tmp, name, 'app')
  }
  const sh = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {
    stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' },
  })
  const check = (cwd) => JSON.parse(execFileSync(process.execPath, [
    path.join(skillsDir, 'release/scripts/release_check.mjs'), '--repo', cwd, '--base', 'origin/master', '--json',
  ]).toString())

  const ship = make('ship', 'ship')
  sh(ship, 'checkout', '-qb', 'proximo')
  sh(ship, 'commit', '-qam', 'feat: red logo')
  const r1 = check(ship)
  check_(r1.warnings.some((w) => w.type === 'cached-asset-changed-in-place' && w.file === 'public/logo.svg' && /30 days/.test(w.message)),
    'release: logo edited in place under a 30-day cache is flagged')
  check_(r1.warnings.find((w) => w.file === 'public/logo.svg')?.suggestion === '/logo-v2.svg', 'release: suggests logo-v2.svg')
  check_(/feat: red logo/.test(r1.prBody) && /logo\.svg/.test(r1.prBody), 'release: PR body lists the commit and the warning')

  const ok = make('ok', 'clean-ok')
  check_(check(ok).warnings.length === 0, 'release: a rename with every reference updated passes clean')
  sh(ok, 'checkout', '-qb', 'stale', 'origin/master')
  sh(ok, 'mv', 'public/favicon-v1.png', 'public/favicon-v2.png')
  sh(ok, 'commit', '-qm', 'rename favicon only')
  check_(check(ok).warnings.some((w) => w.type === 'stale-reference' && w.references.some((x) => x.startsWith('index.html'))),
    'release: a renamed file still referenced by its old name is flagged')
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
