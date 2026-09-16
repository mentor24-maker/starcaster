# Device styles — what a page looks like on a tablet and a phone

A row, and each column inside it, can be styled differently on a tablet and
on a phone. This is the document for that feature: the model, the two
breakpoints, why the generated CSS is marked `!important`, and where the
`<style>` element is allowed to sit.

Slices: rows shipped as 86bc13a6v (PR #716), cells as 86bc14pey. Modules are
slice 3; the preview's Tablet frame and the retirement of the old 900px and
560px rules are slice 4.

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

Two fields carry it, both optional:

| Field | Shape | Cleaned by |
|---|---|---|
| `deviceOverrides` | `{ tablet?: { <setting>: <value> }, phone?: … }` | `BUILDER_SECTION_DEVICE_KEY_NORMALIZERS` |
| `cellDeviceOverrides` | `{ tablet?: { <column>: { <setting>: <value> } }, phone?: … }` | `BUILDER_CELL_DEVICE_KEY_NORMALIZERS` |

The cell map is keyed by column before it is keyed by setting, because **a
cell is not an object in this codebase** — every cell setting is a map on the
row, keyed by column (`cellPaddingTop`, `cellBorderWidth`, …), so a device has
to say which column it is talking about before it can say which setting.

Both live in `lib/builder-client/builder-template.ts`; every value passes
through the same normalizer its desktop field uses, so a phone cannot store
what desktop could not. A cell's padding side caps at 50 where a row's caps at
160 — that is not an inconsistency, it is `normalizeCellPaddingSide` being
mirrored exactly.

**What is deliberately NOT a device setting:** layout, column widths,
background, overlay, opacity, shadow and access. Those are one value for every
screen. A control offered on a phone that silently writes desktop is worse
than a control that is not offered, so the panel hides them in device mode.

The reading, writing and resetting all live in one file,
`lib/builder-client/builder-device-overrides.ts` — row helpers first, cell
helpers below them.

## The breakpoints

| Screen | Applies at |
|---|---|
| Tablet | **1024px** and below |
| Phone | **767px** and below (and wins over Tablet) |

Both are in `builder-device-overrides.ts` as `BUILDER_TABLET_MAX_WIDTH` and
`BUILDER_PHONE_MAX_WIDTH`, and nothing else may hard-code them.

There are older, unrelated narrow-screen rules in the stylesheet at **900px**
and **560px** — including the one behind a cell's legacy "Hide on Mobile".
They are not these breakpoints and they have not moved; moving them is slice 4.
Until then, a column hidden with the old field hides at ≤900px, and a column
hidden with **Hide on Phone** hides at ≤767px.

## Why `!important`

The renderer paints rows and columns with **inline styles**, and an inline
style cannot say "only below 1024px". So a row that has device settings
carries its own little `<style>` element of media rules.

An ordinary rule in that element loses to the inline style — every time, at
every width — so the phone panel would appear to work in the editor and do
nothing on the page. `!important` is what makes the rule outrank the inline
value. It is a requirement of the mechanism, not a shortcut, and
`scripts/ui/render-contracts.mjs` holds it: remove it and the phone and
tablet padding contracts fail at 420px and 900px.

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

## Where the `<style>` element goes, and why it is not negotiable

**Last child of the row, never between the columns, never beside the row.**

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

## The legacy fields underneath

| Old field | Read as |
|---|---|
| `cellMobileHidden[column]` | the cell's **Hide on Phone** value, when no device map names `hidden` |

Using the new control retires the old field for that column — the write clears
it. That is not tidiness: the old field is read as a phone seed, so leaving it
in place would have the device map say "follows desktop" while the old field
went on hiding the column, and unticking the box would do nothing.

Rows have the same pair (`mobileHidden` / `desktopHidden`) and slice 1 left
them alone; they are slice 4's to reconcile.

## What holds this

- `lib/builder-client/builder-device-overrides.test.ts` — the inheritance,
  the "removes rather than pins" promise, the legacy read, normalization.
- `components/builder/builder-device-css.test.ts` — what CSS comes out,
  including the neutral values and that the scope string cannot break out of
  its own selector.
- `scripts/builder/document.test.js` — the round trip through the serializer.
  A field the normalizer does not list is silently dropped, which would lose
  every phone setting on the next save.
- `scripts/ui/render-contracts.mjs` — a real browser at 420px, 900px and
  1440px. These are the only checks that can see `!important` losing, a media
  query at the wrong width, or a style element renumbering the columns.
- `scripts/ui/check_panels.mjs` — switches one row and one cell to Phone, so
  the device arrangement of each panel is measured rather than assumed.
