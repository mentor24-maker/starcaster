# The Master UI Rules

**What this is.** Every rule the operator has stated about StarCaster's UI —
settings panels, admin forms, tables, and module output — distilled from his
recorded statements (`docs/OPERATOR_UI_FEEDBACK.md`, recovered 2026-08-09)
plus the examples he supplied when commissioning this list. This is the
master list for the module UI overhaul: **it grows as we proceed; it never
silently shrinks.**

**How to read a rule.** Each rule has an ID (stable — cite it in PRs), the
rule itself, and two annotations:

- *(source)* — the operator statement it came from, by date. "8/9 example"
  means the sample list he wrote when commissioning this document.
- **Status** — how it is enforced today:
  `[auto]`/`[type]`/`[test]` = a machine blocks violations (the check named
  in `docs/MODULE_UI_DOCTRINE.md`); `[eye]` = a human must look, and a PR
  that touched it must say so; `[TODO-check]` = nothing enforces it yet —
  candidate for the next checker.

Umbrella principles head each section in plain language; the numbered rules
are what they mean in practice. When a new statement arrives, it lands here
as a rule first, then gets a checker where one is possible.

---

## L — Labels

*Umbrella: labels are neat, short, aligned, and always fully visible.*

- **L1.** Form labels and fields are **left aligned** by default.
  *(8/9 example)* — **[TODO-check]**
- **L2.** Labels **never wrap**. *(8/9 example; doctrine E5)* — **[eye]**
  (CSS sets `white-space: nowrap`; the writing rule below is what keeps
  that from cropping)
- **L3.** Labels carry **no redundant or unnecessary words** — "Border",
  not "Border thickness in pixels". If a label needs a sentence, the
  control is wrong. *(8/9 example; doctrine E5)* — **[eye]**
- **L4.** **Never crop a word** — not in a label, a value, an option, or a
  column heading. Widen the container instead. *(8/9 example; 6/28 "the
  labels … are all cut off by the fields")* — **[TODO-check]**
  **Clarified 8/10 (no carve-out — the rule stands in full):** "never crop
  a word" means never cut *through* a word. It has never forbidden dropping
  whole words. So a truncating cell (T7 rung 10) must **break between
  words** and never mid-word: *"Delray Beach Tennis…"*, never *"Delray
  Beach Tennis Cen…"*. In the operator's words, *"we want the extra code to
  gracefully crop cell contents between words."*
  **"The extra code" is literal — CSS cannot do this** (verified
  2026-08-10): `text-overflow: ellipsis` cuts at whatever character lands on
  the edge, and `-webkit-line-clamp` wraps at word boundaries but then
  shortens the last line to make room for its own ellipsis, landing mid-word
  too ("Junior Tenni…"). The compliant technique is to drop whole words in
  JS until the text fits — see `clampCellTextToBoundary()` in
  `public/js/builder.js`, which also handles hyphen-separated slugs and
  re-runs on resize. Labels, options and headings still get widened or
  reworded rather than shortened at all.
- **L5.** Labels never **overlap** their controls or neighbors. *(6/28
  "Ensure that none of the labels overlap with the forms")* — **[eye]**
- **L6.** Item-grid columns get **header titles** — and this **applies to
  card-style item managers too** (ruled 8/9): a manager that repeats field
  labels on every card converts to a titled-column grid, with fields that
  genuinely can't be columns (image pickers, long text) in a spanning
  secondary row. Pattern: `.builder-item-grid` (successor to the nav
  grid). *(7/1 "Give each of those field columns titles: Parent Page,
  Page Name, Slug, Width, Action"; ruling 8/9)* — **[eye]**
- **L7.** Unclear wording is a bug: if the operator has to ask what a
  label or help text means, reword it. *(7/24 "come up with a clearer
  description. I'm not quite sure what that even means")* — **[eye]**

## D — Density and layout of panels

*Umbrella: compact forms — no wasted screen, no scrolling that a better
layout would avoid.*

- **D1.** **Minimize vertical space.** Related controls share a row; a
  control never takes a row of its own when it could join its neighbors.
  *(6/30 "The goal is to minimize vertical space and the need for
  scrolling"; 6/30 "Put all the card elements on the same line")* —
  **[TODO-check]**
- **D2.** **No wasted right side.** A panel whose rows are short arranges
  its groups side by side (columns), not stacked down the left edge.
  *(8/9 "look at all the wasted screen real estate on the right side";
  7/24 "since there is plenty of room to the right … display the selected
  pages to the right, parallel to the Pages section")* — **[TODO-check]**
- **D3.** **No orphaned fields.** A lone small control stranded on its own
  row is a layout bug. *(8/9 "Orphaned fields")* — **[eye]**
- **D4.** A form row may hold **1–3 equal-width columns** of grouped
  fields. *(6/30 "let's let each row be from 1-3 equal width columns";
  6/28 blog-post-list three-column design)* — **[TODO-check]**
- **D5.** Long forms are organized into **titled groups** in a fixed
  order: content → layout → style → advanced. *(6/28 "three sections
  (general, Page Design, Card Design)"; doctrine E3)* — **[eye]**
- **D6.** Rarely-touched settings collapse into **Advanced**; they never
  crowd the everyday controls. *(doctrine E3)* — **[eye]**
- **D7.** Windows and modals size to their content — wide when the content
  is wide *(7/2 "Let that window expand to 80% the width of the screen")* —
  and form modals **never scroll internally**, especially sideways
  *(doctrine §2)*. — **[eye]**

- **D8.** Panel controls are organized into **logical axes** — up to four
  titled columns, each holding the controls that belong to one aspect of
  the module. Use the canonical titles so a control lives in the same
  place in every module:

  | Axis | Holds |
  |---|---|
  | **Content** | what the module shows — text, items, images, links |
  | **Structure** | how it is arranged — layout mode, levels, columns, counts, sizing |
  | **Text** | typography — font, size, weight, transform, text colour, text shadow |
  | **Placement** | alignment, padding, margin, offsets |
  | **Frame** | border width / radius / colour, box shadow |

  "Shadow" is split on purpose — see A7. A shadow cast by the letters is a
  Text control; a shadow cast by a box is a Frame control. The unqualified
  word in this table used to read as "all shadows are Frame", which is how
  the Heading module ended up with a `text-shadow` filed under Frame.

  **An axis with nothing on it is not an axis.** Drop the column rather
  than render a titled empty space to keep a grid aligned.

  One, two or three axes is fine; **four is the ceiling**. A module that
  genuinely needs a fifth is a design question for the operator — the
  generator throws rather than render a cramped fifth column, so it
  cannot pass silently. *(operator 8/10, giving Navigation's own axes:
  "Structure / Text / Orientation / Border")* — **[type]** (the throw)
  + **[eye]** (which control belongs on which axis)

  *Open question he raised in the same breath, not yet decided:* border
  settings arguably belong to **Themes**, not to each module — a client
  can never be restyled globally while every module carries its own
  border colour. If that lands, the **Frame** axis empties on most
  modules and they drop to three. Tracked as its own piece of work; the
  axes are designed to collapse cleanly when it does.

- **D9. ORDER WITHIN AN AXIS: BLAST RADIUS, DESCENDING.** Fields on an
  axis are ordered by how much of the module they change — the setting
  with the widest effect first, the finest adjustment last.
  *(operator 8/13: "Do apply logic to the ordering of the fields, placing
  the most important/global first and most trivial last.")* — **[eye]**

  | | Rung | Examples |
  |---|---|---|
  | 1 | **Destination / source** — what the module points at or draws from | `targetPageUrl`, `crmFormId`, `filterParam`, `successRedirect` |
  | 2 | **Mode / layout** — the arrangement choice | `layout`, `cardLayout`, `style`, `navDirection` |
  | 3 | **What appears** — show/hide toggles and the copy each one gates | `showExcerpt`, `title`, `allLabel` |
  | 4 | **Size and spacing** | `fontSize`, `gap`, `size`, counts |
  | 5 | **Colour** | `color`, `activeColor`, `bgColor` |
  | 6 | **Fine adjustment** — the last 2% | `borderRadius`, offsets, `zIndex`, `transition` |

  Change the destination and the module does something else entirely;
  change the radius and it looks 2% different. That is the whole ordering
  principle, and it is why rung 1 leads even when the destination is a
  dull-looking URL field.

  **The toggle-pairing rule outranks this within a pair:** a toggle that
  gates one specific sibling field stays adjacent to it, toggle first, at
  whichever rung the pair belongs to. Splitting `showTitle` from `title`
  to satisfy a sort order would be worse than the sort is good.

  D9 is what replaced Advanced (A0): a rarely-touched control is now
  de-emphasised by sitting last on its axis rather than by being hidden.

## W — Field and control widths

*Umbrella: a control is as wide as its content needs — never as wide as the
screen allows. Within one panel, though, "as wide as it needs" is settled
ONCE for the whole panel (W0), not re-decided field by field.*

- **W0. THE LATTICE RULE — one label width, one field width, per column,
  each sized to the longest string in that column plus 40px.**
  Inside an axis column every label occupies **the same width** and every
  field occupies **the same width**, so labels start at the same x and
  fields start at the same x. One control per row: two label/field pairs
  never share a line.

  **How the width is chosen (refined 8/13).** Not a hardcoded number —
  the column measures its own longest label and its own longest control
  and adds 40px of room: *"Fields width is 40px more than the longest
  string … For the fields, I'd like to make it similarly flexible."*
  **Per column, not per panel** (operator's choice, 8/13): a short column
  like Structure stays tight instead of inheriting the width of the
  panel's longest label.

  **The columns themselves are compact; the GAPS take the slack.**
  *(8/13: "when the full width available is wider than the sum of the form
  columns, the difference should be spread equally between the spaces
  between the sections … the forms should stay comfortably compact, with
  just the 40px padding between columns.")* Each axis column is as wide as
  its own lattice needs, and all remaining width is split equally between
  the columns — first flush left, last flush right. This replaced
  `repeat(axis-count, 1fr)`, which handed every column an equal share
  whether it needed it or not; that is where the trailing space after
  short rows came from.
  *(operator 8/12, on the Table panel: "The form Labels column must be the
  same width so that the form fields all start in the same place. Even when
  you set up columns, you randomly stagger the placement of the fields so
  it looks very sloppy. Also, make all the fields the same length so they
  look neat and tidy. You always either shorten fields to the minimum
  length or just assign a random width. Every label should take up the
  same width, and every field should take up the same width.")* —
  **[browser-check]** `npm run check:panels`
  (`scripts/ui/check_panels.mjs` — measures the running app at 1440/1600 and
  fails on differing label widths, differing field start positions, differing
  field widths, or a label wider than its track. Verified to FAIL when the old
  `max-content` tracks are put back: 7 label widths, 7 start positions, 6 field
  widths. Not in CI — CI has no browsers — so run it before shipping panel
  work, like `check:screens`.)

  **This outranks W1/W2/W3 wherever they disagree, and they do disagree.**
  W3's per-type width tokens are what produced the stagger: each field was
  sized to its own content, so a 2-digit number select and a "Full width"
  dropdown ended up different lengths on adjacent rows, and each field's
  label track was sized to *its own* label, so the fields started at
  different x-positions down a single column. Tidiness across the panel
  beats tightness on any one row.

  **What W1 still means.** W1 forbids stretching a field to the *widest
  available* width — a field that fills the panel. It has never asked for
  minimum-width fields. A single moderate shared width satisfies both: not
  the width of the screen, not the width of the content, one width for the
  panel.

  **Controls that cannot stretch** — checkbox, colour swatch, alignment
  icon group — keep their natural size and sit at the **start** of the
  field slot. The slot is still the standard width, so the next column
  still lines up.

  **The mechanism is the point: the COLUMN is the grid, not the field.**
  Every strip and field inside it is `display: contents`, so the labels and
  controls become direct children of one grid and two `max-content` tracks
  measure the whole column at once. When each field was its own grid,
  `max-content` measured one row at a time — which is exactly how a single
  panel ended up with 7 label widths and 7 field positions.
  The one number left is `--builder-field-room` (40px) in
  `src/css/_variables.css`. **Never set a width on an individual field.**

  *Rolled out: Table (8/12, refined 8/13), Heading (8/11, on the operator's
  word: "It also hasn't received the new 'Alignment Protocol', so let's
  apply that one here, too"). Every other module follows — the CSS already
  covers any panel, so rolling out is adding the type to
  `LATTICE_MODULE_TYPES` in `builder-module-card.tsx` and re-running
  `npm run check:panels`.*

  **The chrome bar is not a lattice column.** The flowing row of
  module-level settings above a panel (`.builder-heading-module-chrome`,
  `.builder-floating-image-module-chrome`) is one line by design (D1/D2) —
  it has no tracks to line up, so it is excluded from the label room and
  the control stretch. Leaving it in was not cosmetic: on 8/11 the
  Background select stretched to the full width of the bar and the word
  "Alignment" printed on top of it (L5). The SHARED `.builder-module-chrome`
  is **not** excluded — `check_panels` measures it as a lattice group.

  ~~**Known gap:** a panel with an Advanced section renders it as a second
  row of columns, which under per-column sizing measures itself
  independently, so an advanced control sits out of line with its axis.~~
  **Closed by A0 (8/13), which deleted the Advanced section rather than
  aligning it.** Heading is where the gap became visible — its Advanced
  "Text" column sat ~150px left of the basic "Text" column above it — and
  it is the reason A0 gives for deleting rather than fixing: "That made
  Advanced the single blocker to rolling the lattice out across 22 of the
  32 schema-driven panels." One row of columns per panel, so there is
  nothing left to line up.

- **W1.** **Never stretch a field to the widest possible width.** *(7/1
  "I've begged and pleaded with every AI model I've used again and again …
  not to always force every field to the widest possible width")* —
  **[type]** (every field declares a width token — doctrine E2)
- **W2.** Fields of the same kind in the same group get **uniform widths**.
  *(6/28 "making all the form fields in the 3x3 sections the same width";
  6/24 "Make the two columns the same width")* — **[TODO-check]**
- **W3.** ~~Width follows content type: number inputs sized to their digits,
  percent selects small, text inputs medium, URLs/paths long.~~
  **SUPERSEDED BY W0 inside settings panels (operator 8/12).** Sizing each
  control to its own content is exactly what made panels look staggered and
  sloppy. The width tokens survive as *names* on the markup — they still
  say what a field is — but inside a panel they no longer set the width.
  W3 still governs field widths **outside** settings panels (CRUD filter
  bars, page forms), where there is no lattice to hold. *(doctrine E2)*
- **W4.** Sliders and other stretchy controls get a **bounded width** —
  never a full row. *(consequence of W1; violation observed in tractor-nav
  2026-08-09: Inner Opacity and Transition sliders span the panel)* —
  **[TODO-check]**
- **W5.** Columns and fields **may expand to avoid wrapping or cropping**
  (L2/L4 outrank W2's uniformity). *(8/9 example "Allow columns to expand
  width to avoid wrapping")* — **[eye]**
  Scope: settings-panel fields and their label columns. It is **not** a
  licence to widen a table past the viewport — inside a CRUD, T0 outranks
  it and the T7 ladder says how to buy the width back.
- **W6.** A field must never push another field out of view. *(7/1 "Page
  Title, Slug, and Template fields are so wide that they knock the
  Background field off the end so it is invisible")* — **[eye]**

## A — Overriding the theme

*Umbrella: the theme does the styling; a module only overrides it
deliberately, and says so.*

- **A0. ADVANCED IS RETIRED FROM MODULE PANELS (operator 8/13).**
  There is no collapsed Advanced section in a module settings panel.
  Every setting sits on the axis it belongs to. **A1, A3 and A5 are
  withdrawn** — they only described where the collapsed section went and
  what it had to say for itself. **A2 stands and does the real work.**

  *(operator 8/13: "I'm second guessing the Advanced section at the
  moment. There aren't that many settings that go into it, and some of
  them are judgement calls. It may be more trouble than it's worth.")*

  **What the count showed.** 22 panels had an Advanced section holding 67
  settings between them — a median of 2. Twelve panels hid one or two
  controls; eight hid exactly one. That is a collapse, an override badge
  and a second row of columns to conceal two fields.

  **The boundary could not be applied consistently, even deliberately.**
  A6 ruled on 8/11 that text colour is basic. On 8/13, Simple Text, Blog
  TOC and Breadcrumb all still had their text colour inside Advanced —
  contradicted in shipped code within a day of the rule being written.
  A rule nobody can apply is not a rule.

  **A2 is what actually protected the theme, not the hiding.** A control
  that is empty and reads "theme" until you change it already says the
  theme decides this, wherever it sits on screen. The collapse added
  concealment on top and bought nothing — and A3 (the "N overriding the
  theme" badge) existed only to compensate for the concealment.

  **It also cost.** The Advanced row rendered as a second row of columns,
  which under W0's per-column content sizing measured itself
  independently — so an advanced control could sit out of line with the
  axis it belonged to. That made Advanced the single blocker to rolling
  the lattice out across 22 of the 32 schema-driven panels. Deleting it
  was less work than fixing it.

  **If a panel now feels crowded**, that is a signal about the module —
  too many controls, or a missing axis — and a design question for the
  operator. It is not a reason to reintroduce a hiding place (the old A4,
  which survives as A0's own guard).

- ~~**A1.** A setting that overrides a theme value lives in Advanced.~~
  **WITHDRAWN 8/13 — see A0.** Theme-backed settings keep the
  `theme-color` control (A2); they simply live on their axis now.
- **A2.** A theme override is **empty by default and shows the theme's
  value**, with one click to give it back ("theme"). Never a hardcoded
  colour pre-filled into the field — that is an override nobody chose.
  Schema: `control: "theme-color"` with `themeDefault`. — **[type]**
- ~~**A3.** Collapsed must not mean invisible — the Advanced summary
  states how many settings are currently overriding the theme.~~
  **WITHDRAWN 8/13 — see A0.** Nothing is collapsed, so nothing can be
  invisible; the badge was machinery compensating for machinery.
- ~~**A5.** Offsets live under Placement → Advanced.~~ **WITHDRAWN
  8/13 — see A0.** Offsets are still nudges rather than everyday
  placement, so they go **last on the Placement axis** (D9) instead of
  behind a collapse. *(operator 8/10)*
- **A4.** **If a control belongs to an axis, it goes on the axis.**
  Written as a guard against A1 becoming a junk drawer; it outlived A1
  and is now simply how panels are built. — **[eye]**
- **A6.** **Text colour is basic. Effects are advanced.** A1 is amended:
  being theme-backed is not by itself enough to collapse a control out of
  sight. The colour of a piece of text is the most ordinary thing anyone
  changes about it, so it sits on the **Text** axis with size and weight.
  What goes to Advanced is the *effect* layer — drop shadow, hover
  treatments, outlines-as-decoration and their like. Colour keeps its
  `theme-color` control (A2): empty still means "follow the theme", so
  promoting it does not pre-fill an override nobody chose.
  *(operator 8/11: "Don't put text color under Advanced. That is basic.
  Hover effects, dropshadows, etc. are advance.")* — **[eye]**
  **Superseded in part by A0 (8/13):** nothing is collapsed now, so the
  "effects go to Advanced" half no longer has anywhere to send them.
  Effects instead sort to the END of their axis under D9 — still
  de-emphasised, still one glance away rather than one click.
- **A7.** **A shadow belongs to the axis it actually shadows.** A
  `text-shadow` is a Text control; a `box-shadow` on a frame or card is a
  Frame control. Do not file a drop shadow under Frame because "shadows
  live on Frame" — read the renderer first.
  *(operator 8/11: "dropshadows should OBVIOUSLY go under text, not
  Frame. Not sure how you figured that." The Heading module had it on
  Frame while `getHeadingModuleStyle` rendered it as `text-shadow` — and
  the mistake cost more than a heading: it left Frame as the module's only
  reason for a fourth axis, and that empty fourth column is what squeezed
  the drop-shadow controls into an unusable width.)* — **[eye]**

*Status:* the infrastructure is in (control, badge, rule). Which
settings across the 38 modules are theme-backed — and therefore move to
Advanced — is the follow-on pass the operator sequenced after this.

- **W7.** The spacing controls are exactly these four, with these
  names: **Vertical Margin**, **Horizontal Margin**, **Vertical
  Padding**, **Horizontal Padding**. No "Pad V", no "V Margin", no
  per-module invention. *(operator 8/10)* — **[eye]**
  Helper: `spacingFields()` in the settings schema emits the pair(s) so
  the labels cannot drift.

## C — Controls: pick the right one

*Umbrella: the control does the thinking, not the operator.*

- **C1.** When the valid values are knowable, use a **dropdown with
  presets**, not a free-form text field — include "Other"/"None" where
  they make sense. *(7/1 width/height presets; 6/30)* — **[eye]**
- **C2.** **Derived values are computed, not typed.** Picking a
  destination fills in its URL; the operator never hand-formats what the
  system already knows. *(6/30 "selecting the destination from a dropdown
  list, which will automatically format the URL")* — **[eye]**
- **C3.** Boolean settings read as **on/off** at a glance (checkbox or
  toggle). *(6/24 "Just an on/off toggle.")* — **[eye]** *(existing
  Show/Hide selects migrate as panels are touched — flag each in its PR)*
- **C4.** Every filter offers a **Clear**. *(7/2 "Looks like we need a
  'Clear' button, as the filter is sticking")* — **[eye]**
- **C5.** Multi-value inputs grow with an explicit **"+ Add …"**
  affordance. *(7/30 "Include an 'Add Recipient' link under the last form
  field")* — **[eye]**
- **C6.** **No dead controls, no redundant fields.** Every control changes
  something the renderer honors; duplicates are removed, not kept "just in
  case". *(7/1 "'content' field that doesn't do anything … remove it";
  6/28; 7/29; doctrine E7)* — **[eye]**
- **C7.** The reverse of C6: **every setting the renderer honors is
  reachable in the editor.** A missing control is a bug, not a gap.
  *(7/24 "I don't see a Horizontal Margin or a Section Width setting …
  What are we missing?")* — **[eye]**
- **C8.** The **same concept uses the same control everywhere** — one
  background picker, one color field, one margin pair, across all modules.
  *(7/1 "The backgrond selector on this is an older style. Upgrade the
  background selector in this module."; doctrine E1/E6)* — **[auto]**

## T — Tables, lists, and CRUDs

*Umbrella: any list the operator will ever scroll is navigable — and no CRUD
is ever wider than the screen.*

- **T0. A CRUD never extends beyond the width of the screen.** The master
  rule of this section: it outranks every other width preference here, and
  "the data needs the room" is not an exception. Concretely — the page body
  never scrolls sideways, and nothing is reachable only by dragging the
  window. If the data genuinely cannot fit after the whole T7 ladder, the
  **table's own container** scrolls; the page never does. *(8/10 "The
  Builder:Pages CRUD currently extends beyond the width of the screen. This
  should never happen")* — **[browser-check]** `npm run check:screens`
  (`scripts/ui/check_screens.mjs`) drives the real app and asserts this per
  CRUD at 1280/1440/1920. Not in CI — CI has no browsers — so it is a
  command you run before shipping UI work, like `smoke_capture.mjs`.

- **T7. The width ladder.** When a CRUD is too wide, reclaim width in this
  order and **stop at the first rung that makes it fit**. The order is by
  what each step costs the operator: the early rungs cost nothing, the late
  ones cost visibility, and rung 12 is an admission that the earlier rungs
  were skipped. *(rungs 1, 4, 6 and 11 are the operator's own 8/10 list; the
  rest fill in around them. Ladder ratified 8/10, with truncation moved
  above wrapping by his ruling.)* — **[eye]**

  1. **Cut columns that are not needed.** *(operator step 1)* Costs nothing
     — the column was carrying no decision.
  2. **Move rarely-read fields off the row** into its detail/expand view or
     the edit form. Costs one click; loses no data.
  3. **Merge fields that read as one thing** into a single cell (title with
     its slug beneath; "Updated" carrying who and when).
  4. **Size columns to their content, not to a share of the table.**
     *(operator step 2)* A status column has no business being as wide as a
     title column. Costs nothing.
  5. **Reclaim the non-data width**: right-size the checkbox and actions
     columns, trim cell padding, drop decorative gutters. Costs nothing —
     this is chrome, not information.
  6. **Shorten the headings** to the shortest wording that still names the
     column unambiguously. *(operator step 3)* Never to a riddle.
  7. **Shorten the data itself** — compact dates ("Aug 9" over "August 9,
     2026, 3:04:22 PM"), relative times, numbers without noise. Full
     precision stays in the tooltip.
  8. **Turn enumerated values into icons or badges** — visibility, status,
     type — each with a tooltip and an accessible label.
  9. **Hide the least important columns at narrow breakpoints**, restoring
     them when there is room. Costs data on small screens only.
  10. **Truncate between words, with the full value one hover or click
      away.** Costs a cropped line and nothing else — the value is still one
      hover from the operator, which is why this outranks wrapping. Two
      conditions, both mandatory: the break falls **between words**, never
      through one (L4), and the full value is reachable. A mid-word crop or
      a truncation with no hover is a bug, not a fitted table. *(operator
      ruling 8/10)*
  11. **Wrap onto a second line.** *(operator step 4)* For values that must
      be readable at a glance rather than on hover. Below truncation
      deliberately — ragged row heights cost scannability on every row,
      while truncation costs one hover on the rare long value. *(operator
      ruling 8/10 moved this from rung 9 to here)*
  12. **Let the table's own container scroll sideways**, with the
      identifier column frozen. The last resort, and never the page body.

- **T10.** **Bulk actions live right-aligned in the filter row, above the
  Actions column.** One toolbar per CRUD (Publish / Archive / Delete /
  whatever the entity supports), on the filter row's last `<th>`, spanning
  whatever trailing columns it needs. Right-aligned so it lands over the
  Actions column — the same place the eye already goes for per-row actions,
  which is what makes "acts on the checked rows" read as the bulk twin of
  "acts on this row". *(8/10 "Bulk actions such as Delete, Publish, Archive,
  etc. should appear right-aligned in the filter bar, above the Actions
  column")* — **[browser-check]** `npm run check:screens` asserts
  `justify-content: flex-end` and that the toolbar stays inside its cell.
  Canonical markup: `<th class="crud-bulk-actions" colspan="N">` wrapping
  `<div class="crud-bulk-actions-row">`, styled once in
  `src/css/_tables.css`. Do **not** hand-roll a per-table variant, and do
  not name it `*-actions-cell` — that suffix is caught by the actions-column
  selector and centred, which is exactly how the Builder: Pages toolbar
  drifted out over the Updated column.
  Where a CRUD's bulk bar sits *above* its table rather than in a filter row
  (Acquire's YouTube Research panel, the AI Video Library), the same class
  applies: check-all on the left, actions right-aligned over the Actions
  column. The position differs; the alignment does not.
  *Swept 2026-08-10 — all six toolbars in the app now use this:* Builder
  Pages, Assets (filter + bulk), Acquire YouTube research / repository /
  comments, plus BlueSky discovery. Verified in the running app at 1440:
  every one right-aligned, none overflowing its cell, no page scrolling
  sideways. Two of those tables (YouTube repository and comments) still sit
  at T7 rung 12 — they scroll inside their own container — which is legal
  but means the earlier rungs were skipped; they are the next candidates
  for the ladder.
- **T8.** Every flex/grid ancestor of a table sets **`min-width: 0`**. A
  grid or flex child defaults to `min-content` and will happily push its
  container past the viewport — this is the most common cause of a CRUD
  that overflows despite the table itself being `width: 100%`. *(lesson of
  2026-08-10)* — **[TODO-check]**
- **T9.** **No hardcoded pixel `min-width` on a table.** It pins the CRUD
  wider than a laptop and defeats every rung of T7. `.polls-table` carries
  `min-width: 1180px`; `.builder-templates-table` happens to override it
  back to `100%`, so only tables that forget that second class are exposed
  — `builder-bulk-create-preview-table` and
  `builder-bulk-create-results-table` are exposed today. *(lesson of
  2026-08-10)* — **[TODO-check]**
- **T1.** Any list that can grow gets **search, filters, and sort**.
  *(8/7 "hundreds and eventually thousands of modules. So a clear
  navigation system is essential … a text search field"; 7/23 the
  Facebook no-search rant)* — **[eye]**
- **T2.** Tables **fit the page**; the page body never scrolls sideways.
  *(8/6 "truncate the slug column so we can fit the whole table on the
  page"; doctrine R1)* — **[auto]** for the scroll container, **[eye]** for
  the rest.
  **Confirmed 8/10:** truncation stands, and it outranks wrapping — it is
  rung 10 of the T7 ladder, above wrap at 11. The one condition is that the
  full value stays reachable: *"Truncating is acceptable with the additional
  hover you suggested."* A truncated cell with no hover or click to the full
  value is a bug, not a fitted table. This closes the apparent conflict with
  the 8/10 "don't truncate" step, which the operator resolved in favor of
  truncate-then-wrap.
- **T3.** Every CRUD row carries its **full action set** with the standard
  icons — view, edit, delete; no missing verbs. *(7/22 "the whole Saved
  Cells CRUD doesn't have an edit icon")* — **[eye]**
- **T4.** **Identifiers are links** to the thing they name. *(8/6 "link
  the slug to the same page the eye icon links to")* — **[eye]**
- **T5.** Row actions use the **standard icon set**, not ad-hoc buttons.
  *(6/30 "Use the standard delete icon rather than a button"; doctrine §2
  tables)* — **[auto]** (`check_conventions.cjs`) + **[eye]**
- **T6.** Picker/palette icons are **large and meaningful** — they depict
  the type they stand for. *(8/7 "double the size of the icons and create
  icons for each one that represents the type of module it is")* — **[eye]**

## R — Readability and color

*Umbrella: everything legible, every state visible.*

- **R1.** Text is always readable against its background — **white-on-white
  (or near it) is a release-blocking bug.** *(7/24 "you've got the font in
  white, so I can't see the pages"; 7/20; 7/1 unwanted white hover)* —
  **[TODO-check]** (contrast lint on token pairs is feasible)
- **R2.** Color comes from **theme tokens**, never hardcoded hex; type
  sizes come from the **type scale**. *(doctrine R3/R8)* — **[auto]**
- **R3.** Focus and selection are **visibly marked**. *(6/28 "there is no
  3px green border around the Page title field, as request"; doctrine R6)*
  — **[eye]**
- **R4.** Hover states are designed, never accidental. *(7/1 "on mouseover
  we get a white background. I don't want that")* — **[eye]**

- **R9.** **High contrast between text and its background, always** —
  and every heading inside an editor is the **same dark blue**
  (`--builder-editor-heading`). Field labels share that colour and weight
  at normal size (`--builder-editor-label`). Muted grey on the builder's
  blue panels is the low-contrast pairing this rule exists to stop.
  *(operator 8/10: "we require high contrast between the background and
  the fonts. All headings within the editors should have the same dark
  blue color")* — **[eye]**, tokens are **[type]**-adjacent (named in
  `_variables.css`, so a drift is visible in one place)

## S — System and structure

*Umbrella: every module familiar; nothing hand-rolled; nothing stale.*

- **S1.** Every settings panel is built from the **one shared system**
  (schema-generated or field strips) — so learning one module means
  knowing them all. *(8/7 "the user finds every single widget familiar in
  terms of structure and design"; doctrine E1)* — **[auto]**
- **S2.** Horizontal and vertical margin are offered **together**;
  universal chrome (visibility, vertical margin) is never duplicated
  per-module. *(doctrine E4/E6)* — **[auto]**
- **S3.** Sections and modules carry **human names** so pages are
  navigable in the Builder. *(7/17 "I am a fan of populating the section
  titles so future users can follow the builder much more easily")* —
  **[eye]**
- **S4.** **No stale UI**: old screens replaced by new ones are removed,
  not left reachable. *(7/23 "find any other areas where stale code is
  being shown instead of new code")* — **[eye]**
- **S5.** A layout the operator has specified for a panel (e.g. the 6/28
  blog-post-list three-column design) is **recorded here with the panel's
  name and never flattened by a later convention pass.** *(lesson of
  2026-08-09)* — **[eye]** · Registry: blog-post-list → 3 columns
  (general / Page Design / Card Appearance).

## P — Published page (rendered module) rules

The full rendered-UI ruleset lives in `docs/MODULE_UI_DOCTRINE.md` §1b
(R1–R8: base-layer layout, overrides file, tokens, empty states, three
viewport widths, accessibility, sanitized HTML, type scale). Operator
additions recorded so far:

- **P1.** List bullets single-spaced globally. *(7/23)* — **[eye]**
- **P2.** Sections support **constrained vs full width**, and adjacent
  sections can share a continuous full-width background. *(7/24)* —
  shipped as `widthMode` (PR #32); section-linking still open
- **P3.** Language switcher renders as **text buttons** ("English" /
  "Espanol"), never flag images. *(7/17; regression re-fixed 7/22)* —
  **[eye]**

---

## Violations already on the books (found 2026-08-09, to fix first)

The full audit lives in `docs/UI_RULES_AUDIT.md` (rule-by-rule
cross-reference + 13-fix plan). Original list, with status:

1. **W4**: tractor-nav sliders span the panel (audit confirmed ×3 —
   Inner Opacity, Transition, Curve; range inputs have no width rule).
2. **D2/D3**: converted panels stack short rows down the left edge —
   the schema generator needs multi-column group layout (D4) before the
   panels can honor D1/D2.
3. **S5**: blog-post-list lost its three-column layout in the sweep —
   restore it (needs D4 first).

**Operator rulings 2026-08-09 (all three open questions closed):**
- blog-post-list's half-built fields: **wire them up** — done for
  postTitle (renders the list heading) and postSlug (names the post-view
  page; replaces the old page-URL field per 6/28). popularityFilter needs
  post view/like tracking that has never existed — control removed until
  the tracking feature ships (Dev Backlog); wiring a sort with no data
  would just be new C6 theater.
- L6 **applies to card managers** — breadcrumb + feature-cards converted
  to `.builder-item-grid` titled grids (done).
- heading horizontal margin: **add capability** — done end to end
  (renderer + normalization + paired control); E4 now gates repo-wide
  with the Top/Bottom split accepted as the vertical side.
4. ~~Field-strip labels render red-ish~~ — investigated 2026-08-09 and
   **withdrawn**: pixel-sampling the screenshot found zero red-dominant
   pixels; the labels are the standard muted token. (Kept as a record that
   suspected violations get verified, not assumed.)

## Checking these rules

Most of section T is about geometry, which cannot be read off the source —
four layout bugs on 2026-08-09/10 were diagnosed wrongly from the CSS and
only fell out once the running app was measured. So:

```
npm run dev                 # in another shell
npm run seed:ui-fixture     # once: a local project of deliberately awful content
export UI_HARNESS_PROJECT_ID=<the id it prints>
npm run check:screens       # T0 + T10 across every CRUD at 1280/1440/1920
```

`scripts/ui/check_screens.mjs` carries the registry of screens — adding one
is a line. It writes screenshots to `.ui-check/` and says so on every run,
because **assertions only check what someone thought to assert**: an Assets
toolbar passed every numeric check while stacking its buttons into a ragged
column, and a sweep once reported a confident "12/12 conform" while
measuring the same three toolbars four times. Zero failures is an
invitation to look at the screenshots, not a substitute for it.

## How this list grows

New operator statement → lands here as a numbered rule with its quote and
date → gets a checker where possible (status upgrades from `[TODO-check]`
to `[auto]`) → panels are re-swept against it. **The list only gains rules;
removing or weakening one takes an explicit operator decision recorded in
the rule's annotation.**
