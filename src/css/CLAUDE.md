# src/css/ — stylesheet source of truth

This directory is the ONLY place CSS is edited. `public/styles.css` is
compiled from `main.css` by esbuild — after any edit here run
`npm run build:css` so your local app reflects it. Commit only the source
partial: `public/styles.css` is gitignored (Vercel/CI rebuild it).
Edits to `public/styles.css` directly are wiped on the next build; edits
here are invisible until you rebuild.

## STOP — never hand-edit `_builder-react.css`

It is committed to git and looks like any other partial, which is exactly
the trap. `scripts/extract_builder_css.mjs` **replaces the whole file**, so
a rule you add here survives until the next regeneration and then vanishes
— silently, because nothing tests CSS. Commit `2bd3018` deleted the CRM
modal styles that way and Contacts delete stayed broken for a month.

**Hand-written rules go in `_builder-react-overrides.css`**, imported after
it so they win. A `PreToolUse` hook now blocks the edit outright
(`scripts/hooks/block_generated_edits.cjs`), and `check_conventions.cjs`
blocks the commit as a backstop.

This warning lives here, at the top of the file you are told to read before
editing CSS, because the rule was already in `docs/MODULE_UI_DOCTRINE.md`
R2 and agents still fell into it repeatedly (operator, 2026-08-15) — the
doctrine is not what anyone reads at the moment they reach for a stylesheet.

## Two CSS traps that cost real time here

**An invalid value drops the WHOLE declaration, silently.**
`max-width: min(100%, max-content)` looks reasonable and is not legal — an
intrinsic keyword cannot go inside `min()` — so the browser discarded it and
the computed value was `none`. It read correctly in the diff, in review and in
the source, and did nothing (2026-08-17, the image never-upscale cap). If a
value is doing anything clever, read it back with `getComputedStyle` in a real
browser before believing it.

**One `animation-*` longhand applies to EVERY animation on the element.**
An element running two animations and given `animation-iteration-count: 1`
stops both. Give the longhand one value per animation, comma-separated, or the
second motion dies while the first keeps going. Same fact used deliberately:
one `animation-direction: reverse` turns a travel and its spin around
together. Worked example: `docs/IMAGE_EFFECTS.md`.

## Structure

- `main.css` imports every partial; new partials must be added there
- `_variables.css` — design tokens; always prefer `var(--ink-primary)`,
  `var(--border-light)`, `var(--btn-bg)`, `var(--accent)`, `var(--bg-page)`
  over hardcoded colors
- `legacy.css` — old rules, including the real nav/menu styles (Top Menu
  hamburger collapse lives here, NOT in `_builder-react.css`)
- `_builder-react.css` — React builder editor + public-site module styles.
  **Read-only in practice** — regenerated wholesale, see the warning above
- `_builder-react-overrides.css` — where every hand-written builder rule goes
- Avoid `!important` except icon-buttons inside grids and third-party
  overrides

## UI standards → canonical copy: `docs/MODULE_UI_DOCTRINE.md` §2

These were headed "enforced in review" for months. There was no review
step; nothing enforced them. They now live in the doctrine doc with an
honest enforcement tag on each one, and the mechanical ones run in
`scripts/check_ui_doctrine.cjs`. The list below is kept here as a quick
reference for anyone editing CSS — **if it disagrees with the doctrine,
the doctrine wins.**

- **Buttons:** utility classes only — `btn btn-primary`, `btn btn-ghost`,
  `btn btn-danger`, table micro-actions `btn tiny-btn icon-btn`. Labels in
  Title Case, `white-space: nowrap`, `width: fit-content` (not full-width
  unless layout requires). Icon-only buttons: square (~28×28), `inline-flex`
  centered, `aria-label` required.
- **Page titles:** `<h2>` in `.page-heading-row`, format `Module: Subpage`
  (e.g. `Contacts: Personnel`) — single colon + space.
- **Tables:** canonical styles in `_tables.css`; no per-module header
  classes. Plain `<th>` only — never a `<button>`/`<a>` inside `<th>`
  (sort id goes on the `<th>`, JS appends ▲/▼ to textContent). Actions
  column last, `.actions-col` on `<th>` and `<td>`, icons in one
  non-wrapping `.table-actions-row`. Filter row `.table-filter-row` with
  light background. Wrap tables in `.table-wrap` — but never inside form
  modals.
- **Forms:** `.standard-form-grid` (140px label column + control column);
  permanent `<label>`s, no placeholder-as-instruction; checkboxes with
  `.standard-form-checkbox`; radios use `.sc-radio-group` /
  `.sc-radio-option` (input left, label right, stacked vertically). Inputs
  size to content or a declared width class — don't stretch to fill wide
  containers.
- **Modals:** no scrollbars in form modals, especially horizontal — widen
  the modal instead.
- **Feedback:** transient → `App.components.Toast` (`.c-toast` variants);
  sticky status → `App.notify(text, isError)`.
- **Accordions:** toggle `aria-expanded` only — never rewrite button
  `innerHTML` for chevrons.
- **Pods (hub tiles):** `.pod` with `.pod-icon-col` + `.pod-content`;
  Lucide-style SVG ~84×84, `stroke-width: 1`, `color: var(--accent)`.
