# qa.config.json reference

All paths in the config are resolved relative to the config file.
Command-line flags override the config (run the script with `--help`).

| Key | Type | Default | What it does |
|---|---|---|---|
| `baseUrl` | string | — (required) | Where the app answers, e.g. `http://localhost:5173`. |
| `start.command` | string | — | Command that starts the app when `baseUrl` does not answer (e.g. `npm run dev`). The script stops it at the end. |
| `start.cwd` | string | config dir | Where to run `start.command`. |
| `start.timeoutMs` | number | 90000 | How long to wait for the app to answer. |
| `routes` | array | `["/"]` | Paths to visit. Each item is a string or an object (below). |
| `viewports` | array | 360, 390, 1280 | Names (`phone-xs` 320, `phone-small`, `phone`, `desktop`), `"WIDTHxHEIGHT"` strings, or `{ "name", "width", "height", "mobile" }`. |
| `themes` | array | `["light", "dark"]` | Color schemes to emulate (`prefers-color-scheme`). |
| `themeStorage` | object | — | `{ "key": "app.theme", "values": { "light": "light", "dark": "dark" } }`: also writes the app's stored theme choice so it matches the emulated scheme. `values` defaults to the theme names. |
| `locale` | string | browser default (en-US) | e.g. `es-AR`. Sets `navigator.language` and `Accept-Language`. |
| `auth.localStorage` | object | — | Entries written before any page script runs. Objects are JSON-stringified. |
| `auth.sessionStorage` | object | — | Same, for sessionStorage. |
| `auth.cookies` | array | — | Playwright cookies (`{ "name", "value" }`; `url` defaults to `baseUrl`). |
| `auth.script` | string | — | Path to an ES module whose default export is `async (page, context, { theme, viewport }) => {}`; runs once per viewport × theme after opening `/`. Use it for real logins (fill a form, click). |
| `mask` | array | `[]` | Selectors painted over in every screenshot (real names, photos, emails). |
| `ignore` | array | `[]` | Selectors excluded from detection (an intentional marquee, a third-party widget). |
| `curlHosts` | array | Google Fonts hosts | Hosts fetched with curl and served through `page.route`. Add font CDNs (`use.typekit.net`, `rsms.me`). `[]` disables it. |
| `block` | array | `[]` | URL glob patterns to abort (analytics, chat widgets). |
| `stress` | bool / object | — | `true` or `{ "textFactor": 1.4, "repeat": 3, "maxItems": 12, "themes": ["light"], "grow": [], "noGrow": [] }`. Re-measures every screen with grown content (see below). `--stress` on the command line. |
| `layoutRules` | array | `[]` | Expected reflow, e.g. `{ "selector": ".chips", "wrap": true, "align": "center", "maxRows": 2, "description": "...", "severity": "medium" }`. |
| `waitMs` | number | 700 | Extra settle time after load. |
| `maxShotsPerScreen` | number | 4 | Annotated viewport shots per route × viewport × theme. |
| `deviceScaleFactor` | number | 1 | Use 2 for crisper (heavier) screenshots. |
| `outDir` | string | `qa-report/responsive` | Output folder. Its `screenshots/` is recreated each run. |

## Route objects

```json
{
  "path": "/torneo/demo",
  "name": "torneo",
  "waitFor": ".bracket",
  "waitMs": 1500,
  "actions": [{ "click": "button.open-menu" }, { "wait": 300 }]
}
```

- `name` — used in screenshot file names (defaults to the path).
- `waitFor` — selector to wait for before measuring (lazy data, skeletons).
- `actions` — `click`, `fill: [selector, value]` and `wait` (ms) steps run
  before measuring. Use them to open a menu or a modal and check it too.

## Stress mode

After the normal measurement of a screen, in the themes listed in
`stress.themes` (default: the first theme), the page is mutated in place and
measured again:

- **Text** — every text node grows to `textFactor` × its length. Single
  words grow as one word (letters doubled, so they cannot wrap), phrases get
  extra words. Numbers, scores and 1–3 letter initials are left alone.
- **Groups** — a container whose visible children mostly share tag + classes
  and sit side by side gets up to `repeat` × as many (max `maxItems`), but
  only when it wraps (`flex-wrap: wrap`) or its children are pills. Anything
  inside `nav`, `header`, `table` or a tablist/toolbar/radiogroup is a fixed
  set and is skipped. `grow` forces a container, `noGrow` excludes one; mark
  any element with `data-qa-no-stress` to leave it untouched.

Findings that already appear with normal content are not repeated. The rest
go to `stressFindings` in `issues.json` (ids `S1…`) and to the "Fragile under
growth" section of the reports, with critical capped at high. Screenshots
get a `--stress` suffix.

## Layout rules

Each rule applies to every element matching `selector`:

| Field | Check |
|---|---|
| `wrap: true` | No child extends past the container's content box: items must go to a new row instead of overflowing. |
| `align` | `start`, `center` or `end`: every row of children is aligned that way (6px tolerance). |
| `maxRows` | Children occupy at most this many rows. |
| `severity` | Severity of a violation (default `medium`). |

## Output

- `issues.json` — `summary`, `warnings`, merged `findings` (worst first,
  each with every viewport/theme where it was seen) and per-`screens` data
  (issues with document coordinates, screenshot files, fonts loaded/failed,
  final URL).
- `report.md` / `report.html` — the same, readable.
- `screenshots/<route>--<viewport>--<theme>--<n>.png`.

## Issue types

| Type | Meaning |
|---|---|
| `page-error` | Uncaught JavaScript error while loading the screen. |
| `overflow-viewport` | An element's box extends past the left/right edge of the viewport and no ancestor clips or scrolls it. Critical when the page scrolls horizontally. |
| `text-clipped` | A box with `overflow: hidden/clip` and no ellipsis hides part of its own text. |
| `text-overflows-box` | Text extends past the block that contains it (`overflow: visible`). |
| `overlap` | Two pieces of content paint over each other: text lines, or boxes with a background/border (pills, badges). Positioned layers, negative margins and transforms are skipped as intentional. |
| `low-contrast` | Text below WCAG 1.4.3 contrast (4.5:1, or 3:1 for large text) against its solid backdrop, counting opacity. Skipped over images/gradients. One finding per color pair for the whole app. |
| `layout-rule` | A `layoutRules` expectation is not met; `detail.problem` says which. |
| `control-wraps` | A button/tab label breaks onto 3 or more lines. |
| `text-truncated` | Ellipsis or line-clamp is hiding text. Often intentional; worth a look on buttons and headings. |
| `small-tap-target` | A control smaller than 24×24px (WCAG 2.5.8), except links inline in a sentence. |
