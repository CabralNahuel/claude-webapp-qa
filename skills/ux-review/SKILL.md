---
name: ux-review
description: Review a web app's UX screen by screen against a practical checklist — one meaning per icon and icons with text, one primary button for each moment, destructive actions protected (it clicks them on demo data to check), clear copy — plus 75 curated UX guidelines (forms, feedback, focus, accessibility). Collects every control, label and icon with Playwright, flags the mechanical cases, and returns annotated screenshots and a prioritized report with concrete fixes. Use it whenever the user asks for a UX review, "revisá la usabilidad", "¿se entiende la app?", "qué mejorarías", wants feedback on buttons, icons, copy, confirmations or flows before a release — even if they just say "revisá la app".
---

# UX review

The question is not "does the layout break" (that is responsive-check) but
"does a person understand what to do, and is it hard to make a mistake".
A script gathers the evidence — every control with its icon and label,
primary-looking buttons, destructive actions and what happens when they are
clicked, focus, labels — and you judge it against `references/checklist.md`.

## 1. Set up

Reuse responsive-check's `qa.config.json` if there is one (same format:
`baseUrl`, `start`, `routes`, `auth`, `themeStorage`, `locale`, `mask`). If
not, build it the same way: find how to start the app, the routes, and a way
in without a real login (demo/sandbox mode). See responsive-check's
`references/login-recipes.md` if it is installed.

Choose the screens a user actually goes through, and the **moments** within
them: a screen before and after the main action are different moments with
different primary buttons. Capture extra states with route `actions`:

```json
{ "path": "/", "name": "home-signed-up", "actions": [{ "click": "text=Anotarme" }, { "wait": 400 }] }
```

**Walk the core task end to end.** The worst UX bugs live in the middle of
a flow, not on a fresh screen: a result already entered that one tap on ×
deletes, a "draw again" that silently throws away the scores being typed.
Do the main job of the app once (create the thing, fill it, save it), and
capture the screens in those states — with route `actions`, or a short
Playwright script of your own for multi-step flows — so the inventory and
the destructive probe run there too (probes reload the route and replay its
`actions` before clicking).

**Review once per role.** Owner, staff/admin and plain member often see
different navigation, panels and buttons: a club owner's panel never shows
up for a player, and "who appears in the players list" depends on who is
looking. List the roles from the auth/role code (`isAdmin`, `isOwner`,
`role ===`), run the inventory once per role (a config per role with the
matching demo user or `auth.script`), and say in the report which role each
finding belongs to. If the demo cannot switch roles (a mode only enabled by
backend data), say so and review that part from the code and the user's
screenshots rather than skipping it silently.

Check the demo user can see every moment: if it is not a member, an admin or
a player of the demo group, whole states (the sign-up button, admin tools)
never appear. Seed the role in the demo data or log in as one that has it.

## 2. Run the inventory

```bash
node <skill-dir>/scripts/ux_inventory.mjs --config qa.config.json --probe-destructive
```

- `--probe-destructive` clicks every destructive-looking control (borrar,
  eliminar, quitar, salir, 🗑 …) on a fresh page load and records whether the
  app asked first. **Only use it on demo, sandbox or local data**: if an
  action is unprotected, it really runs. Without the flag, destructive
  controls are listed for you to check by hand.
- Output in `qa-report/ux/` (or `--out`): `ux-inventory.md` (findings plus
  every control label per screen), `ux-inventory.json`, and one annotated
  screenshot per screen and viewport (phone 390 + desktop 1280).
- If the report warns that screens redirected, the login setup is wrong:
  fix it and rerun before reviewing anything.

## 3. Review

Go through `references/checklist.md` in order — the four core rules — with
the screenshots and the inventory open. The script's findings are leads,
not verdicts:

- **Confirm or dismiss each one.** Two names for one icon may be the same
  meaning phrased twice; an icon-only "×" in a modal is fine; a "primary"
  that is really a colored card is not a button competing for attention.
- **Add what only a person sees**: the same object called by two names,
  a confirm dialog that says "OK" instead of the verb, an empty state that
  leaves the user stuck, an error message in developer language, edit and
  delete icons side by side at thumb size, the sticky button that competes
  with the card's own button.
- **Read the source when it helps the fix**: find the component (grep the
  label) so the recommendation names the file and the change.
- **Grep for actions that destroy without asking**: handlers that call
  delete/remove/reset/clear (`onClick={() => remove…(`, `deleteX(`,
  `setRounds([])`, `localStorage.removeItem`) directly from a button, with
  no confirm state or undo in between. Re-draws, "start over" and "edit
  attendees" count when they discard what the user already typed.
- Then skim `references/guidelines.md` (75 rules adapted from
  ui-ux-pro-max, MIT) for forms, feedback, navigation and accessibility
  issues relevant to this app. Cite the rule name.

Do not report layout breakage (overflow, cut text, contrast, tap size) here;
point to responsive-check instead, or run it.

## 4. Report

In the user's language. Lead with a two-line verdict, then findings by
priority. Each finding: what the user experiences, where (screen + moment),
why it matters in one sentence, the concrete fix (component/file when
known), and the screenshot.

```
**UX review — 7 screens, phone + desktop**
Lo más importante: el dado significa dos cosas y "Editar"/"Borrar" son íconos sin texto pegados.

### Alta
1. **El dado es "Sortear" y también el modo "Al azar"** (barra de abajo y /sorteo).
   Quien aprendió que el dado es "ir al sorteo" lo ve en un botón que hace otra cosa.
   → Para "Al azar" usá otro ícono (barajar) o solo texto. `src/pages/Sorteo.jsx`
   screenshots/sorteo--phone.png (#1)

### Media
…
### Bien resuelto
- Borrar partido, sacar del grupo y borrar cuenta piden confirmación (probado).
```

Include a short "bien resuelto" section: knowing what already works keeps
the team from "fixing" it. Offer to implement the fixes; do not change the
app's code unless asked.
