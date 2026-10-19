# claude-webapp-qa

Claude Code skills to QA web apps: responsive checks across devices, UX review, Firestore rules tests and one-PR releases.

[Leer en español](README.es.md)

![Responsive check report for a React + Vite app](docs/images/report-padel-app.png)

## Skills

| Skill | What it does | Status |
|---|---|---|
| [`responsive-check`](skills/responsive-check/SKILL.md) | Starts your app and walks its screens at 360px, 390px and 1280px, light and dark, with Playwright. Flags horizontal scroll, elements sticking out, cut-off or spilling text, buttons that do not fit; returns annotated screenshots and a prioritized report. | ✅ Ready |
| `release` | Batches changes on an accumulation branch, opens a single PR with a summary, follows CI, fixes failures, shares the preview link and warns about cached public images that changed without a rename. | 🚧 Next |
| `firestore-rules` | For every permission change: the rule, a test that must fail and one that must pass, run in the emulator. | 🚧 Planned |
| `ux-review` | Checklist review: one meaning per icon (with text), one primary button per moment, protected destructive actions, clear copy. | 🚧 Planned |
| `i18n-guard` | Untranslated strings and unused keys. | 🚧 Planned |
| `pre-push` | Lint/test/build, no symlinks or local files committed, no real names in screenshots. | 🚧 Planned |

## Install

In Claude Code:

```
/plugin marketplace add CabralNahuel/claude-webapp-qa
/plugin install webapp-qa@claude-webapp-qa
```

Or copy a skill folder into `~/.claude/skills/` (personal) or `.claude/skills/` (one project).

## responsive-check

Ask in your own words — "check how the app looks on mobile before I ship", "something overflows on /checkout on small phones", "fijate si se ve bien en el celu en modo oscuro". Claude will:

1. Find how to start the app (`npm run dev`) and which routes exist.
2. Find a way in without a real login (demo/sandbox mode, a localStorage key) or use the one you give it.
3. Run [`scripts/responsive_check.mjs`](skills/responsive-check/scripts/responsive_check.mjs) over every route × viewport × theme.
4. Look at the annotated screenshots, discard false alarms, add what the detector cannot see (contrast, covered content) and report worst first, with the likely CSS fix.

<table>
<tr>
<td><img src="docs/images/annotated-historial-360-light.png" width="240" alt="Annotated phone screenshot, light mode"></td>
<td><img src="docs/images/annotated-home-360-dark.png" width="240" alt="Annotated phone screenshot, dark mode"></td>
<td><img src="docs/images/annotated-fixture-360-light.png" width="240" alt="Annotated screenshot of a page with planted layout bugs"></td>
</tr>
<tr>
<td>360px, light: small tap targets</td>
<td>360px, dark</td>
<td>Test fixture with planted bugs</td>
</tr>
</table>

![Report for the fixture with planted bugs](docs/images/report-fixture.png)

### What it detects

| Severity | Finding |
|---|---|
| critical | The page scrolls horizontally · JavaScript error while loading |
| high | Element sticks out of the viewport · text cut off without ellipsis · text spilling out of a button or heading |
| medium | Text spilling out of other boxes · button label wrapping to 3+ lines · ellipsis on buttons/headings |
| low | Ellipsis on body text · tap target under 24×24px (WCAG 2.5.8) |

The same problem seen at several widths or on every row of a list is reported once.

### Running the script yourself

```bash
node skills/responsive-check/scripts/responsive_check.mjs --config qa.config.json
# or
node skills/responsive-check/scripts/responsive_check.mjs \
  --url http://localhost:5173 --start "npm run dev" --routes /,/ranking,/settings \
  --local-storage '{"app.demoUser":{"uid":"demo","demo":true}}'
```

Output: `qa-report/responsive/report.html`, `report.md`, `issues.json` and `screenshots/`. Config reference: [`references/config.md`](skills/responsive-check/references/config.md).

Lessons baked in:

- **Fonts in sandboxes.** Headless browsers often have no network while `curl` goes through the proxy. Without the real web font every measurement is off, so Google Fonts (and any host in `curlHosts`) are fetched with curl and served with `page.route`.
- **Logins.** Most apps have a demo mode; the skill looks for it and sets the localStorage/cookies before the first script runs. Routes that redirect are flagged so you never get a report about the login page.
- **Viewport screenshots, not full-page.** Full-page shots stamp fixed headers and tab bars in the middle of the image. The script scrolls to each problem instead.
- **Dark mode for real.** It emulates `prefers-color-scheme` and, if the app stores a manual choice, writes it too (`themeStorage`).
- **Locale.** Set `locale` to your audience: longer translations are where layouts break.

Requirements: Node 18+ and Playwright (`npm i -D playwright`). It also picks up a global install at `/opt/node-tools/node_modules/playwright` and Chromium at `/opt/pw-browsers/chromium`, as found in Claude Code cloud sessions.

## Repository layout

```
.claude-plugin/        plugin.json + marketplace.json
skills/<name>/         SKILL.md + scripts/ + references/ + templates/
evals/evals.json       test prompts and assertions per skill (skill-creator format)
tools/smoke_test.mjs   validates manifests and skills, runs responsive-check on tools/fixtures
.github/workflows/     CI running the smoke test
```

## Development

```bash
node tools/smoke_test.mjs            # add --browser to require Playwright
```

Skills are written and measured with Anthropic's `skill-creator`: each change is run against the prompts in `evals/evals.json`, with and without the skill, and graded against the assertions.

## License

[MIT](LICENSE)
