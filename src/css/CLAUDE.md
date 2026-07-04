# src/css/ — stylesheet source of truth

This directory is the ONLY place CSS is edited. `public/styles.css` is
compiled from `main.css` by esbuild — after any edit here run
`npm run build:css` so your local app reflects it. Commit only the source
partial: `public/styles.css` is gitignored (Vercel/CI rebuild it).
Edits to `public/styles.css` directly are wiped on the next build; edits
here are invisible until you rebuild.

## Structure

- `main.css` imports every partial; new partials must be added there
- `_variables.css` — design tokens; always prefer `var(--ink-primary)`,
  `var(--border-light)`, `var(--btn-bg)`, `var(--accent)`, `var(--bg-page)`
  over hardcoded colors
- `legacy.css` — old rules, including the real nav/menu styles (Top Menu
  hamburger collapse lives here, NOT in `_builder-react.css`)
- `_builder-react*.css` — React builder editor + public-site module styles
- Avoid `!important` except icon-buttons inside grids and third-party
  overrides

## UI standards (enforced in review)

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
