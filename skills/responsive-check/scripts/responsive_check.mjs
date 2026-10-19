#!/usr/bin/env node
// responsive-check: walk a web app's screens at several viewports and color
// schemes, detect layout breakage, and write annotated screenshots plus a
// prioritized report.
//
// Usage:
//   node responsive_check.mjs --config qa.config.json
//   node responsive_check.mjs --url http://localhost:5173 --routes /,/about
//
// Run with --help for every option. See ../references/config.md for the
// config file format.

import { createRequire } from 'node:module'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const DEFAULT_VIEWPORTS = [
  { name: 'phone-small', width: 360, height: 740, mobile: true },
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'desktop', width: 1280, height: 800, mobile: false },
]
// Not in the default set; pass --viewports phone-xs,... for older/smaller phones.
const EXTRA_VIEWPORTS = [{ name: 'phone-xs', width: 320, height: 568, mobile: true }]
const DEFAULT_THEMES = ['light', 'dark']
const DEFAULT_CURL_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }

// ---------------------------------------------------------------- options

const HELP = `responsive-check

  --config <file>        JSON config (see references/config.md). Flags override it.
  --url <baseUrl>        App base URL, e.g. http://localhost:5173
  --routes <list>        Comma-separated paths, e.g. /,/ranking,/settings
  --start <command>      Command that starts the app (e.g. "npm run dev").
  --cwd <dir>            Working directory for --start (default: current).
  --out <dir>            Output directory (default: qa-report/responsive).
  --viewports <list>     Subset by name or WIDTHxHEIGHT, e.g. phone-small,desktop or 360x740
  --themes <list>        light,dark (default both)
  --local-storage <json> JSON object of localStorage entries to set before load
  --mask <list>          Comma-separated selectors to black out in screenshots
  --wait <ms>            Extra settle time after load (default 700)
  --max-shots <n>        Max annotated screenshots per screen (default 4)
  --stress               Also re-measure each screen with grown content: texts 40% longer,
                         3x the items in horizontal groups (chips, tabs, avatars)
  --no-curl-fonts        Do not proxy font hosts through curl
  --help
`

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    if (key === 'help' || key === 'no-curl-fonts' || key === 'stress') {
      args[key] = true
      continue
    }
    args[key] = argv[++i]
  }
  return args
}

function list(value) {
  if (value == null) return undefined
  if (Array.isArray(value)) return value
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function loadConfig(args) {
  let cfg = {}
  let base = process.cwd()
  if (args.config) {
    const file = path.resolve(args.config)
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
    base = path.dirname(file)
  }
  if (args.url) cfg.baseUrl = args.url
  if (args.routes) cfg.routes = list(args.routes)
  if (args.start) cfg.start = { ...(cfg.start || {}), command: args.start }
  if (args.cwd) cfg.start = { ...(cfg.start || {}), cwd: path.resolve(args.cwd) }
  if (args.out) cfg.outDir = path.resolve(args.out)
  if (args.themes) cfg.themes = list(args.themes)
  if (args.mask) cfg.mask = list(args.mask)
  if (args.wait) cfg.waitMs = Number(args.wait)
  if (args['max-shots']) cfg.maxShotsPerScreen = Number(args['max-shots'])
  if (args['local-storage']) {
    cfg.auth = { ...(cfg.auth || {}), localStorage: JSON.parse(args['local-storage']) }
  }
  if (args['no-curl-fonts']) cfg.curlHosts = []

  if (!cfg.baseUrl) throw new Error('Missing --url or "baseUrl" in the config.')
  cfg.baseUrl = cfg.baseUrl.replace(/\/$/, '')
  cfg.routes = (cfg.routes && cfg.routes.length ? cfg.routes : ['/']).map((r) =>
    typeof r === 'string' ? { path: r } : r,
  )
  cfg.themes = cfg.themes || DEFAULT_THEMES
  cfg.viewports = resolveViewports(args.viewports ? list(args.viewports) : cfg.viewports)
  cfg.outDir = cfg.outDir
    ? path.resolve(base, cfg.outDir)
    : path.resolve(process.cwd(), 'qa-report/responsive')
  cfg.waitMs = cfg.waitMs ?? 700
  cfg.maxShotsPerScreen = cfg.maxShotsPerScreen ?? 4
  cfg.curlHosts = cfg.curlHosts ?? DEFAULT_CURL_HOSTS
  cfg.mask = cfg.mask || []
  cfg.ignore = cfg.ignore || []
  cfg.layoutRules = cfg.layoutRules || []
  if (args.stress) cfg.stress = cfg.stress || true
  if (cfg.stress) {
    cfg.stress = {
      textFactor: 1.4,
      repeat: 3,
      maxItems: 12,
      themes: [cfg.themes[0]],
      ...(cfg.stress === true ? {} : cfg.stress),
    }
  }
  cfg.auth = cfg.auth || {}
  if (cfg.auth.script) cfg.auth.script = path.resolve(base, cfg.auth.script)
  if (cfg.start && !args.cwd) cfg.start.cwd = path.resolve(base, cfg.start.cwd || '.')
  return cfg
}

function resolveViewports(spec) {
  if (!spec) return DEFAULT_VIEWPORTS
  return spec.map((v) => {
    if (typeof v === 'object') return { mobile: v.width < 768, ...v }
    const known = [...DEFAULT_VIEWPORTS, ...EXTRA_VIEWPORTS].find((d) => d.name === v)
    if (known) return known
    const m = /^(\d+)x(\d+)$/.exec(v)
    if (!m) throw new Error(`Unknown viewport "${v}"`)
    const width = Number(m[1])
    return { name: v, width, height: Number(m[2]), mobile: width < 768 }
  })
}

// ---------------------------------------------------------------- playwright

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    'playwright-core',
    '/opt/node-tools/node_modules/playwright',
  ].filter(Boolean)
  for (const c of candidates) {
    try {
      return require(c)
    } catch {
      // try the next one
    }
  }
  throw new Error(
    'Playwright not found. Install it (npm i -D playwright) or set PLAYWRIGHT_MODULE to its path.',
  )
}

async function launchChromium(chromium) {
  try {
    return await chromium.launch()
  } catch (err) {
    // The bundled browser revision may not match the installed one: fall back
    // to any Chromium we can find instead of downloading another.
    const candidates = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter(Boolean)
    for (const executablePath of candidates) {
      if (fs.existsSync(executablePath)) return chromium.launch({ executablePath })
    }
    throw err
  }
}

// ---------------------------------------------------------------- app server

async function isUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return res.status < 500
  } catch {
    return false
  }
}

async function ensureServer(cfg) {
  if (await isUp(cfg.baseUrl)) return null
  if (!cfg.start?.command) {
    throw new Error(`${cfg.baseUrl} is not responding and no start command was given (--start).`)
  }
  log(`Starting app: ${cfg.start.command}`)
  const child = spawn(cfg.start.command, {
    cwd: cfg.start.cwd || process.cwd(),
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' },
  })
  let output = ''
  child.stdout.on('data', (d) => (output += d))
  child.stderr.on('data', (d) => (output += d))
  const deadline = Date.now() + (cfg.start.timeoutMs || 90000)
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`App exited early:\n${output}`)
    if (await isUp(cfg.baseUrl)) return child
    await sleep(500)
  }
  stopServer(child)
  throw new Error(`App did not answer on ${cfg.baseUrl} in time. Output:\n${output}`)
}

function stopServer(child) {
  if (!child) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

// ---------------------------------------------------------------- curl proxy

// Headless browsers in sandboxes often have no direct network while curl goes
// through the proxy. Without this, Google Fonts never load and every
// screenshot shows a fallback typeface, which changes text widths and makes
// overflow findings wrong. We fetch those hosts with curl and serve them
// through page.route, caching on disk.
function makeCurlRoute(cacheDir, failures) {
  fs.mkdirSync(cacheDir, { recursive: true })
  return async (route) => {
    const request = route.request()
    const url = request.url()
    const key = createHash('sha1').update(url).digest('hex')
    const body = path.join(cacheDir, key)
    const meta = body + '.json'
    try {
      if (!fs.existsSync(meta)) {
        const headers = body + '.headers'
        execFileSync(
          'curl',
          ['-sSL', '--fail', '--max-time', '30', '-A', request.headers()['user-agent'] || 'Mozilla/5.0',
            '-D', headers, '-o', body, url],
          { stdio: 'pipe' },
        )
        const raw = fs.readFileSync(headers, 'utf8')
        const types = [...raw.matchAll(/^content-type:\s*(.+)$/gim)]
        const contentType = types.length ? types[types.length - 1][1].trim() : 'application/octet-stream'
        fs.writeFileSync(meta, JSON.stringify({ contentType }))
        fs.rmSync(headers, { force: true })
      }
      const { contentType } = JSON.parse(fs.readFileSync(meta, 'utf8'))
      await route.fulfill({
        status: 200,
        body: fs.readFileSync(body),
        headers: { 'content-type': contentType, 'access-control-allow-origin': '*' },
      })
    } catch (err) {
      failures.add(url)
      await route.continue().catch(() => {})
    }
  }
}

// ---------------------------------------------------------------- detection

// Runs inside the page. Returns the issues found in the current layout and
// keeps the offending elements in window.__qaEls so they can be annotated.
function detectIssues({ ignore }) {
  const vw = document.documentElement.clientWidth
  const issues = []
  const els = []
  window.__qaEls = els

  const ignored = (el) => ignore.some((sel) => el.closest(sel))
  const style = (el) => getComputedStyle(el)

  function visible(el) {
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return false
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = style(n)
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
    }
    return true
  }

  function selectorOf(el) {
    if (el.id) return `#${CSS.escape(el.id)}`
    const parts = []
    for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      if (n === document.body) break
      let part = n.tagName.toLowerCase()
      if (n.id) {
        parts.unshift(`#${CSS.escape(n.id)}`)
        break
      }
      const cls = [...n.classList].filter((c) => !/^(css|sc|jsx|_)-|\d{3,}/.test(c)).slice(0, 2)
      if (cls.length) part += '.' + cls.map((c) => CSS.escape(c)).join('.')
      const parent = n.parentElement
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === n.tagName)
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`
      }
      parts.unshift(part)
    }
    return parts.join(' > ')
  }

  function text(el) {
    return (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
  }

  const isControl = (el) =>
    el.matches('button, [role="button"], a, input, select, textarea, label, [role="tab"], summary')
  const isHeading = (el) => el.matches('h1, h2, h3, h4, h5, h6, header *, nav *, [role="heading"]')

  function add(el, type, severity, detail) {
    const key = type + '|' + selectorOf(el)
    if (issues.some((i) => i.key === key)) return
    // Skip an element if an ancestor already carries the same finding: the
    // ancestor is the one to fix.
    if (
      ['overflow-viewport', 'text-clipped', 'text-overflows-box'].includes(type) &&
      els.some((p, i) => issues[i].type === type && p.contains(el))
    ) {
      return
    }
    const r = el.getBoundingClientRect()
    els.push(el)
    issues.push({
      key,
      index: els.length - 1,
      type,
      severity,
      selector: selectorOf(el),
      tag: el.tagName.toLowerCase(),
      text: text(el),
      detail,
      rect: {
        x: Math.round(r.left + scrollX),
        y: Math.round(r.top + scrollY),
        width: Math.round(r.width),
        height: Math.round(r.height),
      },
    })
  }

  // Is the element's horizontal overflow contained by a clipping/scrolling
  // ancestor (other than html/body)? Then it does not break the page itself.
  function containedByAncestor(el) {
    for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const ox = style(n).overflowX
      if (ox !== 'visible') return true
    }
    return false
  }

  const all = [...document.body.querySelectorAll('*')].filter(
    (el) => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'BR'].includes(el.tagName) && !ignored(el),
  )
  const shown = all.filter(visible)

  // 1. The page itself scrolls sideways.
  const docWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  const pageScrolls = docWidth > vw + 1 && style(document.documentElement).overflowX !== 'hidden' &&
    style(document.body).overflowX !== 'hidden'
  const page = { viewportWidth: vw, documentWidth: docWidth, horizontalScroll: pageScrolls }

  // 2. Elements that stick out of the viewport.
  for (const el of shown) {
    const r = el.getBoundingClientRect()
    if (style(el).position === 'fixed' && (r.left >= vw || r.right <= 0)) continue // off-canvas drawer
    const outRight = r.right - vw
    const outLeft = -r.left
    if (outRight <= 1 && outLeft <= 1) continue
    if (containedByAncestor(el)) continue
    // Fully off-screen elements are usually hidden drawers; they only matter
    // when they are what makes the page scroll.
    const fullyOff = r.left >= vw || r.right <= 0
    if (fullyOff && !pageScrolls) continue
    add(el, 'overflow-viewport', pageScrolls ? 'critical' : 'high', {
      overflowPx: Math.round(Math.max(outRight, outLeft)),
      side: outRight > outLeft ? 'right' : 'left',
    })
  }

  // 3. Text clipped or truncated inside its own box.
  for (const el of shown) {
    const s = style(el)
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!hasText) continue
    const clipsX = s.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1
    const clipsY = s.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 2 && s.overflowY !== 'auto' && s.overflowY !== 'scroll'
    if (!clipsX && !clipsY) continue
    const ellipsis = s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none' && s.webkitLineClamp
    const important = isControl(el) || isHeading(el)
    if (ellipsis) {
      add(el, 'text-truncated', important ? 'medium' : 'low', {
        visibleWidth: el.clientWidth,
        neededWidth: el.scrollWidth,
      })
    } else if (s.overflowX === 'auto' || s.overflowX === 'scroll') {
      continue // intentional scroller
    } else {
      add(el, 'text-clipped', 'high', {
        visibleWidth: el.clientWidth,
        neededWidth: el.scrollWidth,
        visibleHeight: el.clientHeight,
        neededHeight: el.scrollHeight,
      })
    }
  }

  // 4. Text spilling out of a box that does not clip it (overflow: visible).
  const blockOf = (el) => {
    for (let n = el; n; n = n.parentElement) if (style(n).display !== 'inline') return n
    return el
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue
    const parent = node.parentElement
    if (!parent || ignored(parent) || !visible(parent)) continue
    const box = blockOf(parent)
    const bs = style(box)
    if (bs.overflowX !== 'visible') continue // handled in check 3
    const range = document.createRange()
    range.selectNodeContents(node)
    const tr = range.getBoundingClientRect()
    const br = box.getBoundingClientRect()
    const padR = parseFloat(bs.paddingRight) || 0
    const padL = parseFloat(bs.paddingLeft) || 0
    const over = Math.max(tr.right - (br.right - 0) , br.left - tr.left)
    if (tr.width > 0 && over > 2 && tr.width > br.width - padL - padR + 2) {
      add(box, 'text-overflows-box', isControl(box) || isHeading(box) ? 'high' : 'medium', {
        overflowPx: Math.round(over),
      })
    }
  }

  // 5. Content boxes that overlap each other (a badge running into a pill,
  // a word into the next column). Skips positioned layers (badges on
  // avatars, fixed bars, overlays), which overlap on purpose.
  // Positioned layers, negative margins and transforms are how designs
  // overlap things on purpose (stacked avatars, badges on icons, fixed bars).
  const layered = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const st = style(n)
      if (['absolute', 'fixed', 'sticky'].includes(st.position)) return true
      if (st.transform !== 'none') return true
      if (parseFloat(st.marginLeft) < 0 || parseFloat(st.marginTop) < 0 ||
        parseFloat(st.marginRight) < 0 || parseFloat(st.marginBottom) < 0) return true
    }
    return false
  }
  // What a leaf actually paints: its text, line by line (so a <strong> that
  // wraps does not count as its whole bounding box), or its own box for
  // images and form controls.
  const paintsBox = (st) =>
    (st.backgroundColor !== 'rgba(0, 0, 0, 0)' && st.backgroundColor !== 'transparent') ||
    st.backgroundImage !== 'none' || parseFloat(st.borderLeftWidth) > 0 || parseFloat(st.borderTopWidth) > 0
  function paintRects(el) {
    if (el.matches('img, svg, input, select, textarea')) return [el.getBoundingClientRect()]
    // A pill or badge paints its whole box; colliding with that is visible.
    const rects = paintsBox(style(el)) ? [Object.assign(el.getBoundingClientRect(), {})] : []
    rects.forEach((r) => (r.box = true))
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      rects.push(...[...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1))
    }
    return rects
  }
  const leaves = shown
    .filter((el) => el.matches('img, svg, input, select, textarea') ||
      [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
    .filter((el) => !el.closest('svg *') && !layered(el))
    .slice(0, 1500)
  const paints = leaves.map(paintRects)
  const hit = (A, B) => {
    const w = Math.min(A.right, B.right) - Math.max(A.left, B.left)
    const h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top)
    // Line boxes of adjacent text lines touch a little; demand a real bite.
    const need = A.box || B.box ? 2 : Math.min(A.height, B.height) * 0.3
    return w > 2 && h > need ? { w, h } : null
  }
  for (let a = 0; a < leaves.length; a++) {
    for (let b = a + 1; b < leaves.length; b++) {
      if (leaves[a].contains(leaves[b]) || leaves[b].contains(leaves[a])) continue
      let found = null
      for (const A of paints[a]) {
        for (const B of paints[b]) if ((found = hit(A, B))) break
        if (found) break
      }
      if (!found) continue
      add(leaves[b], 'overlap', 'high', {
        overlapsWith: selectorOf(leaves[a]),
        overlapPx: `${Math.round(found.w)}x${Math.round(found.h)}`,
      })
    }
  }

  // 6. Text with too little contrast against what is behind it (WCAG 1.4.3:
  // 4.5:1, or 3:1 for large text). Dark mode is where this usually slips.
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const rgbaCache = new Map()
  function rgba(color) {
    if (!rgbaCache.has(color)) {
      // Normalize any CSS color (oklch, color-mix…) by painting one pixel.
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000'
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      rgbaCache.set(color, [r, g, b, a / 255])
    }
    return rgbaCache.get(color)
  }
  const over = (top, under) => {
    const a = top[3]
    return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1)
  }
  const luminance = ([r, g, b]) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  // Solid color behind the element, or null when an image/gradient is in
  // the way and the real backdrop cannot be known from styles.
  function backdrop(el) {
    const layers = []
    for (let n = el; n; n = n.parentElement) {
      const st = style(n)
      if (st.backgroundImage !== 'none') return null
      const c = rgba(st.backgroundColor)
      if (c[3] > 0) layers.push(c)
      if (c[3] >= 1) break
    }
    let color = [255, 255, 255, 1]
    for (const layer of layers.reverse()) color = over(layer, color)
    return color
  }
  for (const el of shown) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
    const st = style(el)
    if (st.webkitTextFillColor && st.webkitTextFillColor !== st.color && rgba(st.webkitTextFillColor)[3] === 0) continue // gradient text
    const bg = backdrop(el)
    if (!bg) continue
    let opacity = 1
    for (let n = el; n; n = n.parentElement) opacity *= Number(style(n).opacity)
    const fgRaw = rgba(st.color)
    const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * opacity], bg)
    const L1 = luminance(fg), L2 = luminance(bg)
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
    const size = parseFloat(st.fontSize)
    const large = size >= 24 || (size >= 18.66 && Number(st.fontWeight) >= 700)
    const min = large ? 3 : 4.5
    if (ratio < min) {
      add(el, 'low-contrast', ratio < min - 1.5 ? 'high' : 'medium', {
        ratio: Math.round(ratio * 10) / 10,
        required: min,
        color: `rgb(${fg.slice(0, 3).map(Math.round).join(',')})`,
        background: `rgb(${bg.slice(0, 3).map(Math.round).join(',')})`,
      })
    }
  }

  // 7. Controls whose label wraps onto 3+ lines, and tiny tap targets.
  for (const el of shown.filter(isControl)) {
    if (el.matches('a') && !el.matches('nav a, [role="button"], a[class*="btn"], a[class*="button"]')) {
      // Plain inline links in prose wrap naturally; only check tap size.
    } else {
      // Count lines per text node: icons and avatars stacked in a flex
      // column are not wrapped text.
      let lines = 0
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let t = tw.nextNode(); t; t = tw.nextNode()) {
        if (!t.textContent.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(t)
        const tops = new Set([...range.getClientRects()].filter((r) => r.width > 1).map((r) => Math.round(r.top)))
        lines = Math.max(lines, tops.size)
      }
      if (lines >= 3) add(el, 'control-wraps', 'medium', { lines })
    }
    const r = el.getBoundingClientRect()
    if (el.matches('input[type="hidden"], label')) continue
    // WCAG 2.5.8 exempts targets inline in a sentence: their size is set by
    // the line height.
    const inlineInText = style(el).display === 'inline' &&
      [...(el.parentElement?.childNodes || [])].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (inlineInText) continue
    if (r.width < 24 || r.height < 24) {
      add(el, 'small-tap-target', 'low', { width: Math.round(r.width), height: Math.round(r.height) })
    }
  }

  return { page, issues }
}

// Runs inside the page. Simulates content growth: longer strings (as after
// translation or with real user data) and more items in horizontal groups
// (chips, tabs, avatars, header buttons). Layouts that look fine with demo
// data often break with the first long name or the fourth chip.
function applyStress({ textFactor, repeat, maxItems, ignore, grow = [], noGrow = [] }) {
  const skip = (el) =>
    !el || el.closest('script, style, noscript, textarea, svg, [data-qa-no-stress]') ||
    ignore.some((sel) => el.closest(sel))
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
  }
  const sig = (el) => el.tagName + '.' + [...el.classList].sort().join('.')

  // 1. Groups that grow with data (chips, tags, avatars, filter pills) get
  //    more members. Navigation, tab bars, toolbars and tables have a fixed
  //    set of items, so they are never multiplied; vertical lists only get
  //    longer, which rarely breaks anything.
  const fixedSet = 'nav, header, table, [role="tablist"], [role="radiogroup"], [role="toolbar"], [role="menubar"]'
  const pill = (el) => {
    const st = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return parseFloat(st.borderTopLeftRadius) >= r.height / 2 - 1 && r.width > r.height
  }
  let cloned = 0
  for (const el of [...document.body.querySelectorAll('*')]) {
    if (skip(el) || noGrow.some((sel) => el.matches(sel))) continue
    const explicit = grow.some((sel) => el.matches(sel))
    if (!explicit && el.closest(fixedSet)) continue
    const kids = [...el.children].filter(visible)
    if (kids.length < 2) continue
    const groups = new Map()
    for (const k of kids) groups.set(sig(k), [...(groups.get(sig(k)) || []), k])
    const [, alike] = [...groups].sort((a, b) => b[1].length - a[1].length)[0]
    if (alike.length < 2 || alike.length / kids.length < 0.6) continue
    const tops = new Set(alike.map((k) => Math.round(k.getBoundingClientRect().top)))
    if (!explicit) {
      if (tops.size === alike.length) continue // stacked vertically
      const wraps = getComputedStyle(el).flexWrap === 'wrap'
      if (!wraps && !alike.every(pill)) continue // a fixed row of controls
    }
    const target = Math.min(alike.length * repeat, maxItems)
    const last = alike[alike.length - 1]
    for (let i = alike.length; i < target; i++) {
      const copy = alike[i % alike.length].cloneNode(true)
      copy.removeAttribute('id')
      copy.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'))
      last.after(copy)
      cloned++
    }
  }

  // 2. Every string grows by textFactor. One-word labels grow as a single
  //    longer word (it cannot wrap, like a German compound); phrases grow
  //    with extra words.
  let grown = 0
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const nodes = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n)
  for (const node of nodes) {
    const text = node.textContent
    const core = text.trim()
    // Numbers, scores and initials ("NR", "8VA") keep their length in any
    // language or with any data.
    if (!core || skip(node.parentElement)) continue
    if (/^[\d\s.,:;+\-\u2212–—%/()#·•|×▲▼]+$/.test(core)) continue
    if (/\d/.test(core) && core.length <= 6) continue
    if (/^\p{Lu}{1,3}$/u.test(core)) continue
    const target = Math.ceil(core.length * textFactor)
    let out = core
    if (!/\s/.test(core)) {
      // Double letters left to right (vowels first) until it is long enough.
      const isVowel = (c) => /[aeiouáéíóú]/i.test(c)
      while (out.length < target) {
        let next = ''
        let extra = target - out.length
        const anyVowel = [...out].some(isVowel)
        for (const c of out) {
          next += c
          if (extra > 0 && (isVowel(c) || !anyVowel) && /\p{L}/u.test(c)) {
            next += c
            extra--
          }
        }
        if (next.length === out.length) next += out.slice(-1)
        out = next
      }
    } else {
      const words = core.split(/\s+/)
      let i = 0
      while (out.length < target) out += ' ' + words[i++ % words.length]
    }
    node.textContent = text.replace(core, out)
    grown++
  }
  document.documentElement.dataset.qaStress = '1'
  return { cloned, grown }
}

// Runs inside the page. Checks layout expectations declared in the config,
// e.g. { "selector": ".chips", "wrap": true, "align": "center" }: the chips
// must wrap onto new rows (not overflow) and every row must be centered.
function checkRules({ rules }) {
  const els = window.__qaEls || (window.__qaEls = [])
  const issues = []
  for (const rule of rules) {
    for (const el of document.querySelectorAll(rule.selector)) {
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      const st = getComputedStyle(el)
      const left = r.left + parseFloat(st.paddingLeft) + parseFloat(st.borderLeftWidth)
      const right = r.right - parseFloat(st.paddingRight) - parseFloat(st.borderRightWidth)
      const kids = [...el.children].map((k) => [k, k.getBoundingClientRect()]).filter(([, b]) => b.width > 0)
      const problems = []
      if (rule.wrap) {
        const out = kids.filter(([, b]) => b.right > right + 1 || b.left < left - 1)
        if (out.length) problems.push(`${out.length} item(s) overflow instead of wrapping onto a new row`)
      }
      if (rule.align && kids.length) {
        const rows = []
        for (const [, b] of kids) {
          const row = rows.find((x) => Math.abs(x.top - b.top) < 4)
          if (row) {
            row.l = Math.min(row.l, b.left)
            row.r = Math.max(row.r, b.right)
          } else rows.push({ top: b.top, l: b.left, r: b.right })
        }
        rows.forEach((row, i) => {
          const gapL = row.l - left
          const gapR = right - row.r
          const bad =
            rule.align === 'center' ? Math.abs(gapL - gapR) > 6 :
            rule.align === 'start' ? gapL > 6 :
            rule.align === 'end' ? gapR > 6 : false
          if (bad) problems.push(`row ${i + 1} is not ${rule.align}-aligned (left gap ${Math.round(gapL)}px, right gap ${Math.round(gapR)}px)`)
        })
      }
      if (rule.maxRows && kids.length) {
        const tops = new Set(kids.map(([, b]) => Math.round(b.top / 4)))
        if (tops.size > rule.maxRows) problems.push(`items take ${tops.size} rows (max ${rule.maxRows})`)
      }
      if (!problems.length) continue
      els.push(el)
      issues.push({
        index: els.length - 1,
        type: 'layout-rule',
        severity: rule.severity || 'medium',
        selector: rule.selector,
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        detail: { rule: rule.description || JSON.stringify({ wrap: rule.wrap, align: rule.align, maxRows: rule.maxRows }), problem: problems.join('; ') },
        rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) },
      })
    }
  }
  return issues
}

// Draw numbered boxes around the given issue indexes (inside the page).
function annotate({ items, banner }) {
  document.getElementById('__qa_overlay')?.remove()
  const root = document.createElement('div')
  root.id = '__qa_overlay'
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;'
  const colors = { critical: '#d1001f', high: '#ff3b30', medium: '#ff9500', low: '#2f7cf6' }
  for (const { index, n, severity } of items) {
    const el = window.__qaEls?.[index]
    if (!el) continue
    const r = el.getBoundingClientRect()
    const c = colors[severity] || '#ff3b30'
    const box = document.createElement('div')
    const vw = document.documentElement.clientWidth
    box.style.cssText = `position:absolute;left:${Math.max(r.left, 0)}px;top:${r.top}px;` +
      `width:${Math.max(Math.min(r.right, vw) - Math.max(r.left, 0), 4)}px;height:${Math.max(r.height, 4)}px;` +
      `outline:2px solid ${c};outline-offset:1px;background:${c}14;border-radius:3px;`
    // Number badge just above the box's right end: text usually starts on
    // the left, so this hides less of what the box points at.
    const tag = document.createElement('div')
    tag.textContent = String(n)
    const right = Math.min(r.right, vw)
    tag.style.cssText = `position:absolute;left:${Math.max(Math.min(right - 18, vw - 20), 0)}px;` +
      `top:${r.top >= 18 ? r.top - 17 : r.bottom + 1}px;min-width:18px;height:16px;padding:0 3px;box-sizing:border-box;` +
      `background:${c};color:#fff;font:700 11px/16px system-ui,sans-serif;text-align:center;` +
      `border-radius:8px;box-shadow:0 1px 2px #0006;`
    root.append(box, tag)
  }
  if (banner) {
    const b = document.createElement('div')
    b.textContent = banner
    b.style.cssText = 'position:absolute;right:6px;bottom:6px;max-width:calc(100% - 12px);padding:4px 10px;' +
      'background:#d1001fe6;color:#fff;font:700 12px/1.3 system-ui,sans-serif;border-radius:12px;box-shadow:0 1px 4px #0008;'
    root.append(b)
  }
  document.body.append(root)
}

// ---------------------------------------------------------------- run

function log(msg) {
  process.stderr.write(msg + '\n')
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const slug = (s) => s.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'

async function settle(page, cfg, route) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  if (route.waitFor) await page.waitForSelector(route.waitFor, { timeout: 10000 }).catch(() => {})
  await page.evaluate(() => document.fonts?.ready).catch(() => {})
  // Pause animations and transitions so screenshots are stable.
  await page.addStyleTag({
    content: '*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}',
  }).catch(() => {})
  await sleep(route.waitMs ?? cfg.waitMs)
}

async function fontReport(page) {
  return page.evaluate(() => {
    const faces = [...(document.fonts || [])]
    const failed = faces.filter((f) => f.status === 'error').map((f) => f.family.replace(/"/g, ''))
    const loaded = faces.filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, ''))
    return { loaded: [...new Set(loaded)], failed: [...new Set(failed)] }
  })
}

// Pick scroll positions so every issue lands inside some viewport shot.
// Viewport shots (not fullPage) keep fixed headers/tab bars where users see
// them instead of stamped in the middle of a tall image.
function planShots(issues, viewportHeight, max) {
  const shots = [{ scrollY: 0, items: [] }]
  const sorted = [...issues].sort((a, b) => a.rect.y - b.rect.y)
  for (const issue of sorted) {
    const fits = shots.find((s) => issue.rect.y >= s.scrollY && issue.rect.y + Math.min(issue.rect.height, 60) <= s.scrollY + viewportHeight)
    if (fits) fits.items.push(issue)
    else if (shots.length < max) shots.push({ scrollY: Math.max(issue.rect.y - Math.round(viewportHeight / 3), 0), items: [issue] })
    else shots[shots.length - 1].items.push(issue) // shown in list, maybe off-shot
  }
  return shots
}

// Measure the current layout, then take annotated viewport screenshots.
async function measureScreen(page, cfg, vp, id, shotsDir, errors) {
  await page.evaluate(() => scrollTo(0, 0))
  const { page: pageInfo, issues } = await page.evaluate(detectIssues, { ignore: cfg.ignore })
  if (cfg.layoutRules.length) issues.push(...(await page.evaluate(checkRules, { rules: cfg.layoutRules })))
  for (const e of errors) {
    issues.push({ type: 'page-error', severity: 'critical', selector: '(page)', text: e.slice(0, 200), rect: { x: 0, y: 0, width: 0, height: 0 }, index: -1 })
  }
  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.rect.y - b.rect.y)
  issues.forEach((i, n) => (i.n = n + 1))

  const banner = pageInfo.horizontalScroll
    ? `↔ Horizontal scroll: ${pageInfo.documentWidth}px content in ${pageInfo.viewportWidth}px`
    : null
  const plan = planShots(issues.filter((i) => i.index >= 0), vp.height, cfg.maxShotsPerScreen)
  const shots = []
  for (let s = 0; s < plan.length; s++) {
    const shot = plan[s]
    await page.evaluate((y) => scrollTo(0, y), shot.scrollY)
    await sleep(150)
    await page.evaluate(annotate, {
      items: shot.items.map((i) => ({ index: i.index, n: i.n, severity: i.severity })),
      banner: s === 0 ? banner : null,
    })
    const file = `${id}--${s + 1}.png`
    await page.screenshot({
      path: path.join(shotsDir, file),
      mask: cfg.mask.map((sel) => page.locator(sel)),
      maskColor: '#222',
    })
    shots.push({ file: `screenshots/${file}`, scrollY: shot.scrollY, issues: shot.items.map((i) => i.n) })
    await page.evaluate(() => document.getElementById('__qa_overlay')?.remove())
  }
  return { page: pageInfo, issues: issues.map(({ key, index, ...rest }) => rest), shots }
}

async function applyAuth(context, cfg) {
  const { localStorage: ls = {}, sessionStorage: ss = {}, cookies } = cfg.auth
  const themeStorage = cfg.themeStorage
  await context.addInitScript(
    ({ ls, ss, origin }) => {
      if (location.origin !== origin) return
      try {
        for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
        for (const [k, v] of Object.entries(ss)) sessionStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
      } catch {}
    },
    { ls, ss, origin: new URL(cfg.baseUrl).origin },
  )
  if (cookies?.length) {
    await context.addCookies(cookies.map((c) => ({ url: cfg.baseUrl, ...c })))
  }
  return themeStorage
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(HELP)
    return
  }
  const cfg = loadConfig(args)
  const { chromium } = loadPlaywright()
  const shotsDir = path.join(cfg.outDir, 'screenshots')
  fs.rmSync(shotsDir, { recursive: true, force: true })
  fs.mkdirSync(shotsDir, { recursive: true })
  const cacheDir = path.join(cfg.outDir, '.cache')
  const curlFailures = new Set()

  const server = await ensureServer(cfg)
  const browser = await launchChromium(chromium)
  const results = []
  let authScript = null
  if (cfg.auth.script) authScript = (await import(cfg.auth.script)).default

  try {
    for (const vp of cfg.viewports) {
      for (const theme of cfg.themes) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: cfg.deviceScaleFactor ?? 1,
          isMobile: vp.mobile,
          hasTouch: vp.mobile,
          colorScheme: theme === 'dark' ? 'dark' : 'light',
          locale: cfg.locale,
        })
        if (cfg.curlHosts.length) {
          await context.route(
            (url) => cfg.curlHosts.includes(url.hostname),
            makeCurlRoute(cacheDir, curlFailures),
          )
        }
        for (const pattern of cfg.block || []) await context.route(pattern, (r) => r.abort())
        await applyAuth(context, cfg)
        if (cfg.themeStorage) {
          const { key, values } = cfg.themeStorage
          await context.addInitScript(
            ({ key, value }) => {
              try { localStorage.setItem(key, value) } catch {}
            },
            { key, value: values?.[theme] ?? theme },
          )
        }
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', (e) => errors.push(String(e.message || e)))
        if (authScript) {
          await page.goto(cfg.baseUrl + '/')
          await authScript(page, context, { theme, viewport: vp })
        }

        for (const route of cfg.routes) {
          const name = route.name || slug(route.path)
          const id = `${name}--${vp.name}--${theme}`
          log(`• ${route.path}  ${vp.width}px  ${theme}`)
          errors.length = 0
          let status = null
          try {
            const res = await page.goto(cfg.baseUrl + route.path, { waitUntil: 'domcontentloaded', timeout: 30000 })
            status = res?.status() ?? null
          } catch (err) {
            results.push({ id, route: route.path, name, viewport: vp, theme, error: String(err.message), issues: [], shots: [] })
            continue
          }
          await settle(page, cfg, route)
          for (const step of route.actions || []) {
            if (step.click) await page.click(step.click).catch(() => {})
            if (step.fill) await page.fill(step.fill[0], step.fill[1]).catch(() => {})
            if (step.wait) await sleep(step.wait)
          }
          const finalUrl = page.url()
          const fonts = await fontReport(page)
          const variants = ['normal']
          if (cfg.stress && cfg.stress.themes.includes(theme)) variants.push('stress')
          for (const variant of variants) {
            let stressInfo = null
            if (variant === 'stress') {
              await page.evaluate(() => scrollTo(0, 0))
              stressInfo = await page.evaluate(applyStress, { ...cfg.stress, ignore: cfg.ignore })
              await sleep(250)
            }
            const vid = variant === 'stress' ? `${id}--stress` : id
            const measured = await measureScreen(page, cfg, vp, vid, shotsDir, variant === 'normal' ? errors : [])
            results.push({
              id: vid, route: route.path, name, finalUrl, status, viewport: vp, theme, variant, stress: stressInfo,
              fonts, ...measured,
            })
          }
        }
        await context.close()
      }
    }
  } finally {
    await browser.close()
    stopServer(server)
  }

  const report = buildReport(cfg, results, [...curlFailures])
  fs.writeFileSync(path.join(cfg.outDir, 'issues.json'), JSON.stringify(report, null, 2))
  fs.writeFileSync(path.join(cfg.outDir, 'report.md'), renderMarkdown(report))
  const template = fs.readFileSync(path.join(HERE, '..', 'templates', 'report.html'), 'utf8')
  fs.writeFileSync(
    path.join(cfg.outDir, 'report.html'),
    template.replace('/*__REPORT_DATA__*/null', JSON.stringify(report).replace(/</g, '\\u003c')),
  )
  const s = report.summary
  log(`\nDone: ${s.findings} findings (${s.bySeverity.critical} critical, ${s.bySeverity.high} high, ` +
    `${s.bySeverity.medium} medium, ${s.bySeverity.low} low) across ${s.screens} screens.` +
    (report.stress ? ` Stress test: ${s.stressFindings} more when content grows.` : ''))
  log(`Report: ${path.join(cfg.outDir, 'report.md')}`)
  process.stdout.write(JSON.stringify({ outDir: cfg.outDir, summary: s }) + '\n')
}

// Merge the same problem seen on several viewports/themes into one finding.
function buildReport(cfg, results, curlFailures) {
  const findings = new Map()
  for (const r of results) {
    for (const i of r.issues) {
      // Rows of the same list share a selector once :nth-of-type is dropped:
      // report them once, with a count, instead of one finding per row.
      const generic = i.selector.replace(/:nth-of-type\(\d+\)/g, '')
      // A color pair is one design-token decision: report it once for the
      // whole app, wherever it shows up.
      const variant = r.variant || 'normal'
      const key = variant + '|' + (i.type === 'low-contrast'
        ? `${i.type}|${r.theme}|${i.detail.color}|${i.detail.background}`
        : `${r.route}|${i.type}|${generic}` +
          (i.type === 'layout-rule' ? '|' + i.detail.problem.replace(/[\d.]+/g, '#') : ''))
      const shot = r.shots.find((s) => s.issues.includes(i.n))
      const seen = { viewport: r.viewport.name, width: r.viewport.width, theme: r.theme, n: i.n, shot: shot?.file, detail: i.detail }
      if (!findings.has(key)) {
        findings.set(key, { variant, route: r.route, routes: [r.route], type: i.type, severity: i.severity, selector: generic, text: i.text, examples: [i.text], seen: [seen] })
      } else {
        const f = findings.get(key)
        if (!f.routes.includes(r.route)) f.routes.push(r.route)
        if (i.text && !f.examples.includes(i.text)) f.examples.push(i.text)
        if (!f.seen.some((x) => x.viewport === seen.viewport && x.theme === seen.theme)) f.seen.push(seen)
        if (SEVERITY_ORDER[i.severity] < SEVERITY_ORDER[f.severity]) f.severity = i.severity
      }
    }
  }
  // A problem that already shows with normal content is not repeated in the
  // stress section: there we only want what growth *adds*.
  const normalKeys = new Set([...findings.keys()].filter((k) => k.startsWith('normal|')).map((k) => k.slice(7)))
  for (const k of [...findings.keys()]) {
    if (k.startsWith('stress|') && normalKeys.has(k.slice(7))) findings.delete(k)
  }
  const sortF = (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.seen.length - a.seen.length
  const list = [...findings.values()].filter((f) => f.variant === 'normal').sort(sortF)
  // Under stress nothing is broken *yet*: cap at high so real, current
  // problems stay on top.
  for (const f of findings.values()) if (f.variant === 'stress' && f.severity === 'critical') f.severity = 'high'
  const stressList = [...findings.values()].filter((f) => f.variant === 'stress').sort(sortF)
  list.forEach((f, i) => (f.id = `F${i + 1}`))
  stressList.forEach((f, i) => (f.id = `S${i + 1}`))
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const f of list) bySeverity[f.severity]++
  const stressBySeverity = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const f of stressList) stressBySeverity[f.severity]++
  const fontsFailed = [...new Set(results.flatMap((r) => r.fonts?.failed || []))]
  return {
    generatedAt: new Date().toISOString(),
    baseUrl: cfg.baseUrl,
    viewports: cfg.viewports,
    themes: cfg.themes,
    stress: cfg.stress || null,
    summary: {
      screens: results.filter((r) => r.variant !== 'stress').length,
      findings: list.length,
      bySeverity,
      stressFindings: stressList.length,
      stressBySeverity,
    },
    warnings: [
      ...fontsFailed.map((f) => `Font "${f}" failed to load: screenshots use a fallback font and widths may differ.`),
      ...curlFailures.map((u) => `Could not fetch through curl: ${u}`),
      ...results.filter((r) => r.error).map((r) => `${r.route} (${r.viewport.name}, ${r.theme}): ${r.error}`),
      ...results
        .filter((r) => r.variant !== 'stress' && r.finalUrl && new URL(r.finalUrl).pathname !== r.route.split('?')[0])
        .map((r) => `${r.route} redirected to ${new URL(r.finalUrl).pathname} (${r.viewport.name}, ${r.theme}) — check the login/demo setup.`),
    ].filter((w, i, a) => a.indexOf(w) === i),
    findings: list,
    stressFindings: stressList,
    screens: results,
  }
}

const TYPE_LABEL = {
  'page-error': 'JavaScript error on the page',
  'overflow-viewport': 'Element sticks out of the viewport',
  'text-clipped': 'Text is cut off (clipped without ellipsis)',
  'text-overflows-box': 'Text spills out of its container',
  'overlap': 'Elements overlap each other',
  'low-contrast': 'Text contrast below WCAG minimum',
  'control-wraps': 'Button/control label wraps onto 3+ lines',
  'text-truncated': 'Text truncated with ellipsis',
  'small-tap-target': 'Tap target smaller than 24×24px',
  'layout-rule': 'Layout rule from the config is broken',
}

function renderMarkdown(report) {
  const { summary: s } = report
  const out = [
    '# Responsive check report',
    '',
    `${report.baseUrl} · ${report.viewports.map((v) => `${v.name} ${v.width}px`).join(', ')} · ${report.themes.join(' + ')} · ${s.screens} screens`,
    '',
    `**${s.findings} findings:** ${s.bySeverity.critical} critical, ${s.bySeverity.high} high, ${s.bySeverity.medium} medium, ${s.bySeverity.low} low.`,
    '',
  ]
  if (report.warnings.length) {
    out.push('## Warnings', '', ...report.warnings.map((w) => `- ${w}`), '')
  }
  out.push('## Findings', '')
  if (!report.findings.length) out.push('No layout problems found.', '')
  renderFindings(out, report.findings)
  if (report.stress) {
    const st = report.stress
    out.push('## Fragile under growth (stress test)', '',
      `Re-measured with texts ${Math.round((st.textFactor - 1) * 100)}% longer and up to ${st.repeat}× the items in horizontal groups (${st.themes.join(', ')}). ` +
      'Only problems that do not show with the normal content are listed.', '')
    if (!report.stressFindings.length) out.push('Nothing new breaks when content grows.', '')
    renderFindings(out, report.stressFindings)
  }
  out.push('## Screens', '', '| Screen | Viewport | Theme | Issues | Screenshots |', '|---|---|---|---|---|')
  for (const r of report.screens) {
    out.push(`| \`${r.route}\`${r.variant === 'stress' ? ' (stress)' : ''} | ${r.viewport.width}px | ${r.theme} | ${r.issues.length} | ${r.shots.map((x, i) => `[${i + 1}](${x.file})`).join(' ')} |`)
  }
  return out.join('\n') + '\n'
}

function renderFindings(out, findings) {
  for (const f of findings) {
    const where = f.seen.map((x) => `${x.width}px ${x.theme}`).join(', ')
    out.push(`### ${f.id} · ${f.severity.toUpperCase()} · ${TYPE_LABEL[f.type] || f.type}`)
    out.push('')
    out.push(`- Screen: ${f.routes.map((x) => `\`${x}\``).join(', ')} — seen at ${where}`)
    const ex = f.examples.filter(Boolean)
    out.push(`- Element: \`${f.selector}\`${ex.length ? ` — ${ex.slice(0, 3).map((t) => `“${t}”`).join(', ')}` : ''}${ex.length > 1 ? ` (${ex.length} elements)` : ''}`)
    const d = f.seen[0].detail
    if (d) out.push(`- Detail: ${Object.entries(d).map(([k, v]) => `${k}=${v}`).join(', ')}`)
    const shot = f.seen.find((x) => x.shot)
    if (shot) out.push(`- Screenshot: [${shot.shot}](${shot.shot}) (marker #${shot.n})`)
    out.push('')
  }
}

run().catch((err) => {
  log(`responsive-check failed: ${err.stack || err.message}`)
  process.exit(1)
})
