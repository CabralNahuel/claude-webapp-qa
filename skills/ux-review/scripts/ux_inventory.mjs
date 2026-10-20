#!/usr/bin/env node
// ux_inventory: collect what a UX review needs to look at, screen by screen —
// every control with its icon and label, primary-looking buttons, destructive
// actions (and whether they ask before acting), focus visibility, form labels,
// images without alt — plus annotated screenshots. Judgement stays with the
// reviewer; this gathers the evidence and flags the mechanical cases.
//
//   node ux_inventory.mjs --config qa.config.json [--out qa-report/ux] [--probe-destructive]
//
// Uses the same config file as responsive-check (baseUrl, start, routes, auth,
// themeStorage, locale, mask). Extra keys: "probeDestructive" (bool),
// "destructivePattern" (regex source), "viewports" (default phone + desktop).

import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)

const VIEWPORTS = {
  phone: { name: 'phone', width: 390, height: 844, mobile: true },
  desktop: { name: 'desktop', width: 1280, height: 800, mobile: false },
}
const DESTRUCTIVE =
  '\\b(borrar|eliminar|quitar|sacar|expulsar|salir del grupo|abandonar|cancelar (el |la )?(partido|torneo|fecha|suscripci[oó]n|inscripci[oó]n)|dar de baja|delete|remove|discard|leave group|kick|unsubscribe|reset|reiniciar)\\b|🗑'
// \b is ASCII-only in JS ("Sí" would not match), so use Unicode letter edges.
const CONFIRM_WORDS =
  /(^|[^\p{L}])(s[ií]|no|confirmar|confirmo|seguro|borrar|eliminar|cancelar|deshacer|yes|confirm|sure|delete|cancel|undo|keep|mantener|volver)(?=$|[^\p{L}])/iu
const VAGUE = /^(ok|okay|aceptar|enviar|submit|send|click( aquí| acá| here)?|aquí|acá|here|más|more|ver|ir|go|continuar|continue|siguiente|next|sí|si|no|listo|done)$/i

// ---------------------------------------------------------------- setup

function parseArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--probe-destructive') a.probe = true
    else if (argv[i] === '--help') a.help = true
    else if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i]
  }
  return a
}

function loadConfig(args) {
  if (!args.config) throw new Error('Pass --config (same format as responsive-check).')
  const file = path.resolve(args.config)
  const base = path.dirname(file)
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
  // Env overrides let tests run the same config on a free port.
  if (process.env.UX_BASE_URL) cfg.baseUrl = process.env.UX_BASE_URL
  if (process.env.UX_START) cfg.start = { ...(cfg.start || {}), command: process.env.UX_START }
  cfg.baseUrl = cfg.baseUrl.replace(/\/$/, '')
  cfg.routes = (cfg.routes || ['/']).map((r) => (typeof r === 'string' ? { path: r } : r))
  cfg.outDir = path.resolve(args.out || (cfg.uxOutDir ? path.resolve(base, cfg.uxOutDir) : path.resolve(process.cwd(), 'qa-report/ux')))
  cfg.viewports = (cfg.uxViewports || ['phone', 'desktop']).map((v) => (typeof v === 'string' ? VIEWPORTS[v] : v))
  cfg.probeDestructive = args.probe || cfg.probeDestructive || false
  cfg.destructivePattern = cfg.destructivePattern || DESTRUCTIVE
  cfg.auth = cfg.auth || {}
  cfg.mask = cfg.mask || []
  if (cfg.start) cfg.start.cwd = path.resolve(base, cfg.start.cwd || '.')
  return cfg
}

function loadPlaywright() {
  for (const c of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core', '/opt/node-tools/node_modules/playwright'].filter(Boolean)) {
    try {
      return require(c)
    } catch {}
  }
  throw new Error('Playwright not found (npm i -D playwright, or set PLAYWRIGHT_MODULE).')
}

async function launch(chromium) {
  try {
    return await chromium.launch()
  } catch (err) {
    for (const p of [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter(Boolean)) {
      if (fs.existsSync(p)) return chromium.launch({ executablePath: p })
    }
    throw err
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function isUp(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).status < 500
  } catch {
    return false
  }
}
async function ensureServer(cfg) {
  if (await isUp(cfg.baseUrl)) return null
  if (!cfg.start?.command) throw new Error(`${cfg.baseUrl} is not responding and the config has no start command.`)
  const child = spawn(cfg.start.command, { cwd: cfg.start.cwd, shell: true, stdio: 'ignore', detached: true, env: { ...process.env, BROWSER: 'none' } })
  const deadline = Date.now() + (cfg.start.timeoutMs || 90000)
  while (Date.now() < deadline) {
    if (await isUp(cfg.baseUrl)) return child
    await sleep(500)
  }
  throw new Error(`App did not answer on ${cfg.baseUrl}.`)
}
const stop = (child) => {
  if (!child) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {}
}

// ---------------------------------------------------------------- in-page

// Runs in the page: every visible control with what it shows and how it
// reads to assistive tech, plus forms, images and headings.
function collect({ destructivePattern }) {
  const destructive = new RegExp(destructivePattern, 'i')
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n)
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
    }
    return true
  }
  const els = (window.__uxEls = [])
  const keep = (el) => (els.push(el), els.length - 1)
  const text = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim()
  const emojiOnly = (s) => s && /^[\p{Extended_Pictographic}‍️\s×✕✖+−\-<>‹›«»←→↑↓⋯…]+$/u.test(s)
  const hash = (s) => {
    let h = 0
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
    return (h >>> 0).toString(36)
  }
  function iconOf(el) {
    const svg = el.querySelector('svg')
    if (svg) {
      const shape = [...svg.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse')]
        .map((n) => n.tagName + (n.getAttribute('d') || '') + (n.getAttribute('points') || '') +
          ['cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2'].map((a) => n.getAttribute(a) || '').join(','))
        .join('|')
      return shape ? 'svg:' + hash(shape) : null
    }
    const img = el.querySelector('img')
    if (img && img.getBoundingClientRect().width <= 48) return 'img:' + (img.getAttribute('src') || '').split('/').pop()
    const t = text(el)
    const m = t.match(/\p{Extended_Pictographic}/u)
    if (m) return 'emoji:' + m[0]
    if (emojiOnly(t)) return 'glyph:' + t
    return null
  }
  function nameOf(el) {
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ').trim()
      if (t) return t
    }
    return (el.getAttribute('aria-label') || text(el) || el.getAttribute('title') ||
      el.querySelector('img')?.getAttribute('alt') || el.getAttribute('value') || '').replace(/\s+/g, ' ').trim()
  }
  const saturated = (c) => {
    const m = c.match(/\d+(\.\d+)?/g)
    if (!m) return false
    const [r, g, b, a = 1] = m.map(Number)
    if (a < 0.5) return false
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    return max - min > 60
  }
  function primaryLike(el, r) {
    const s = getComputedStyle(el)
    if (/primary|cta/i.test(el.className?.baseVal ?? el.className)) return true
    const filled = s.backgroundImage.includes('gradient') || saturated(s.backgroundColor)
    return filled && r.height >= 36 && r.width >= 80
  }

  const controls = []
  const sel = 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"], summary'
  for (const el of document.querySelectorAll(sel)) {
    if (!visible(el) || el.closest('[aria-hidden="true"]')) continue
    const r = el.getBoundingClientRect()
    const shown = text(el)
    const name = nameOf(el)
    const icon = iconOf(el)
    const visibleText = shown && !emojiOnly(shown) ? shown : ''
    const cls = (n) => [...(n?.classList || [])].filter((c) => !/\d{3,}/.test(c)).sort().join('.')
    controls.push({
      index: keep(el),
      kind: `${el.tagName}.${cls(el)}<${el.parentElement?.tagName}.${cls(el.parentElement)}`,
      tag: el.tagName.toLowerCase(),
      text: visibleText,
      name,
      icon,
      iconOnly: !!icon && !visibleText,
      emojiIcon: !!icon && icon.startsWith('emoji:'),
      primary: primaryLike(el, r),
      destructive: destructive.test(name) || destructive.test(el.getAttribute('title') || '') || /danger|delete|destructive|borrar/i.test(String(el.className?.baseVal ?? el.className)),
      vague: VAGUE_SRC.test(visibleText),
      aboveFold: r.top < innerHeight && r.bottom > 0,
      inNav: !!el.closest('nav, [role="navigation"], [role="tablist"]'),
      rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) },
    })
  }

  const fields = []
  for (const el of document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea')) {
    if (!visible(el)) continue
    const id = el.id
    const label =
      (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText) ||
      el.closest('label')?.innerText ||
      el.getAttribute('aria-label') ||
      (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.innerText) ||
      ''
    fields.push({ index: keep(el), type: el.type || el.tagName.toLowerCase(), label: label.trim(), placeholder: el.getAttribute('placeholder') || '' })
  }

  const images = [...document.querySelectorAll('img')]
    .filter((img) => visible(img) && !img.closest('button, a') && !img.hasAttribute('alt'))
    .map((img) => {
      const src = img.getAttribute('src') || ''
      return { index: keep(img), src: src.startsWith('data:') ? '(inline image)' : src.split('/').pop().slice(0, 60) }
    })

  const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(visible)
    .map((h) => ({ level: Number(h.tagName[1]), text: text(h).slice(0, 80) }))

  return { controls, fields, images, headings, title: document.title }
}
const VAGUE_SRC = VAGUE // replaced by the serialized regex inside the page

// Runs in the page: does focusing a control change how it looks?
function focusStyle(index) {
  const el = window.__uxEls[index]
  const snap = () => {
    const s = getComputedStyle(el)
    return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.backgroundColor, s.color, s.textDecorationLine].join('|')
  }
  return snap()
}

function annotate({ items }) {
  document.getElementById('__ux_overlay')?.remove()
  const root = document.createElement('div')
  root.id = '__ux_overlay'
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
  const colors = { high: '#ff3b30', medium: '#ff9500', low: '#2f7cf6' }
  for (const { index, n, severity } of items) {
    const el = window.__uxEls[index]
    if (!el) continue
    const r = el.getBoundingClientRect()
    const c = colors[severity] || '#ff3b30'
    const box = document.createElement('div')
    box.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${Math.max(r.width, 4)}px;height:${Math.max(r.height, 4)}px;outline:2px solid ${c};outline-offset:1px;background:${c}14;border-radius:3px`
    const tag = document.createElement('div')
    tag.textContent = n
    tag.style.cssText = `position:absolute;left:${Math.max(Math.min(r.right - 18, innerWidth - 20), 0)}px;top:${r.top >= 18 ? r.top - 17 : r.bottom + 1}px;min-width:18px;height:16px;padding:0 3px;box-sizing:border-box;background:${c};color:#fff;font:700 11px/16px system-ui,sans-serif;text-align:center;border-radius:8px`
    root.append(box, tag)
  }
  document.body.append(root)
}

// ---------------------------------------------------------------- run

const slug = (s) => s.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim()

async function newContext(browser, cfg, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    locale: cfg.locale,
    colorScheme: 'light',
  })
  const origin = new URL(cfg.baseUrl).origin
  await context.addInitScript(({ ls, origin, theme }) => {
    if (location.origin !== origin) return
    try {
      for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
      if (theme) localStorage.setItem(theme, 'light')
    } catch {}
  }, { ls: cfg.auth.localStorage || {}, origin, theme: cfg.themeStorage?.key })
  if (cfg.auth.cookies?.length) await context.addCookies(cfg.auth.cookies.map((c) => ({ url: cfg.baseUrl, ...c })))
  return context
}

async function open(page, cfg, route) {
  await page.goto(cfg.baseUrl + route.path, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  if (route.waitFor) await page.waitForSelector(route.waitFor, { timeout: 10000 }).catch(() => {})
  for (const step of route.actions || []) {
    if (step.click) await page.click(step.click).catch(() => {})
    if (step.wait) await sleep(step.wait)
  }
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' }).catch(() => {})
  await sleep(route.waitMs ?? cfg.waitMs ?? 700)
}

async function inventory(page, cfg) {
  return page.evaluate(
    new Function('args', `const VAGUE_SRC = ${VAGUE}; return (${collect.toString()})(args)`),
    { destructivePattern: cfg.destructivePattern },
  )
}

// Click a destructive control on a fresh load and see whether the app asks
// first. Only ever on demo/sandbox data: an unprotected action really runs.
async function probeDestructive(browser, cfg, vp, route, control) {
  const context = await newContext(browser, cfg, vp)
  const page = await context.newPage()
  let dialog = null
  page.on('dialog', async (d) => {
    dialog = d.message()
    await d.dismiss().catch(() => {})
  })
  try {
    await open(page, cfg, route)
    const data = await inventory(page, cfg)
    const same = data.controls.find((c) => c.name === control.name && c.rect.y === control.rect.y) ||
      data.controls.find((c) => c.name === control.name)
    if (!same) return { result: 'not-found' }
    const before = new Set(data.controls.map((c) => c.name))
    const countBefore = data.controls.length
    await page.evaluate((i) => window.__uxEls[i].click(), same.index)
    await sleep(800)
    if (dialog) return { result: 'protected', how: `browser confirm: "${dialog.slice(0, 80)}"` }
    const after = await inventory(page, cfg)
    const modal = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]')]
      .some((d) => d.getBoundingClientRect().height > 0))
    const fresh = after.controls.filter((c) => !before.has(c.name) && CONFIRM_WORDS.test(c.name)).map((c) => c.name)
    if (modal) return { result: 'protected', how: 'dialog opened' }
    if (fresh.length) return { result: 'protected', how: `asks inline: ${fresh.slice(0, 3).join(' / ')}` }
    const undo = await page.evaluate(() => /deshacer|undo/i.test(document.body.innerText))
    if (undo) return { result: 'protected', how: 'undo offered' }
    if (after.controls.length < countBefore || page.url() !== cfg.baseUrl + route.path) {
      return { result: 'unprotected', how: 'acted immediately (controls disappeared or the page changed)' }
    }
    return { result: 'unclear', how: 'nothing visible changed' }
  } finally {
    await context.close()
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write('node ux_inventory.mjs --config qa.config.json [--out dir] [--probe-destructive]\n')
    return
  }
  const cfg = loadConfig(args)
  const { chromium } = loadPlaywright()
  const shots = path.join(cfg.outDir, 'screenshots')
  fs.rmSync(shots, { recursive: true, force: true })
  fs.mkdirSync(shots, { recursive: true })
  const server = await ensureServer(cfg)
  const browser = await launch(chromium)
  const screens = []
  try {
    for (const vp of cfg.viewports) {
      const context = await newContext(browser, cfg, vp)
      const page = await context.newPage()
      for (const route of cfg.routes) {
        process.stderr.write(`• ${route.path} ${vp.width}px\n`)
        await open(page, cfg, route)
        const data = await inventory(page, cfg)
        const finalPath = new URL(page.url()).pathname

        // Focus: press Tab from the top and compare each focused control
        // with how it looks at rest (keyboard focus, so :focus-visible applies).
        const unfocused = []
        if (!vp.mobile) {
          const rest = await page.evaluate((fn) => window.__uxEls.map((_, i) => new Function('i', fn)(i)), `return (${focusStyle})(i)`)
          await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0) })
          const seenIdx = new Set()
          for (let step = 0; step < 15; step++) {
            await page.keyboard.press('Tab')
            const hit = await page.evaluate((fn) => {
              const i = window.__uxEls.indexOf(document.activeElement)
              return i < 0 ? null : { i, style: new Function('i', fn)(i) }
            }, `return (${focusStyle})(i)`)
            if (!hit || seenIdx.has(hit.i)) continue
            seenIdx.add(hit.i)
            if (hit.style === rest[hit.i]) unfocused.push(hit.i)
          }
          await page.evaluate(() => document.activeElement?.blur())
        }

        const probes = []
        if (cfg.probeDestructive && vp.mobile) {
          const once = new Set()
          for (const c of data.controls.filter((x) => x.destructive && !once.has(x.name) && once.add(x.name)).slice(0, 6)) {
            probes.push({ name: c.name, index: c.index, ...(await probeDestructive(browser, cfg, vp, route, c)) })
          }
        }
        screens.push({ route: route.path, finalPath, viewport: vp, ...data, unfocused, probes, page, context })
      }
      // Keep pages open for screenshots below; contexts closed at the end.
    }

    // ---- findings
    const findings = []
    const push = (f) => findings.push(f)

    // Icons with more than one meaning, across the whole app.
    // Rows of one list (same element kind) are one meaning, and so are names
    // that start with the same word ("Compartir…"). Long labels are list rows
    // or cards whose icon is decoration, not the control's meaning.
    const stem = (name) => (norm(name).split(' ').find((w) => w.length > 2) || norm(name)).slice(0, 5)
    const byIcon = new Map()
    for (const s of screens) {
      for (const c of s.controls) {
        if (!c.icon || !c.name || c.name.length > 40) continue
        if (!byIcon.has(c.icon)) byIcon.set(c.icon, new Map())
        const names = byIcon.get(c.icon)
        const sameKind = [...names.entries()].find(([, v]) => v.kinds.has(c.kind))
        const key = sameKind ? sameKind[0] : stem(c.name)
        if (!names.has(key)) names.set(key, { name: c.name, where: new Set(), kinds: new Set() })
        names.get(key).where.add(s.route)
        names.get(key).kinds.add(c.kind)
      }
    }
    for (const [icon, names] of byIcon) {
      if (names.size < 2) continue
      const list = [...names.values()].map((x) => `“${x.name}” (${[...x.where].join(', ')})`)
      push({ rule: 'icon-one-meaning', severity: 'high', icon, message: `The same icon means ${names.size} different things: ${list.join(' · ')}.` })
    }
    // The same meaning drawn with different icons.
    const byName = new Map()
    for (const s of screens) for (const c of s.controls) {
      if (!c.icon || !c.name || c.name.length > 40) continue
      const k = norm(c.name)
      if (!byName.has(k)) byName.set(k, { name: c.name, icons: new Set() })
      byName.get(k).icons.add(c.icon)
    }
    for (const { name, icons } of byName.values()) {
      if (icons.size > 1) push({ rule: 'icon-one-meaning', severity: 'low', message: `“${name}” is drawn with ${icons.size} different icons.` })
    }

    const seen = new Set()
    for (const s of screens) {
      const at = `${s.route} ${s.viewport.width}px`
      for (const c of s.controls) {
        const key = (k) => `${k}|${s.route}|${norm(c.name)}`
        if (c.iconOnly && !c.inNav && !seen.has(key('icon'))) {
          seen.add(key('icon'))
          push({ rule: 'icon-with-text', severity: c.name ? 'medium' : 'high', screen: s.route, viewport: s.viewport.name, index: c.index,
            message: c.name ? `Icon-only control “${c.name}” at ${at}: the meaning is only in the accessible name, not on screen.` : `Icon-only control with no accessible name at ${at}.` })
        }
        if (c.vague && !seen.has(key('vague'))) {
          seen.add(key('vague'))
          push({ rule: 'clear-copy', severity: 'low', screen: s.route, viewport: s.viewport.name, index: c.index, message: `Vague label “${c.text}” at ${at}: say what happens (“Guardar resultado”, “Invitar al grupo”).` })
        }
      }
      const primaries = s.controls.filter((c) => c.primary && c.aboveFold && !c.inNav)
      if (primaries.length > 1) {
        push({ rule: 'one-primary-action', severity: 'medium', screen: s.route, viewport: s.viewport.name, indexes: primaries.map((p) => p.index),
          message: `${primaries.length} primary-looking buttons in the first screen at ${at}: ${primaries.map((p) => `“${p.name}”`).join(', ')}. Which one is the move right now?` })
      }
      for (const p of s.probes) {
        if (p.result === 'unprotected') push({ rule: 'destructive-protected', severity: 'high', screen: s.route, viewport: s.viewport.name, index: p.index, message: `“${p.name}” at ${at} ${p.how}: no confirmation or undo.` })
        if (p.result === 'unclear') push({ rule: 'destructive-protected', severity: 'medium', screen: s.route, viewport: s.viewport.name, index: p.index, message: `“${p.name}” at ${at}: clicking it showed nothing — check by hand whether it asks first.` })
      }
      if (!cfg.probeDestructive && s.viewport.mobile) {
        for (const c of s.controls.filter((x) => x.destructive)) {
          if (seen.has(`destr|${s.route}|${norm(c.name)}`)) continue
          seen.add(`destr|${s.route}|${norm(c.name)}`)
          push({ rule: 'destructive-protected', severity: 'low', screen: s.route, viewport: s.viewport.name, index: c.index, message: `Destructive action “${c.name}” at ${at}: not probed (run with --probe-destructive on demo data) — check it asks first.` })
        }
      }
      if (s.unfocused.length) {
        push({ rule: 'visible-focus', severity: 'medium', screen: s.route, viewport: s.viewport.name, indexes: s.unfocused,
          message: `${s.unfocused.length} control(s) look the same with keyboard focus at ${at}: ${s.unfocused.slice(0, 4).map((i) => `“${s.controls.find((c) => c.index === i)?.name}”`).join(', ')}.` })
      }
      for (const f of s.fields) {
        if (!f.label) push({ rule: 'form-labels', severity: f.placeholder ? 'medium' : 'high', screen: s.route, viewport: s.viewport.name, index: f.index,
          message: f.placeholder ? `Field “${f.placeholder}” at ${at} has only a placeholder as label (it disappears while typing).` : `A ${f.type} field at ${at} has no label.` })
      }
      for (const img of s.images) push({ rule: 'alt-text', severity: 'medium', screen: s.route, viewport: s.viewport.name, index: img.index, message: `Image ${img.src} at ${at} has no alt attribute (use alt="" if decorative).` })
      if (!s.viewport.mobile) {
        if (!s.headings.some((h) => h.level === 1)) push({ rule: 'headings', severity: 'low', screen: s.route, viewport: s.viewport.name, message: `No h1 on ${s.route}.` })
      }
    }

    const order = { high: 0, medium: 1, low: 2 }
    findings.sort((a, b) => order[a.severity] - order[b.severity])
    findings.forEach((f, i) => (f.id = `U${i + 1}`))

    // ---- screenshots: one per screen, numbered with that screen's findings
    for (const s of screens) {
      const mine = findings.filter((f) => f.screen === s.route && f.viewport === s.viewport.name)
      const items = mine.flatMap((f) => (f.indexes || (f.index != null ? [f.index] : [])).map((index) => ({ index, n: f.id.slice(1), severity: f.severity })))
      await s.page.goto(cfg.baseUrl + s.route, { waitUntil: 'domcontentloaded' }).catch(() => {})
      await open(s.page, cfg, cfg.routes.find((r) => r.path === s.route))
      await inventory(s.page, cfg) // rebuild element indexes on this load
      await s.page.evaluate(annotate, { items })
      const file = `${slug(s.route)}--${s.viewport.name}.png`
      await s.page.screenshot({ path: path.join(shots, file), mask: cfg.mask.map((m) => s.page.locator(m)), maskColor: '#222' })
      s.shot = `screenshots/${file}`
      for (const f of mine) f.shot = s.shot
    }

    const out = {
      generatedAt: new Date().toISOString(),
      baseUrl: cfg.baseUrl,
      probedDestructive: cfg.probeDestructive,
      findings,
      screens: screens.map(({ page, context, ...s }) => ({
        ...s,
        redirected: s.finalPath !== s.route.split('?')[0] ? s.finalPath : null,
        controls: s.controls.map(({ index, ...c }) => c),
      })),
    }
    fs.writeFileSync(path.join(cfg.outDir, 'ux-inventory.json'), JSON.stringify(out, null, 2))
    fs.writeFileSync(path.join(cfg.outDir, 'ux-inventory.md'), render(out))
    const counts = { high: 0, medium: 0, low: 0 }
    for (const f of findings) counts[f.severity]++
    process.stderr.write(`\n${findings.length} mechanical findings (${counts.high} high, ${counts.medium} medium, ${counts.low} low). ` +
      `Now review the screenshots against references/checklist.md.\n`)
    process.stdout.write(JSON.stringify({ outDir: cfg.outDir, counts }) + '\n')
    for (const s of screens) await s.context.close().catch(() => {})
  } finally {
    await browser.close()
    stop(server)
  }
}

function render(out) {
  const lines = ['# UX inventory', '', `${out.baseUrl} · ${out.screens.length} screens · destructive actions ${out.probedDestructive ? 'probed' : 'not probed'}`, '']
  const redirected = out.screens.filter((s) => s.redirected)
  if (redirected.length) lines.push('**Warning:** redirected screens (check login setup): ' + redirected.map((s) => `${s.route} → ${s.redirected}`).join(', '), '')
  lines.push('## Mechanical findings', '')
  if (!out.findings.length) lines.push('None.', '')
  for (const f of out.findings) lines.push(`- **${f.id} · ${f.severity}** · \`${f.rule}\` — ${f.message}${f.shot ? ` → [${f.shot}](${f.shot})` : ''}`)
  lines.push('', '## Controls by screen', '', 'For the copy and "one primary action" review. ★ primary-looking, ⚠ destructive, ◻ icon only.', '')
  for (const s of out.screens) {
    lines.push(`### ${s.route} · ${s.viewport.width}px${s.shot ? ` · [screenshot](${s.shot})` : ''}`, '')
    if (s.headings.length) lines.push(`Headings: ${s.headings.map((h) => `h${h.level} “${h.text}”`).join(' · ')}`, '')
    const labels = s.controls.map((c) => `${c.primary ? '★' : ''}${c.destructive ? '⚠' : ''}${c.iconOnly ? '◻' : ''}${c.name || '(no name)'}`)
    lines.push(labels.length ? labels.map((l) => `\`${l}\``).join(' ') : '_no controls_', '')
    for (const p of s.probes) lines.push(`- probe “${p.name}”: **${p.result}** — ${p.how || ''}`)
    if (s.probes.length) lines.push('')
  }
  return lines.join('\n') + '\n'
}

run().catch((err) => {
  process.stderr.write(`ux_inventory failed: ${err.stack || err.message}\n`)
  process.exit(1)
})
