# Device styles — what a page looks like on a tablet and a phone

A row, each column inside it, and each module inside those, can be styled
differently on a tablet and on a phone. This is the document for that feature:
the model, the two breakpoints, why the generated CSS is marked `!important`,
and where the `<style>` element is allowed to sit.

Slices: rows shipped as 86bc13a6v (PR #716), cells as 86bc14pey (PR #717),
modules as 86bc14pfq. Slice 4 is the preview's Tablet frame and the retirement
of the old 900px and 560px rules.

## The model — a device FOLLOWS until it is changed

Dane's decision, 2026-09-15, and it is the whole feature in one sentence:

> Tablet and Phone follow Desktop until a setting is changed, and only the
> differences are stored.

So the chain is **Desktop → Tablet → Phone**, and the stored data holds only
what DIFFERS at each step. Three consequences fall out of that, and each one
is a thing a naive "save every setting per device" design gets wrong:

- **A later desktop change still reaches every screen.** Widen a row on
  desktop and the phone widens too, unless the operator asked the phone to be
  different. A design that copied every setting to every device would freeze
  each screen at the moment it was first touched.
- **Setting a value back to the inherited one REMOVES the key**, rather than
  pinning it to the value it happens to equal today. Anything else would
  quietly re-introduce the freeze one setting at a time.
- **A page nobody has styled per device serializes exactly as it did before
  this feature existed.** The key is absent, not empty.

Three fields carry it, all optional, plus the module shape below:

| Field | Shape | Cleaned by |
|---|---|---|
| `deviceOverrides` | `{ tablet?: { <setting>: <value> }, phone?: … }` | `BUILDER_SECTION_DEVICE_KEY_NORMALIZERS` |
| `cellDeviceOverrides` | `{ tablet?: { <column>: { <setting>: <value> } }, phone?: … }` | `BUILDER_CELL_DEVICE_KEY_NORMALIZERS` |
| a module's `settings` | flat `tablet.<key>` / `phone.<key>` entries | `BUILDER_MODULE_DEVICE_KEY_NORMALIZERS` |

The cell map is keyed by column before it is keyed by setting, because **a
cell is not an object in this codebase** — every cell setting is a map on the
row, keyed by column (`cellPaddingTop`, `cellBorderWidth`, …), so a device has
to say which column it is talking about before it can say which setting.

A **module** is different again: its settings are a flat
`Record<string, string>` that keeps unknown keys, so a device value is simply
a flat key rather than a nested map:

```json
{ "marginTop": "10", "phone.marginTop": "4", "phone.fontSize": "16" }
```

All of them live in `lib/builder-client/builder-template.ts` (rows and cells)
and `builder-module-device-overrides.ts` (modules); every value passes through
the same normalizer its desktop field uses, so a phone cannot store what
desktop could not. A cell's padding side caps at 50 where a row's caps at
160 — that is not an inconsistency, it is `normalizeCellPaddingSide` being
mirrored exactly.

**What is deliberately NOT a device setting:** layout, column widths,
background, overlay, opacity, shadow and access — and, for a module, every
per-type content setting (text, images, links). Those are one value for every
screen. A control offered on a phone that silently writes desktop is worse
than a control that is not offered, so the panel hides them in device mode.

The reading, writing and resetting live in two files —
`lib/builder-client/builder-device-overrides.ts` (row helpers first, cell
helpers below them) and `builder-module-device-overrides.ts`.

### What a device may change

| | Row | Cell | Module |
|---|---|---|---|
| Spacing | margin and padding, four sides each | padding, four sides | margin, four sides |
| Size | Width mode, Width %, min height, column gap | — | Width % (Simple/Rich Text) |
| Nudge | horizontal / vertical offset | — | horizontal / vertical offset |
| Type | — | — | font size (heading, headline-rotator, poll-category-list) |
| Other | alignment, border width/style/colour/radius | border width/style/colour/radius | alignment |
| Visibility | Hide on this screen | Hide on this screen | Hide on this screen |

`BUILDER_SECTION_DEVICE_KEY_NORMALIZERS`, `BUILDER_CELL_DEVICE_KEY_NORMALIZERS`
and `BUILDER_MODULE_DEVICE_KEY_NORMALIZERS` are the key lists. **Adding a key
is an edit to one of those three objects and nothing else.**

## The breakpoints

| Screen | Applies at |
|---|---|
| Tablet | **1024px** and below |
| Phone | **767px** and below (and wins over Tablet) |

Both are in `builder-device-overrides.ts` as `BUILDER_TABLET_MAX_WIDTH` and
`BUILDER_PHONE_MAX_WIDTH`, and nothing else may hard-code them.

There are older, unrelated narrow-screen rules in the stylesheet at **900px**
and **560px** — including the ones behind a cell's legacy "Hide on Mobile" and
a module's `mobileHidden` / `mobileAlignment` / `mobileFontSize`.
They are not these breakpoints and they have not moved; moving them is slice 4.
Until then, a column hidden with the old field hides at ≤900px, and a column
hidden with **Hide on Phone** hides at ≤767px.

## Why `!important`

The renderer paints rows, columns and modules with **inline styles**, and an
inline style cannot say "only below 1024px". So a row that has device settings
carries its own little `<style>` element of media rules, and so does a module.

An ordinary rule in that element loses to the inline style — every time, at
every width — so the phone panel would appear to work in the editor and do
nothing on the page. `!important` is what makes the rule outrank the inline
value. It is a requirement of the mechanism, not a shortcut, and
`scripts/ui/render-contracts.mjs` holds it: remove it and the phone and
tablet padding contracts fail at 420px and 900px.

A module's scope selector is additionally **repeated three times**. The
pre-device mobile stylesheet is class-based and therefore beats a single
attribute selector; the tallest rule to clear is at (0,4,0). This is spelled
out rather than fixed with a `.builder-react-root` prefix because a published
tenant page has no such wrapper.

## How the rules are generated — by running the desktop code again

`components/builder/builder-device-css.ts` does not know what a padding or a
border is. The renderer hands it **the same style builder it uses for
desktop**, it runs that builder on the row as each device sees it, and it
emits only the declarations that came out different.

That is the point of the design: a device rule can never disagree with how
desktop computes the same value, because it IS how desktop computes it.
`buildSectionDeviceCss` and `buildCellDeviceCss` are two thin wrappers over
one generator; what differs per surface is only which map says a device has
settings, how the row resolves for that device, and what a property's
**neutral** value is when the device stops producing one.

That last one is not a detail. When desktop sets a property and the device's
style builder produces nothing for it, something has to be written or the
inline desktop value stays. `initial` is right for a custom property (it makes
`var(--x, fallback)` use its fallback) and wrong for most plain ones:

- a row's `margin-left` resets to the full-width negative pull, not to nothing;
- a **column's `display` resets to `grid`**, because `display: initial` is
  `inline` and would collapse the whole column.

**Modules take the other road**, in `builder-module-device-css.ts`, and for a
structural reason: a module's styles land on three different elements (the
wrapper, the module's own root, and deeper still for a font size), so there is
no single style object to diff. That generator maps each device KEY to its
declarations and its element. The two values where drift would actually
matter — Width % and the nudge — are still computed by the renderer's own
helpers.

**Alignment is the case that proves the element matters.** Desktop alignment
for `center` and `right` is declared on the module's CHILD
(`.is-align-center .builder-preview-heading { justify-self: center }`,
`src/css/_builder-react.css`), and a child's own `justify-self` beats the
parent's `justify-items` no matter what the parent says. So a device alignment
writes the same declarations the desktop stylesheet writes, on the same child,
as well as on the wrapper — otherwise the override works in only one
direction (left → center) and silently fails in the other. Two contracts hold
both directions.

## Where the `<style>` element goes, and why it is not negotiable

**Last child of the row, never between the columns, never beside the row.** A
module's goes last inside its column, for the same reason.

- The phone Reverse-stack rules count the row's children with
  `:nth-child(1..6)`. An element placed ahead of the columns renumbers every
  one of them — the sixth column lands fourth. This has happened once already
  from a different cause (86bbwmp2y, review round 2).
- `.full-width + .full-width` joins adjacent rows, so the element cannot sit
  beside the row either.

That is also why **every column's rules go into the row's ONE style element**
rather than each column carrying its own: a per-column element would sit
between the columns, which is exactly the placement that breaks the ordering.
The scope attribute goes on the column; the rules go in the row.

Each column gets its own scope id (`<row id>-<column>`). One id shared by the
row would have every column match every column's rules, with the last one
winning — and a contract using only ONE styled column cannot see that, because
an unstyled column carries no scope attribute at all. The contract
`device-styles-cell-rules-reach-only-their-own-column` styles two columns
differently for that reason.

The generated CSS is built from normalized numbers, hex colours and fixed
keywords only — no operator text reaches it — which is what makes writing it
as a style element safe. The scope string is stripped of `"`, `\`, `<` and `>`
as a second line.

**Phone rules are emitted twice** — under a media query for the live site, and
under `.builder-preview-device-mobile` for the preview's phone frame, which is
a narrow box on a wide screen and matches no media query.

### Hiding, and showing again

Hiding is `display: none !important`. A phone follows its tablet, so a tablet
hide normally applies at phone width too.

When the phone shows the module again, the tablet hide is confined to the
tablet **band** — `(min-width: 768px) and (max-width: 1024px)` — rather than
being undone by a second `display` declaration. There is no one value to undo
it to: a module in an equal-height row is `display: flex` and everywhere else
it is block, so writing `display: block` back would break the one case. (Rows
do write the display back, because a row's own display is always `grid`.)

## The legacy fields underneath

| Old field | Read as |
|---|---|
| `cellMobileHidden[column]` | the cell's **Hide on Phone** value, when no device map names `hidden` |
| a module's `mobileHidden` | the module's **Hide on Phone** value |
| a module's `mobileAlignment` | the module's phone **Alignment** |
| a module's `mobileFontSize` | the module's phone **Font size** |

They sit in the phone chain between tablet and `phone.*`, so an untouched page
resolves on a phone to what it already renders, and a new `phone.*` value
simply wins over the old field.

**Using the new control retires the old field.** The write clears it — for a
cell, for a module, for every one of them. That is not tidiness, and it is the
fault that sent slice 3 back in review round 1: the old field is read as a
phone seed, so leaving it in place has the device map say "follows desktop"
while the old field goes on hiding the module, and unticking the box does
nothing at all.

Two rules make that hold, and they are one idea stated twice:

- **The baseline a write compares against is the same chain the resolver
  reads.** For `phone` that is tablet **plus** the legacy fields, never tablet
  alone. A write that asks "would I inherit this anyway?" of a shorter chain
  than the reader uses will drop an override as redundant and then read the
  legacy value back — which is exactly how "Hide on Phone" became a box that
  snapped straight back.
- **A device value that equals its baseline still WRITES when a legacy field
  is what supplied that baseline**, because the same write clears the legacy
  field; dropping the key would leave the legacy value standing.

Rows have their own pair (`mobileHidden` / `desktopHidden`) and slice 1 left
them alone; they are slice 4's to reconcile.

A module that carries **only** legacy fields emits no device CSS at all — it
goes on rendering through the stylesheet classes it always did, at 900px.
The guard for that is per DEVICE AND KEY rather than per module: an unrelated
tablet margin must not drag a module's `mobileFontSize` into a 767px rule with
`!important` on it, which would change a live client page that nobody had
touched. (It did, before review round 1 caught it.)

> Measured 2026-09-15: `mobileFontSize` on a heading has in fact never reached
> a real phone. Inside the same 900px block,
> `.builder-react-root .builder-preview-heading:not(.builder-preview-heading-eyebrow)`
> sets `font-size: clamp(1.35rem, 9vw, 2.35rem) !important` at equal
> specificity and later in the file, so it wins. Mobile Font Size works only
> inside the preview's phone frame, which has a rule of its own. That is a real
> defect and it belongs to 86bc14pgq, which owns the old phone rules.

## The editor

`BuilderDeviceSwitch` — three icons, Desktop highlighted — is shared by rows,
cells and modules so the control is one thing to learn. An icon carrying a dot
means that screen has settings of its own.

Choosing Tablet or Phone **replaces** the panel rather than adding to it: one
panel is one screen's settings, so there is never a question of which screen a
field you can see belongs to. The panel shows a banner naming the screen, a
chip per setting this screen changes with a `reset` beside it, `Reset all`, and
a dot beside each changed label.

Every control in it reads the object as that screen sees it and writes through
`writeSectionDeviceEdit` / `writeCellDeviceEdit` / `writeModuleDeviceEdit`, so
**the controls themselves do not know devices exist**. That is what makes
adding a key cheap.

The switch is deliberately absent in three places: the old page-list Mobile
mode (it has its own pane), the **module repository**, and the
**saved-section modal**. A master in those two is a template rather than a
placed module, and its device settings would be copied onto every page that
follows it with no screen to check them on.

## What holds this

- `lib/builder-client/builder-device-overrides.test.ts` and
  `builder-module-device-overrides.test.ts` — the inheritance, the "removes
  rather than pins" promise, the legacy read AND the legacy clear,
  normalization.
- `components/builder/builder-device-css.test.ts` and
  `builder-module-device-css.test.ts` — what CSS comes out, including the
  neutral values and that the scope string cannot break out of its own
  selector.
- `scripts/builder/document.test.js` — the round trip through the serializer.
  A field the normalizer does not list is silently dropped, which would lose
  every phone setting on the next save.
- `scripts/ui/render-contracts.mjs` — a real browser at 420px, 900px and
  1440px. These are the only checks that can see `!important` losing, a media
  query at the wrong width, a style element renumbering the columns, or a
  child's `justify-self` beating the wrapper's `justify-items`.
- `scripts/ui/check_panels.mjs` — switches one row, one module and one cell to
  Phone, so the device arrangement of each panel is measured rather than
  assumed.

## Changing this

**Break it on purpose and watch the named check fail before believing a
pass.** Every contract above was break-tested when it was written; the ones
worth re-breaking after a change are the specificity (`SCOPE_REPEATS`), the
`!important`, the tablet band, and the legacy-only guard.
