---
name: responsive-check
description: Run a web app locally and walk its screens on a small phone (360px), a phone (390px) and a desktop (1280px), in light and dark mode, with Playwright. Finds text that overflows or gets cut off, containers that stick out, horizontal scroll, buttons and headers that do not fit, and returns annotated screenshots plus a prioritized report. Use it whenever the user wants to check how an app looks on mobile, asks for a responsive/visual QA pass, says something "se ve mal en el celular", wants screenshots of screens before a release, or shares a React/Vite/Next app and asks if the layout breaks anywhere — even if they never say "responsive".
---

# Responsive check

Walk every screen the user cares about at three widths and two color schemes,
let a script measure what is broken, then look at the annotated screenshots
yourself and report what matters, worst first.

The script does the measuring (it is deterministic and fast); your job is to
set it up correctly, sanity-check its findings against the images, and turn
them into a short report a developer can act on.

## 1. Gather what you need

Ask only for what you cannot find in the repo:

- **How to start the app.** Read `package.json`: usually `npm run dev`
  (Vite → `http://localhost:5173`, Next → `:3000`, CRA → `:3000`). If the
  dependencies are not installed, run `npm ci` (or the lockfile's tool) first.
- **Which screens.** If the user gave routes, use them. Otherwise list the
  router's paths (`grep -rn "path=" src`, `app/` or `pages/` folders) and pick
  the ones a user actually lands on; skip routes that need an ID unless you
  can find a demo one.
- **How to get in.** Most screens sit behind a login. Look for a demo or
  sandbox mode before asking for credentials: search for `demo`, `sandbox`,
  `mock`, `localStorage.setItem` near the auth code. Often entering is just a
  localStorage key (see `references/login-recipes.md`). If the user told you
  how to get in, use exactly that.
- **How the theme is chosen.** The script emulates `prefers-color-scheme`.
  If the app stores a manual choice (e.g. `localStorage.theme = "dark"`),
  add `themeStorage` so the stored choice matches the emulated scheme —
  otherwise a stale stored value wins and both runs look the same.

## 2. Write the config

Create `qa.config.json` next to where you will write the report (not inside
the user's `src/`). Full format in `references/config.md`. Typical:

```json
{
  "baseUrl": "http://localhost:5173",
  "start": { "command": "npm run dev", "cwd": "." },
  "routes": ["/", "/ranking", { "path": "/settings", "waitFor": "form" }],
  "auth": { "localStorage": { "app.demoUser": { "uid": "demo", "demo": true } } },
  "themeStorage": { "key": "app.theme" },
  "locale": "es-AR",
  "mask": [".avatar-photo"],
  "outDir": "qa-report/responsive"
}
```

Set `locale` to the app's real audience: the browser defaults to en-US and
many apps switch language from it, and Spanish or German strings are longer —
which is precisely where layouts break.

If the user only cares about some widths or one theme ("el celu chico en
modo oscuro"), pass `--viewports` / `--themes` instead of running all six
combinations. Add `phone-xs` (320px) when the audience has older or small
phones, or when 360px is clean but tight: many collisions only show up there.

### Growth: longer texts, more items

Demo data is short and tidy; real data is not. When the user asks what
happens "if the name is longer", "if there are more chips", "in German",
or before a release where content is user-generated, add `"stress": true`.
Each screen is then measured a second time after the script:

- makes every string ~40% longer (one-word labels become one longer word,
  so they cannot wrap — like a translation; numbers and initials are kept),
- triples the members of groups that grow with data: wrapping flex rows and
  pill-shaped chips (never nav bars, tab bars, toolbars or tables, which
  have a fixed set). Add selectors to `stress.grow` / `stress.noGrow` when
  the guess is wrong.

This DOM stress is generic and quick. When the app's demo data is
seedable (a localStorage key, a fixtures file, a seed script), realistic
data is better: put long names and a crowded list into `auth.localStorage`
(e.g. 18 players on the bench, three-word surnames) and run normally —
the app then lays it out exactly as it would for a real group. Use both
when growth is the question: seeded data for realism, `stress` for every
screen you did not seed.

The report lists, under "Fragile under growth", only what breaks *because*
of the growth (capped at high: it is not broken for users yet).

When the user describes how something should reflow ("the chips should go
to two centered rows"), encode it as a layout rule so it is checked instead
of eyeballed:

```json
"layoutRules": [
  { "selector": ".filter-chips", "wrap": true, "align": "center", "description": "chips wrap onto centered rows" },
  { "selector": ".header-actions", "maxRows": 1 }
]
```

`wrap` fails if items overflow instead of wrapping, `align` (`start` |
`center` | `end`) checks every row, `maxRows` caps the rows. Rules run on
normal and stressed content, so a rule that only fails under stress means
"fine today, breaks with more data".

## 3. Run it

```bash
node <skill-dir>/scripts/responsive_check.mjs --config qa.config.json
```

It starts the app if nothing answers on `baseUrl` (and stops it at the end),
visits each route at each viewport × theme, and writes to `outDir`:

- `report.md` and `report.html` — findings merged across viewports, worst first
- `issues.json` — the raw data per screen
- `screenshots/*.png` — viewport shots with numbered boxes on each problem

Environment notes that save time:

- **Playwright/Chromium.** The script looks for `playwright` in the project,
  then in `/opt/node-tools/node_modules/playwright`, and falls back to the
  Chromium at `/opt/pw-browsers/chromium` (override with `PLAYWRIGHT_MODULE`
  / `CHROMIUM_PATH`). Do not run `playwright install` in a sandbox: it
  downloads ~150 MB and usually fails behind a proxy.
- **Fonts without network.** In sandboxes the browser often cannot reach the
  internet while `curl` can (it goes through the proxy). Without the real
  web font every text measures differently and the findings are wrong. The
  script therefore fetches `fonts.googleapis.com` and `fonts.gstatic.com`
  with curl and serves them through `page.route` (cached in `outDir/.cache`).
  Add other font/CDN hosts to `curlHosts` if the app uses them. If the
  report warns that a font failed, fix that before trusting any finding.
- **Screenshots are viewport-sized on purpose.** A `fullPage` shot stamps
  fixed headers and tab bars in the middle of a long image, which looks like
  a bug and hides real ones. The script scrolls to each problem and takes a
  viewport shot instead. If you need a closer look at one component, take an
  element screenshot (`locator.screenshot()`) yourself.

## 4. Review before reporting

Open the screenshots for every critical/high finding and a sample of the
rest (Read the PNGs). The detector is geometric; you are the one who knows
whether it matters:

- **Confirm it is real.** A marquee, carousel or code block meant to scroll
  is fine; a price that loses its last digits is not.
- **Check the redirect warning.** If a route redirected (e.g. to `/login`),
  the auth setup is wrong and every screenshot of it shows the wrong page.
  Fix the config and rerun rather than reporting on the login screen.
- **Look for what the detector cannot see**: contrast over images or
  gradients (it only measures solid backgrounds), an image squashed, a fixed bar covering the last item, a gap
  between two stacked fixed bars (a floating button above a tab bar) where
  the list shows through, content hidden behind the on-screen keyboard.
  Mention these separately as "seen in screenshots". Check the bottom of
  each scrolled shot: that is where fixed bars meet content.
- **Do not leak people's data.** If screenshots show real names, emails or
  photos (not demo data), add their selectors to `mask` and rerun before
  sharing images.

If you change the config, rerun — the script is cheap and the report must
match the screenshots.

## 5. Report

Reply in the user's language. Lead with the verdict, then the findings
grouped by priority. Keep it scannable:

```
**Responsive check — 6 screens × 3 widths × light/dark**
2 critical, 3 high, 4 medium (lows in the full report).

### Critical
1. **/checkout — page scrolls sideways at 360 and 390px.** `.promo-banner`
   has `width: 420px`; use `max-width: 100%`. → screenshots/checkout--phone-small--light--1.png
...
### Seen in screenshots (not auto-detected)
- Dark mode: the secondary text on cards is hard to read.

Full report: qa-report/responsive/report.html
```

For each finding give: screen and widths, what the user sees, the likely
CSS cause when you can tell from the selector or source (read the component
— a fix suggestion is far more useful than a coordinate), and the screenshot
path. Collapse repeats ("all 6 rows of the player list"). Mention lows only
as a count unless the user asked for everything.

Severity guide used by the script (adjust if the context says otherwise):

| Severity | What |
|---|---|
| critical | Page scrolls horizontally; JavaScript error on the page |
| high | Element sticks out of the viewport; text cut off without ellipsis; text spilling out of a button or heading; two pieces of content overlapping (a badge running into a pill) |
| medium | Text contrast under WCAG 4.5:1 (high when far below); text spilling out of other boxes; button label wrapping to 3+ lines; a badge broken onto several lines; a phrase squeezed to one word per line; ellipsis on a button or heading |
| low | Ellipsis on body text; tap target under 24×24px |
| (rules) | A `layoutRules` expectation is broken: medium unless the rule sets `severity` |

Do not fix the app's code unless the user asks; offer to. To show that a
proposed CSS fix works, rerun with it in `injectCss` (it is added to the
page, the source stays untouched) and compare the two reports.
