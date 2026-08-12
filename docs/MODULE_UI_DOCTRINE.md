# UI Doctrine

The enforcement layer for UI rules in this repo — both halves of it: the
**modules** inside the Builder, and the **framework** of admin screens around
them.

**Read `docs/UI_RULES.md` first** — the Master UI Rules, distilled from the
operator's recorded statements (2026-08-09). That list is the *requirements*;
this document is the *machinery* that enforces the enforceable subset and
records the incident behind each check. When the two disagree, the master
list wins and this doc gets a new checker.

Written 2026-08-08, after the operator checked the Feature Cards and mega-menu
work on production and reported: *"the functionality seems basically right. The
problem, as is the case with all the modules currently, is that the UI is
abysmal."*

House style follows `docs/DOCTRINE.md`: every rule carries the thing that went
wrong to produce it. A rule without its story gets deleted by the next person
who finds it inconvenient.

---

## 0. How this document works

### 0.1 Why it exists: the rules were never the problem

Before this doc, UI rules lived in four places — `docs/MODULE_STANDARDS.md`,
`components/CLAUDE.md`, `src/css/CLAUDE.md`, and tribal memory. They were
sensible rules. They were also almost entirely **unfollowed**, because nothing
checked them.

Measured in this worktree at `ed650d1`:

| Claim | Reality |
|---|---|
| "Editors use field strips" (MODULE_STANDARDS rule 10) | **5 of 37** settings editors do |
| "Legacy grids may remain on old modules" | only **2** use the legacy grid — the other **30** are ad-hoc, each invented from scratch |
| `src/css/CLAUDE.md` UI standards, headed *"enforced in review"* | there is no review step; nothing enforced them |
| "No layout CSS inside a breakpoint" (rule 3) | a live desktop bug was still present — see 1b.R1 |

That is the finding that shapes this document. The gap was never a missing
rule. It was that **every UI rule in this repo was honour-system**, while the
build-artifact and `public/js` rules — the ones with a pre-commit hook — held
perfectly. Rules with a checker get followed. Rules without one decay to
preferences and then to folklore.

### 0.2 Therefore: every rule states how it is checked

Each rule below is tagged. **A rule that cannot be tagged does not belong in
this document** — it gets reworded until it can be, or it gets cut.

| Tag | Meaning |
|---|---|
| **`[auto]`** | `node scripts/check_ui_doctrine.cjs` fails. Runs at pre-commit on your staged changes, and in CI across the whole repo. You cannot commit past it without `SKIP_CONVENTIONS=1` and a stated reason. |
| **`[type]`** | `npm run typecheck` fails. The strongest kind — the code will not compile. |
| **`[test]`** | a test in `npm run test:builder-ui` or `npm run test:builder` fails. |
| **`[eye]`** | a human must look. Cannot be automated; **must** therefore be named explicitly in the PR, with what was checked. |

`[eye]` is not a loophole. It is an admission, and it carries an obligation: an
`[eye]` rule that a PR does not mention is an `[eye]` rule that was skipped.

### 0.3 Scope: two UIs, and they fail differently

Almost every disagreement about "the module UI" comes from conflating these.
Sort every issue into one before touching a file:

- **Editor UI (§1a)** — what the operator sees in the Builder when a module is
  selected. Settings panel, fields, grouping, labels, order, pickers.
- **Rendered UI (§1b)** — what a site visitor sees on the published page.
  Layout, spacing, type, colour, states, responsiveness.
- **Framework UI (§2)** — the admin screens around the Builder. Tables, forms,
  modals, buttons, page headings.

They live in different files and fail for different reasons. A list that mixes
them produces a PR that mixes them.

### 0.4 How the palette converges: boy-scout, not big-bang

52 module types predate this doc and 30 editors are ad-hoc. Rewriting them all
at once is not on the table. Instead:

- The `[auto]` checks run against **changed code only** at pre-commit. Existing
  files are not retroactively blocked.
- **Any module touched for any reason is brought to this doctrine in that same
  PR**, and the PR states which rules it now meets.
- `node scripts/check_ui_doctrine.cjs --report` prints the whole-repo debt at
  any time. That number should only ever go down.

---

## 1. Module rules

### 1a. Editor UI — the settings panel

**Reference implementation: `components/builder/builder-image-module-settings.tsx`.**
Copy its shape. If you are reading only one thing before writing an editor,
read that file.

#### E1. Editors are built from field strips `[auto]`

Build from `BuilderModuleFieldStrip` + `BuilderModuleField` — or, better,
declare the settings as a schema and let
`components/builder/builder-settings-schema.tsx` generate the editor (E1–E4
then hold by construction; see §4). Never a hand-rolled
`<label class="field">` grid, never a bespoke flex row invented for one
module.

*Incident (measured 2026-08-08):* 30 of 37 settings editors are neither field
strips nor the legacy grid — they are 30 independent inventions. That is the
literal, mechanical cause of the operator's "the UI is abysmal across all the
modules": there is no shared UI, so there is no consistency to perceive. Every
module teaches the operator a new panel.

**Checked by:** `check_ui_doctrine.cjs` fails when a changed
`*-module-settings.tsx` does not import `BuilderModuleFieldStrip`.

#### E2. Every field declares a width token `[type]`

`label` (230px) · `select-sm` / `select-md` (ch-based) · `num` (digit-sized via
`BuilderNumberSelectControl`) · `align` · `color` · `check` · `text-md` ·
`full` (own line). Fields are `flex: 0 0 auto`; they stay on one line until
they don't fit, then hard-wrap. **Never stretch a control to fill leftover row
space** — a select that grows to 400px because it happened to be last in the
row is the single most common way these panels look unfinished.

*Change made 2026-08-08:* `width` was an optional prop defaulting to `"auto"`,
so "always declare a width" was unenforceable. All 70 existing call sites
already passed one, so the prop was made **required**. The rule now fails at
compile time instead of at the operator's eyeball.

#### E3. Strip order is content → layout → style → advanced `[eye]`

So the controls someone reaches for most are nearest the top.

1. **Content** — what the module shows (image + alt, text, items)
2. **Layout** — width, alignment, H **and** V margin
3. **Style** — border, radius, colour, effect
4. **Advanced** — rarely-touched settings, inside `<details class="hanging-details">`

Advanced holds theme overrides (master rule A1) and **effects** — drop
shadow, hover treatments. It does **not** hold text colour: that is basic
and belongs on the Text axis (master rule A6, operator 8/11). And a shadow
is filed by what it shadows, not by habit — `text-shadow` is Text,
`box-shadow` is Frame (A7).

#### E4. A spacing box is four sides, or none `[auto]`

`marginTop`, `marginBottom`, `marginLeft`, `marginRight` — and the same four
for padding — in that order, in the same strip. Never a lone "Margin", and
never the vertical/horizontal pair that preceded them.

*Why:* a pair cannot express the ordinary case. A banner logo needed the
padding above and below it gone and the padding holding it off the left edge
kept; the single control that could reach the first took all four sides with
it, and there was nothing else to try. The operator's ruling, 2026-08-11:
"standardize all objects on the Top/Bottom/Left/Right model."

*How:* build the controls from `MODULE_MARGIN_SIDES` / `MODULE_PADDING_SIDES`
in `builder-settings-schema.tsx`, or from the `marginFields()` /
`paddingFields()` helpers that read those tables. Then the names, the order
and the count hold by construction.

**Checked by:** `check_ui_doctrine.cjs` fails a changed settings file that
names some sides but not all four, or that still names the retired pair.

#### W8. A size dropdown past 100px counts in fives `[auto]` *(added 2026-08-12)*

A number control measuring **pixels** whose range goes above 100 declares
`step: 5` or coarser. Sizes that stay small — a border, a font — keep their
1px steps.

*Why:* Site Search's Field Width ran 0–1200 in ones. That is 1,201 options,
and getting to 400 meant scrolling past 399 numbers nobody would ever pick.
The operator, 2026-08-12: "update any dropdown that lets you set the field
width of something that would typically be more than 100px to increment by 5px
instead of 1px."

*Why keyed on the name, not the option count:* a long list is not the fault by
itself. `particleCount` runs to 500 and `spread` to 180, and every value in
both is meaningful — one is a count, the other an angle. Pixels above 100 are
the case where the precision is noise, so the rule reads the key name
(`*Width`, `*Height`, `*Size`) rather than the length of the list.

*The trap that comes with it:* a stored value need not sit on the new grid. A
width saved at 403 before the step changed would DISPLAY as 405 while 403 was
still what the page used — the panel disagreeing with the live site and
looking fine doing it. `resolveNumberSelectOptions` in
`builder-inline-number-select.tsx` now inserts an off-grid value into the list
and selects it, so raising a step can never quietly rewrite what an operator
sees. This was already wrong for the six controls that stepped by more than
one before this rule existed.

**Checked by:** `check_ui_doctrine.cjs` (W8) fails a `control: "number"` field
whose key ends in width/height/size, whose `max` is over 100, and whose step is
under 5. A control that genuinely needs every value goes in `W8_ALLOW` with a
reason. The field parser is covered by
`scripts/builder/uiDoctrineSizeStep.test.js`.

#### E5. Labels never wrap — shorten the text instead `[eye]`

`white-space: nowrap` is set for you. "Border", not "Border thickness in
pixels". If the label needs a sentence, the control is wrong.

#### E6. Universal chrome is never duplicated per type `[auto]`

Vertical margin and mobile/desktop visibility come from the shared module
chrome. A per-type editor that adds its own produces two controls for one
setting, and the operator learns that changing the wrong one does nothing.

#### E7. No dead controls, and no invisible settings `[eye]`

A control that changes a setting nothing renders is a bug wearing a feature's
clothes. Walk **both** directions: every setting the editor exposes must reach
the render path, and every setting the renderer reads must be exposed
somewhere.

*Incident (2026-08-07):* auditing the Image module, a `grep` for
`settings.borderThickness` across three component files found nothing and the
settings were reported dead. They were not — the renderer reads them through
`getImageModuleStyle()` in `builder-utils.ts`, one level of indirection away.
The opposite error was real in the same audit: `horizontalOffset` and
`verticalOffset` genuinely were dead, and were removed. **Trace the helpers,
not just the literals.**

### 1b. Rendered UI — the published page

#### R1. Layout CSS may never live only inside a breakpoint `[auto]`

Structural rules — `display`, `position`, `flex*`, `grid*`, sizing, `inset`,
`gap`, `overflow` — belong in the **base** ruleset. A media query may only
*adjust* what the base layer already established.

*Incident (2026-08-06):* the Card Slider's flex row, card sizing, and
positioned image frame existed only inside `@media (max-width: 900px)`. Above
900px the cards were unstyled and each `fill` image escaped its card to span
the page — the module showed one giant photo instead of a row. Its scroll
arrows had no CSS at all. It had shipped that way from the start; nobody had
put images through it on a desktop screen. **This module is the reason the
whole module-quality effort exists.**

*Incident (2026-08-08, found by writing this checker):* the same species was
still live. `.builder-preview-table-wrap` — the Table module's scroll
container — had `width: 100%; overflow-x: auto` **only** inside
`@media (max-width: 900px)` (`_builder-react.css:10418`). On any desktop
browser a wide table had no scroll container at all, so the **page body**
scrolled sideways instead of the table. Fixed in the same commit as the
checker that found it. The checker was written first and immediately earned
its keep — which is the argument for every other `[auto]` rule here.

**Corollary — a module may not depend on ambient CSS it does not own `[eye]`.**
If a renderer uses `fill` or absolute positioning, the module's own stylesheet
must supply the positioned, sized container. A module that looks right only
because some *other* module's stylesheet happens to be on the page is broken;
it will fail the first time it appears alone.

**Checked by:** `check_ui_doctrine.cjs` parses all of `src/css/` as one corpus
(rules for a selector may legitimately be split across files) and fails any
selector that sets a layout property inside a media query and nowhere outside
one. Genuinely breakpoint-scoped selectors — `.builder-preview-*-mobile-hidden`
— are allowlisted **in the script, with their reason**, because
`_builder-react.css` is regenerated wholesale and a comment marker there would
not survive.

#### R2. New CSS goes in the hand-authored layer `[auto]`

`_builder-react.css` is regenerated by `extract_builder_css.mjs`, which
**replaces the whole file**. Hand-written module rules belong in
`_builder-react-overrides.css`, imported after so it wins.

*Incident:* commit `2bd3018` regenerated `_builder-react.css` and silently
deleted the CRM modal styles, breaking Contacts delete **for a month**. Nothing
tests CSS, so a deletion is completely silent. (PR #61 added a drop guard.)

#### R3. Colour comes from tokens, not hex literals `[auto]`

`var(--ink-primary)`, `var(--border-light)`, `var(--btn-bg)`, `var(--accent)`,
`var(--bg-page)` — see `src/css/_variables.css`. A hardcoded `#333` is a
module that will not follow a tenant's theme.

`var(--bg-page, #ffffff)` is **correct and not a violation** — the token wins
wherever it is defined and the literal is only the fallback. The check ignores
hex inside a `var()` fallback; flagging it would punish exactly the behaviour
this rule wants.

*Standing debt, stated honestly:* `_builder-react.css` currently holds 565 hex
literals against 491 `var()` uses. The check therefore runs on **added lines
only** — it stops the bleeding rather than pretending the backlog is clean.

*Added-line checks are skipped during a merge (2026-08-08).* Merging main
presents every incoming line as "added", so R2 and R3 would fail a merge on
work already reviewed and merged on its own PR. Whole-file checks (R1, E1, E4,
E6) still run, because they judge the **result** — which is what actually
ships. A gate that fires on someone else's committed code teaches people to
reach for `SKIP_CONVENTIONS`, and a gate that is routinely bypassed is not a
gate.

*Gap closed 2026-08-08:* `_variables.css` now carries a spacing scale
(`--space-1` … `--space-8`) and a type scale (`--text-xs` … `--text-3xl`,
plus `--leading-tight`/`--leading-normal`). The steps canonize the values the
CSS already clustered on when measured (0.82rem and 0.9rem were the two
dominant font sizes; 4/6/8/12/16/24px the dominant gaps), so substituting a
token is usually a zero-pixel change. Type sizes are enforced by R8 below;
spacing stays `[eye]` for now because legitimate off-scale pixel values
(1px borders, 2px nudges, transforms) would drown an automated check in
false positives.

#### R4. Empty state is a designed state `[test]`

A module with no content renders a short instruction — "Add slides in the
editor" — never a blank box, a zero-height element, or a crash. The same
applies to malformed settings: parsing a settings collection is wrapped and
falls back to empty.

#### R5. Responsive by construction, verified at three widths `[eye]`

Every module renders correctly at desktop **1440**, tablet **768**, and mobile
**390**. Wide content scrolls inside its own container; the page body never
scrolls horizontally. The `/builder-preview` device switcher exists for this.

*Incident (2026-08-08):* PR #105 shipped Feature Cards and the mega-menu
without this step, which is a direct cause of this document existing. It is an
**operator step** — the agent's job is to set the work up so it is quick, and
to say plainly that it is pending until he has done it.

#### R6. Accessible by default `[eye]`

Images take alt text as a settings field, never a hardcoded blank. Icon-only
buttons carry `aria-label`. Interactive controls are real `<button>`s, not
clickable `<div>`s. Auto-advancing content pauses on hover. Focus is visible —
`var(--focus-ring)` exists; use it.

#### R7. User HTML is always sanitized `[eye]`

Rich-text and embed HTML passes through `lib/builder-client/sanitize-html.ts`.
Never `dangerouslySetInnerHTML` with raw user content.

#### R8. Type sizes come from the scale `[auto]` *(added 2026-08-08)*

`font-size` in hand-authored CSS uses a `--text-*` token, never a literal.
`var(--text-sm, 0.82rem)` is fine — same fallback logic as R3.

*Incident (measured 2026-08-08):* the hand-authored CSS held **20+ distinct
font sizes** — 0.72, 0.75, 0.78, 0.8, 0.82, 0.85, 0.86, 0.875, 0.88, 0.9,
0.92, 0.95rem and more — each one someone's reasonable guess on the day,
none of them a decision. That is what "no scale" costs: not ugliness on any
one line, but the impossibility of consistency across lines.

*Standing debt, stated honestly:* the check runs on **added lines only**;
`check:ui:report` tracks the distinct-literal count (71 at time of writing).
Like R3, it stops the bleeding rather than pretending the backlog is clean.

---

## 2. Framework rules — the admin screens

These were previously the "UI standards (enforced in review)" section of
`src/css/CLAUDE.md`, which described an enforcement step that did not exist.
They are reproduced here with honest tags.

- **Buttons `[eye]`** — utility classes only: `btn btn-primary`, `btn btn-ghost`,
  `btn btn-danger`; table micro-actions `btn tiny-btn icon-btn`. Labels in Title
  Case, `white-space: nowrap`, `width: fit-content` (not full-width unless the
  layout demands). Icon-only buttons square (~28×28), `inline-flex` centered,
  `aria-label` required. **A label must never overflow its button.** Flex/grid
  rows squeeze children, and a button carrying `min-width: 0` (or a fixed width
  narrower than its text) renders the label spilling past the pill. A shared
  button that lands in arbitrary containers declares `flex: 0 0 auto` +
  `min-width: fit-content`; the row yields, never the label. Incident: the
  gallery-picker button in Themes → Hero & Treatments, 2026-08-09 — the
  generated `.builder-gallery-button { min-width: 0 }` let a settings row crush
  the pill smaller than "Choose From Gallery".
- **Page titles `[eye]`** — `<h2>` in `.page-heading-row`, format
  `Module: Subpage` (e.g. `Contacts: Personnel`) — single colon plus space.
- **Tables `[auto]`** — canonical styles in `_tables.css`; no per-module header
  classes. Plain `<th>` only — **never a `<button>` or `<a>` inside a `<th>`**
  (the sort id goes on the `<th>`; JS appends ▲/▼ to `textContent`). Actions
  column last, `.actions-col` on both `<th>` and `<td>`, icons in one
  non-wrapping `.table-actions-row`. Filter row `.table-filter-row`. Wrap tables
  in `.table-wrap` — but never inside a form modal.
- **Forms `[eye]`** — `.standard-form-grid` (140px label column + control
  column); permanent `<label>`s, never placeholder-as-instruction; checkboxes
  `.standard-form-checkbox`; radios `.sc-radio-group` / `.sc-radio-option`
  (input left, label right, stacked). Inputs size to content or a declared width
  class — don't stretch to fill a wide container.
- **Modals and popup editors size to their content `[auto]`** — a dialog
  declares a **floor** (never opens narrower than this), grows to fit whatever
  is inside it, and stops at **75% of the screen**. In CSS that is
  `width: max-content; min-width: min(<floor>px, 100%); max-width: min(75vw, 100%)`;
  a React shell inlines the same three values. What a dialog must never carry
  is a lone `width`/`max-width` in px — that is a guess about content someone
  made once, and it is why an editor ends up cropped or scrolling sideways.
  Prose declares its own reading measure (`.c-modal__body > p` is capped at
  56ch) so a message dialog stays narrow while a form or table grows.

  *Incident (2026-08-11):* the operator reported, for at least the fourth
  time, an editor squeezed into too small a box — this round the popped-out
  module editor, which capped at 680px and stacked its axis columns while
  two thirds of the screen sat empty. The sweep found the same guess
  everywhere: `BuilderEditorPopup` at a flat 360, `BuilderCenteredModal` at
  560 with call sites re-capping at 680 and 1200, and `.c-modal__dialog` —
  the shell **every** vanilla-admin modal inherits — at 520. Popping the
  heading editor out now opens at 1189px on a 1900px screen (was 730), three
  axis columns across, nothing cropped. `checkDialogWidths` in
  `scripts/check_ui_doctrine.cjs` fails any new dialog selector that caps
  itself in px, and any `minWidth`/`maxWidth` number handed to a modal
  component at a call site.
- **Feedback `[eye]`** — transient → `App.components.Toast` (`.c-toast`
  variants); sticky status → `App.notify(text, isError)`.
- **Accordions `[eye]`** — toggle `aria-expanded` only; never rewrite a button's
  `innerHTML` to swap a chevron.
- **Pods (hub tiles) `[eye]`** — `.pod` with `.pod-icon-col` + `.pod-content`;
  Lucide-style SVG ~84×84, `stroke-width: 1`, `color: var(--accent)`.

---

## 3. Shared rules

- **Icon house style `[eye]`** — Lucide-style line icons, `stroke-width: 1`,
  currentColor. One family across modules and framework.
- **`!important` is a smell `[eye]`** — permitted only for icon-buttons inside
  grids and third-party overrides. Anywhere else it means the cascade is wrong.
- **Long strings and overflow `[eye]`** — every text container survives a
  40-character unbroken string (a URL, a German compound) without pushing the
  page sideways.
- **`public/styles.css` is a build artifact `[auto]`** — edit `src/css/*`, run
  `npm run build:css`, never commit the artifact. Already enforced by
  `check_conventions.cjs`.

---

## 4. Conformance summary

| Rule | Check | How to run it |
|---|---|---|
| E1 field strips | `[auto]` | `node scripts/check_ui_doctrine.cjs` |
| E2 width token | `[type]` | `npm run typecheck` |
| E3 strip order | `[eye]` | state it in the PR |
| E4 H+V margin | `[auto]` | `node scripts/check_ui_doctrine.cjs` |
| E5 labels don't wrap | `[eye]` | state it in the PR |
| E6 no duplicated chrome | `[auto]` | `node scripts/check_ui_doctrine.cjs` |
| E7 no dead controls | `[eye]` | trace helpers both directions |
| R1 no breakpoint-only layout | `[auto]` | `node scripts/check_ui_doctrine.cjs` |
| R2 CSS in overrides layer | `[auto]` | `node scripts/check_ui_doctrine.cjs` |
| R3 tokens not hex | `[auto]` | `node scripts/check_ui_doctrine.cjs` |
| R8 type from the scale | `[auto]` | `node scripts/check_ui_doctrine.cjs` |
| R4 empty state | `[test]` | `npm run test:builder-ui` |
| R5 1440 / 768 / 390 | `[eye]` | **operator** step, `/builder-preview` |
| R6 accessibility floor | `[eye]` | state it in the PR |
| R7 sanitized HTML | `[eye]` | state it in the PR |
| §2 tables / `<th>` | `[auto]` | `node scripts/check_conventions.cjs` |
| §2 dialogs size to content | `[auto]` | `node scripts/check_ui_doctrine.cjs` |
| §2 remainder, §3 | `[eye]` | state it in the PR |

Everything `[auto]` runs automatically at **pre-commit** (staged changes) and in
**CI** (`--all`). Nothing extra to remember.

### Prerequisite tasks — all three closed 2026-08-08

Kept for the record; the doc above assumes they exist.

1. **A spacing scale and a type scale** in `_variables.css` — done. Type
   sizes are enforced by R8; spacing is `[eye]` (see R3's gap-closed note for
   why).
2. **Navigation's editor extracted** out of `builder-module-card.tsx` into
   `builder-navigation-module-settings.tsx` — done, behaviour unchanged (live
   tenant menus must not move). E1 now applies to it like any other editor.
3. **The declarative settings schema** — done:
   `components/builder/builder-settings-schema.tsx`. An editor declares its
   fields grouped content/layout/style/advanced; the generator renders the
   strips, so E1, E2, E3 and E4 (via `marginFields`) hold by construction.
   Bespoke UI drops into `custom` fields — one special control is never a
   reason to hand-roll a whole panel. First conversion:
   `builder-current-poll-module-settings.tsx`. A field's `rendersVia` names
   its renderer-side consumer (E7's paper trail); the conformance test that
   asserts it is the remaining open piece, tracked in
   `docs/MODULE_SYSTEM_HANDOFF.md` §3(c).

---

## 5. Landmines that bite UI work specifically

1. **Dual registration.** After editing
   `lib/builder-client/builder-template.ts`, run
   `npm run build:builder-template`, or the server bundle coerces the type to
   `"text"` on every page load — silent data loss. (Root `CLAUDE.md` #1.)
2. **Every module owns four surfaces.** Public renderer
   (`builder-template.ts` / `builder-template-preview.tsx`), canvas preview
   (`builder-module-card.tsx`), settings editor, palette entry
   (`builder-types.ts`) with group, icon, and a description a non-developer can
   choose from. Missing one produces a module that exists but can't be used,
   edited, or found.
3. **Collection settings need the large cap.** Settings truncate at 10,000
   characters. Keys holding JSON collections (`slides`, `navItems`,
   `tableData`, `content`, `tableContents`) are exempted to 200k/500k in
   `normalizeBuilderModuleSettingsForType`. A new collection key not added
   there is truncated mid-JSON on the next save, parses as empty, and wipes the
   content.
4. **Restyling Navigation touches live client sites.** `list` is the default
   dropdown style and live tenant sites run it. Any restyle must not move an
   existing menu.
5. **Whole-file staging.** `git add <file>` stages every uncommitted edit in
   that file, not just yours. Inspect `git diff --cached` before committing.
6. **Email render is a decision, not an oversight.** Each module either renders
   sensibly in email or is added to the skip list in
   `builder-email-render.ts`. State which, and why, in the PR.

---

## 6. Definition of done for UI work

Per the root `CLAUDE.md`, run and **state the results of**:

1. `npm run typecheck`
2. `npm run test:builder-ui` and/or `npm run test:builder`
3. The rebuild for every generated artifact touched — for UI work almost always
   `npm run build:css`, plus `npm run build:builder` and
   `npm run build:builder-template` if the module's TypeScript changed
4. `node scripts/check_conventions.cjs` (now includes the UI checks)
5. `npm run check:syntax` if `public/js/` or `public/shared/` was touched
6. **The eyeball at 1440 / 768 / 390** (R5) — an operator step. Say plainly
   that it is pending until he has done it.
7. **Name every `[eye]` rule the change touched**, and what was checked. An
   `[eye]` rule the PR doesn't mention is an `[eye]` rule that was skipped.

"It should work" is not done. Passing commands are done.
