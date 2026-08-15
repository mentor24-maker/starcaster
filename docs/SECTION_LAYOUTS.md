# Section (row) layouts

How a Builder section splits into columns. One list, two consumers: the
**Workspace tiles** that add a row, and the **Layout dropdown** inside a
section that changes one. Both read `layoutOptions` in
`components/builder/builder-types.ts`.

## Where a layout is defined

A layout is not one entry — it is five, and all five must agree or the
layout half-works in a way that looks like a different bug.

| Piece | File | What breaks without it |
|---|---|---|
| The union member | `lib/builder-client/builder-template.ts` → `BuilderTemplateLayout` | Typecheck fails |
| Column keys + track sizing | same file → `LAYOUT_SPECS` | Typecheck fails — the record is keyed by the union, so a member with no spec cannot compile |
| The picker entry | `components/builder/builder-types.ts` → `layoutOptions` | Nobody can reach it |

`getLayoutColumns`, `getLayoutGridTemplate` and `normalizeLayout` all read
`LAYOUT_SPECS`; none of them needs a new case. That is deliberate. They
used to be three separate `if` chains, and `one-four-one` shipped with all
three plus the legacy `1-4-1` mapping and *no picker entry* — a layout that
existed everywhere except the one list the UI reads, for weeks.
`components/builder/builder-layout-options.test.ts` holds what the compiler
cannot: that the picker and the spec table describe the same set, and that
each layout's tracks match the fractions its label promises.

Two places outside those files list layouts by name and will silently
mis-place a centre column if a new three-or-more column layout misses
them: `LAYOUT_COLUMN_COUNTS` in `lib/builder/migrate-from-legacy.js`, and
`NORMIE_LAYOUT_TO_LEGACY` in `public/js/builder.js` (see *Vanilla interop*
below).

After editing `builder-template.ts`, run `npm run build:builder-template`
— the server normalizes every page save/load through the generated
`lib/builder/template.js`, and an unknown layout there is discarded.

## The icons

Each tile draws itself: `renderLayoutTile` in
`components/admin-builder-editor.tsx` emits one `.builder-layout-bar` per
column key and sets `grid-template-columns` inline from
`getLayoutGridTemplate`. So a correct `getLayoutGridTemplate` **is** a
correct icon — there is no per-layout icon asset to add or maintain.

That only holds while the icon element is allowed to fill its tile.
`legacy.css` loads after `_builder-react.css` and its unscoped
`.builder-layout-tile { justify-items: center }` (written for the vanilla
builder) also matched the React tiles; nothing in the React layer set that
property, so it won, the icon collapsed to zero width, and all seven tiles
rendered as the same narrow pill — seven layouts, one picture. The
counter-rules live in `_builder-react-overrides.css` under
"ROW LAYOUT TILES". Do not remove them without checking the tiles in a
browser; this failure is invisible in the source.

## The set

StarCaster tracks [Divi's 20 column structures][divi], plus two of its own
(`one-five` / `five-one`) that predate the alignment and carry live data.

Values are named for their `fr` ratio, following the existing
`two-four` / `one-four-one` convention. Labels use fractions, which is what
the ratio actually means and what Divi shows.

### Shipped — 21

| Value | Label | Grid template | Columns |
|---|---|---|---|
| `single` | 1 Column | `1fr` | main |
| `two-column` | 1/2 + 1/2 | `1fr 1fr` | left, right |
| `three-column` | 1/3 + 1/3 + 1/3 | `1fr 1fr 1fr` | left, center, right |
| `two-four` | 1/3 + 2/3 | `2fr 4fr` | left, right |
| `four-two` | 2/3 + 1/3 | `4fr 2fr` | left, right |
| `one-three` | 1/4 + 3/4 | `1fr 3fr` | left, right |
| `three-one` | 3/4 + 1/4 | `3fr 1fr` | left, right |
| `two-three` | 2/5 + 3/5 | `2fr 3fr` | left, right |
| `three-two` | 3/5 + 2/5 | `3fr 2fr` | left, right |
| `one-five` | 1/6 + 5/6 | `1fr 5fr` | left, right |
| `five-one` | 5/6 + 1/6 | `5fr 1fr` | left, right |
| `one-two-one` | 1/4 + 1/2 + 1/4 | `1fr 2fr 1fr` | left, center, right |
| `one-three-one` | 1/5 + 3/5 + 1/5 | `1fr 3fr 1fr` | left, center, right |
| `one-four-one` | 1/6 + 2/3 + 1/6 | `1fr 4fr 1fr` | left, center, right |
| `two-one-one` | 1/2 + 1/4 + 1/4 | `2fr 1fr 1fr` | left, center, right |
| `one-one-two` | 1/4 + 1/4 + 1/2 | `1fr 1fr 2fr` | left, center, right |
| `three-one-one` | 3/5 + 1/5 + 1/5 | `3fr 1fr 1fr` | left, center, right |
| `one-one-three` | 1/5 + 1/5 + 3/5 | `1fr 1fr 3fr` | left, center, right |
| `four-column` | 1/4 × 4 | `1fr 1fr 1fr 1fr` | left, center, right, col4 |
| `five-column` | 1/5 × 5 | `1fr 1fr 1fr 1fr 1fr` | left, center, right, col4, col5 |
| `six-column` | 1/6 × 6 | `1fr 1fr 1fr 1fr 1fr 1fr` | left, center, right, col4, col5, col6 |

That is every Divi structure of one, two or three columns plus its equal
four-to-six column rows, plus `one-five` / `five-one` / `one-four-one`,
which are StarCaster-only — Divi has no sixths outside its six-column row.

The wide rows extend the persisted column vocabulary with `col4`–`col6`
rather than renaming to `col1`…`colN` — every stored `left` / `center` /
`right` cell record stays valid, and a row narrowed from six columns to
three keeps its first three cells key for key.
`components/builder/builder-layout-options.test.ts` pins those keys, and
`resolveModuleColumnForLayout` has a four-plus branch that maps legacy
`col1`–`col3` onto `left` / `center` / `right` and folds columns a layout
does not have into its first column. The count lookup in
`lib/builder/migrate-from-legacy.js` (`LAYOUT_COLUMN_COUNTS`) carries the
same vocabulary for legacy migration. In the editor a `col4`-style key is
displayed through `formatColumnName` (builder-utils) as "column 4".

Values are ratio names because they are persisted on saved sections;
renaming one would orphan live documents. Labels are fractions of the row,
which is the same information in the form an operator thinks in — and the
form Divi uses. `single` is labelled "1 Column", not "Full Width": the
section already has a Width control whose options are Contained and
Full-width, and two things called full width on one settings row is a trap.

### To add

| Value | Fractions | Grid template | Columns |
|---|---|---|---|
| `one-one-one-three` | 1/6 + 1/6 + 1/6 + 1/2 | `1fr 1fr 1fr 3fr` | left, center, right, col4 |
| `three-one-one-one` | 1/2 + 1/6 + 1/6 + 1/6 | `3fr 1fr 1fr 1fr` | left, center, right, col4 |

The column model was widened when `four-column`–`six-column` shipped, so
these two are now ordinary additions: union member + `LAYOUT_SPECS` entry
(reuse `FOUR_COLUMNS`) + picker entry + the contract test's `expected` map.
Everything downstream — CSS, migration, vanilla interop, module column
resolution — already handles four columns.

**Narrow-cell chrome** remains the standing caveat: a 1/6 cell is ~226px
in the editor at 1440px and the cell's own Styles / Content / Save Cell
controls already overflow it (true for `one-five` since before the wide
rows). At six columns every cell is that narrow, so the wide rows make an
old cosmetic problem easier to hit.

## Vanilla interop

`public/js/builder.js` — frozen, bugfixes only — runs the legacy modular
page-template editor on a **six-span grid**, which cannot express quarters
or fifths. `NORMIE_LAYOUT_TO_LEGACY` therefore maps each React layout to
the nearest legacy row **with the same column count**, and count is the
part that matters: a three-column section resolved to a two-column legacy
row drops its centre column's modules on the floor.

`getModularPageLayoutMeta` spreads that same table rather than keeping its
own copy — two copies is how `one-four-one` ended up correct in one place
and not the other.

Know what that costs. A 1/4 + 3/4 row *displays* as 2-4 in that editor,
and if it is **saved** there, `layoutSectionsForSave` writes the round trip
back — `one-three` → `2-4` → `two-four` — so the row keeps both its
columns and their contents but comes back at 1/3 + 2/3. The proportions
are lost, not the content, and only for a section saved through the legacy
page-template editor. Every layout that has no exact legacy code has
always behaved this way; the ten new ones just widen the set it applies to.
Nothing in the React page builder round-trips through it.

The four-to-six column rows have no count-preserving legacy row at all, so
the decision (made when they shipped) is: they resolve to `2-2-2`, the
closest count. `mapNormieColumnToLegacy` folds `col4`–`col6` modules into
the first column — it only passes a `colN` key through when the target
legacy row actually has that column — so nothing is dropped, but a wide
row saved through the legacy editor comes back as `three-column` with its
overflow modules moved left. Displaying it there costs nothing; saving it
there is the lossy step, same rule as above, just wider.

[divi]: https://help.elegantthemes.com/en/articles/8612739-divi-rows-row-options

## Checking your work

The tiles cannot be verified by reading CSS — that is the whole lesson of
the collapsed-icon bug. Start the app and look:

```
node server.js                       # PORT from .env.local
npm run seed:ui-fixture              # prints UI_HARNESS_PROJECT_ID
```

then open Builder → Pages → edit a page → Workspace, and confirm each tile
draws the proportions its label claims.
