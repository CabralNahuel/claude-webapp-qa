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
| `viewports` | array | 360, 390, 1280 | Names (`phone-small`, `phone`, `desktop`), `"WIDTHxHEIGHT"` strings, or `{ "name", "width", "height", "mobile" }`. |
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
| `control-wraps` | A button/tab label breaks onto 3 or more lines. |
| `text-truncated` | Ellipsis or line-clamp is hiding text. Often intentional; worth a look on buttons and headings. |
| `small-tap-target` | A control smaller than 24×24px (WCAG 2.5.8), except links inline in a sentence. |
