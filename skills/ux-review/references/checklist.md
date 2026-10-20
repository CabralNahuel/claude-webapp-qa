# UX review checklist

Four core rules first: they catch most of what makes an app feel confusing.
Then a quick pass over `guidelines.md` for the rest. For each rule: what to
look at, how to judge it, and what the inventory script already measured
(`ux-inventory.json` / `.md`).

## 1. One meaning per icon, and icons with text

An icon is a word the user has to learn. If the same drawing means two
things, or one thing is drawn two ways, they have to relearn it on every
screen.

- **Same icon, different meanings** — the script groups controls by icon
  (SVG shape, image, emoji) across the whole app and lists the names. Judge
  whether the names are really different actions ("Sortear equipos" vs the
  "Al azar" mode: different) or one action phrased twice ("Compartir" vs
  "Compartir por WhatsApp": same — fine).
- **Same meaning, different icons** — "Editar" as a pencil here and a gear
  there. Pick one.
- **Icon-only controls** — the script lists them. Accept them only for the
  handful everyone reads without a label: close (×), back (←) in a header,
  search (magnifier), menu (☰), and tabs in a bottom bar *that show a label*.
  Everything else (edit, delete, share, settings, info, filters, a trophy
  that means "tournaments") gets a visible word, or at least a word next to
  it on first use. An `aria-label` helps screen readers, not sighted users.
- **Emoji as icons** — they render differently per OS and do not take the
  brand color. Fine as decoration in content (a 🔥 streak badge can be part
  of the tone); not as the only label of a control.
- **Color as meaning** — red/green alone for win/loss or error/success
  fails for color-blind users: add a sign (▲▼, +/−) or a word.

## 2. One primary button for the moment

At any moment the screen should say "this is the next thing to do". Two
filled, colored buttons side by side make the user stop and compare.

- The script flags screens with more than one primary-looking button in the
  first viewport (filled/colored, or classed primary/CTA).
- Think in **moments**, not screens: a home screen before an event exists,
  while people sign up, and after the draw are three moments with three
  different primary actions. Use route `actions` in the config to capture
  each state (click "Anotarme", open a modal) and review each one.
- Secondary actions are outlined/ghost or links; destructive ones are never
  styled as the primary.
- Sticky bottom CTAs count: a sticky "SORTEAR" plus a filled card button
  above it are two primaries.

## 3. Destructive actions are protected

Deleting a match, removing a player, leaving a group, resetting a ranking:
one slip of the thumb should not do it.

- With `--probe-destructive` (demo/sandbox data only) the script clicks each
  destructive-looking control on a fresh load and reports `protected` (a
  confirm, a dialog, an inline "¿Seguro? Sí / No", or an undo), `unprotected`
  (it just happened) or `unclear` (check by hand).
- Protection should scale with the damage: undo for cheap actions, an
  inline confirm for one item, a dialog that names the thing ("¿Borrar el
  partido del sábado 10?") for big or irreversible ones, typing the name for
  "delete group/account".
- The confirm button repeats the verb ("Sí, borrar"), not just "OK"; the
  safe option is the easy one (focus/default on Cancel).
- Destructive controls should not sit right next to frequent ones at
  thumb size (an "Editar" and "Borrar" 27px icons side by side is a misfire
  waiting to happen): separate them or move delete into an overflow/menu.

## 4. Clear copy

- **Buttons say what happens**: "Guardar resultado", "Invitar al grupo",
  not "OK", "Enviar", "Continuar". The script flags the vague ones it knows.
- **Same thing, same word** everywhere ("fecha" vs "partido" vs "evento" for
  the same object confuses).
- **Errors say what to do**, in the user's terms: "No pudimos guardar: revisá
  la conexión y probá de nuevo", not "Error 500" or "Algo salió mal".
- **Empty states** explain and offer the next step ("Todavía no hay partidos.
  Cargá el primero").
- **Tone** matches the audience and stays consistent (voseo or tuteo, not
  both).
- **Numbers and units** are explicit ("+26 pts", "hace 2 días").
- Read the `Controls by screen` list in `ux-inventory.md` top to bottom: it
  is every label of the app in one place, which makes inconsistencies jump
  out.

## Then: the rest

Skim `guidelines.md` by category for what applies to this app (forms,
feedback, navigation, accessibility, touch). The script also measured:

- **Visible focus** — controls that look identical when focused with Tab
  (desktop). Keyboard users get lost without it.
- **Form labels** — fields with no label or a placeholder-only label.
- **Alt text** — images with no `alt` (decorative ones need `alt=""`).
- **Headings** — screens without an `h1`.

Layout breakage (overflow, cut text, contrast, tap size) belongs to
responsive-check; run it too rather than repeating it here.
