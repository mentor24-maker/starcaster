# Device styles — what a page looks like on a tablet and a phone

A row, and each column inside it, can be styled differently on a tablet and
on a phone. This is the document for that feature: the model, the two
breakpoints, why the generated CSS is marked `!important`, and where the
`<style>` element is allowed to sit.

Slices: rows shipped as 86bc13a6v (PR #716), cells as 86bc14pey (PR #717).
Modules are slice 3 (86bc14pfq, PR #718). Slice 4 (86bc14pgq) added the
preview's **Tablet frame** and moved the layout half of the old 900px/560px
rules onto these breakpoints; retiring the page list's Desktop/Mobile toggle
is what remains of it, and waits on slice 3 being on `main`.

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

There were older, unrelated narrow-screen rules in the stylesheet at **900px**
and **560px**, from before this feature existed. Slice 4 (86bc14pgq) moved the
ones that decide LAYOUT — whether a row's columns sit side by side, and the
row and column padding that goes with it — onto the two widths above. What the
operator sees from that: a multi-column row now stacks from 1024px down rather
than 900px, and "Keep columns" is still the per-row way out of it at every
width.

**Some legacy rules deliberately stayed at 900px**, and each has a reason
worth reading before moving it:

| Still at the old width | Why |
|---|---|
| `.builder-preview-column-mobile-hidden`, `.builder-preview-module-mobile-hidden` | Widening makes content VANISH on tablets that show it today. Narrowing cannot be written at all: the rule is `display: none !important` and the element's real display lives in an inline style, which a stylesheet cannot hand back. These move when the legacy fields are read through the device chain. |
| the module's legacy Mobile Font Size and Mobile Alignment | Same mechanism, same company — they belong with the module slice. |
| every `.site-nav*` rule at 900/720/560px | The hamburger breakpoint that turns the menu into a drawer lives in `legacy.css`. Moving the nav's sizing without it leaves a drawer-shaped menu beside a desktop nav. |
| `gap: 18px !important` on a stacked row | No desktop value to return to, and at 901-1024px the row's own Column Gap is the better answer. |
| everything admin-only | Those are screens in the app, not a visitor's page. |

So a column hidden with the old **Hide on Mobile** field still hides at ≤900px,
while one hidden with **Hide on Phone** hides at ≤767px. The two disagree
between 768 and 900px, and that is a known, written-down gap rather than an
oversight.

### The preview frames cannot see a media query

The Builder's preview page draws a page inside a **Mobile** (390px) or
**Tablet** (820px) box. A frame is a narrow element in a WIDE window, so every
`@media` rule in the stylesheet is false inside it however narrow the box is
drawn. Both frames therefore need a parallel copy of their rules keyed by
class: `builder-device-css.ts` emits every phone rule under
`.builder-preview-device-mobile` and every tablet rule under
`.builder-preview-device-tablet`, and the stylesheet mirrors the legacy
narrow-screen rules the same way.

The split is not symmetrical, and that is deliberate. A phone rule is computed
from the row as a PHONE sees it, which already has tablet's settings folded in
— so the phone frame needs no tablet rule of its own. The tablet frame must
never receive the phone rule: a tablet is above the phone breakpoint, and a
phone-only setting appearing in the Tablet frame is the frame lying about the
device it is named after.

Nothing could test a frame until 2026-09-15, and the gap had already cost a
real defect: a row with 90px of Tablet top padding rendered **10px** in the
phone frame and **90px** in a real 420px browser, because the frame took its
padding from a flat `padding: 10px` in the regenerated stylesheet instead of
the row's own variables. `emulate: { previewDevice }` on a render contract
opens the frame, and three contracts hold both frames now.

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
- `scripts/ui/render-contracts.mjs` — a real browser at 420px, 800px, 900px,
  1000px and 1440px, plus both preview frames. These are the only checks that
  can see `!important` losing, a media query at the wrong width, a frame
  disagreeing with the device it imitates, or a style element renumbering the
  columns.
- `scripts/ui/check_panels.mjs` — switches one row and one cell to Phone, so
  the device arrangement of each panel is measured rather than assumed. The row
  it switches is the fixture's **two-column** one: several row controls exist
  only where there is more than one column (Column Gap, Column Widths, Match
  Column Heights, Mobile Layout), and switching a single-column row measured a
  Phone panel none of them could appear in.
