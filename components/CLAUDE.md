# components/ — React builder UI conventions

After any change here: `npm run build:builder` (regenerates
`public/builder-bundle.js`). If styles changed too: `npm run build:css`.
Tests: `npm run test:builder-ui`.

## Module settings editors (`components/builder/*-module-settings.tsx`)

> **Canonical rules: `docs/MODULE_UI_DOCTRINE.md` §1a.** The notes below are
> the working summary; the doctrine carries the reasons, the enforcement tags,
> and the checks. If they disagree, the doctrine wins.

- **Prefer the schema generator:** declare settings as a
  `BuilderSettingsSchema` and render with `BuilderSchemaModuleSettings`
  (`builder-settings-schema.tsx`) — strip order, width tokens, and margin
  pairing then hold by construction. Hand-written strips are for editors
  dominated by bespoke UI. Example conversion:
  `builder-current-poll-module-settings.tsx`.
- **Field strips:** horizontal groups use `BuilderModuleFieldStrip` +
  `BuilderModuleField` — a wrapping flex row. Each field is
  `flex: 0 0 auto` with a declared width token; fields stay on one line
  until they don't fit, then hard-wrap. Never stretch a control to fill
  leftover row space.
- **Width tokens:** `label` (230px), `select-sm` / `select-md` (ch-based),
  `num` (digit-sized via `BuilderNumberSelectControl`), `align`, `color`,
  `check`, `text-md`, `full` (own line).
- **Spacing is four sides, shown as two rows:** the keys are still
  `marginTop/Bottom/Left/Right` and `paddingTop/Bottom/Left/Right` in that
  order (E4) — never a lone "Margin", never a vertical/horizontal
  *setting*. What renders is one row per axis, `V Margin` / `H Margin`,
  each with a chain-link toggle that splits it into its two sides in place,
  and each splitting on its own when the two sides already differ (E4b,
  8/15). Never build these by hand: `marginFields()` / `paddingFields()` /
  `spacingFields()` in a schema panel, `BuilderModuleSpacingFields` in a
  hand-written strip — all from `builder-spacing-fields.tsx`, which owns
  the labels, the side order, the legacy fallbacks and the toggle.
- **Labels never wrap** (`white-space: nowrap`); shorten text instead.
- **No Advanced section** (master rule A0, 8/13). There is no
  `<details class="hanging-details">` in a module panel and no `advanced:`
  key on an axis. Every setting sits on the axis it belongs to; a
  rarely-touched control is de-emphasised by sorting **last on its axis**
  (D9), not by being hidden. Theme-backed settings keep the `theme-color`
  control — empty still means "follow the theme" (A2) — they just live in
  the open now.
- **Field order within an axis: blast radius, descending** (D9).
  Destination/source → mode/layout → what appears → size → colour → fine
  adjustment. A toggle that gates one sibling field stays beside it.
  Text colour is basic (A6). A drop shadow is filed by what it shadows:
  `text-shadow` on the Text axis, `box-shadow` on Frame (A7). Use
  `dropShadowFields()` from the settings schema rather than the Button
  panel's bespoke block.
- Legacy `.builder-module-form-row` grids may remain on old modules;
  use field strips for all new work.

### Before you write panel markup or CSS, read W0 in `docs/UI_RULES.md`

Not the summary — the **mechanism** half of the rule: *"the COLUMN is the
grid, not the field"*. Every field is `display: contents` so one grid's
tracks measure the longest label and longest control across the whole
column, plus `--builder-field-room` (40px). **Never put a width on a
field.** A layout that lines up because you picked matching numbers is not
the rule; it is a coincidence that drifts the moment content changes.

This is written here because it was missed twice in one day (2026-08-12).
Both times the rule was read, the intent was followed, and the
implementation invented its own widths — `11ch` labels, `1fr` fields,
`11rem` buttons — which the operator spotted immediately.

**And do not trust a green `check:panels` on markup you just invented.**
It measures three known pair shapes (`.builder-module-field`,
`.builder-setting-row`, `label.field`) inside known containers, skips
`--full` fields, and reports OK on anything it cannot see — the doctrine's
own words: *a control the check cannot see is a control the rule does not
cover*. New surface means: give it a shape the check knows, add its
container to `scripts/ui/check_panels.mjs`, seed real content into
`scripts/ui/seed_fixture.mjs` (an empty manager measures nothing and
passes), and then **prove the check fails** by breaking the layout on
purpose before you trust the pass.
- **New styles go in `src/css/_builder-react-overrides.css`.** Existing rules
  also live in `src/css/_builder-react.css`, but that file is regenerated
  wholesale and a hand edit there disappears at the next regeneration — read
  it, never write it. See `src/css/CLAUDE.md`, first section.

## Adding a builder module type

1. Register the type in `lib/builder-client/builder-template.ts`
2. `npm run build:builder-template` — **mandatory**; without it the server
   bundle coerces the new type to `"text"` on every load (silent data loss)
3. `npm run build:builder`

## Rendering user content

All rich-text/embed HTML must pass through the DOMPurify helpers in
`lib/builder-client/sanitize-html.ts`. Never `dangerouslySetInnerHTML`
raw user content.

## CRM public forms (`crm-form` module)

- Layout/style settings persist on the form record's `styles` JSON
  (`lib/crmFormStyles.js`)
- Public rendering styles belong to the builder layer, not `_crm.css` (that's
  the admin preview). Existing ones sit in `src/css/_builder-react.css`; add
  new ones to `_builder-react-overrides.css` (that file is regenerated)
- Module center/right alignment must not override the form's internal
  alignment
