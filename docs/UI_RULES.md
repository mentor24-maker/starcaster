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

## W — Field and control widths

*Umbrella: a control is as wide as its content needs — never as wide as the
screen allows.*

- **W1.** **Never stretch a field to the widest possible width.** *(7/1
  "I've begged and pleaded with every AI model I've used again and again …
  not to always force every field to the widest possible width")* —
  **[type]** (every field declares a width token — doctrine E2)
- **W2.** Fields of the same kind in the same group get **uniform widths**.
  *(6/28 "making all the form fields in the 3x3 sections the same width";
  6/24 "Make the two columns the same width")* — **[TODO-check]**
- **W3.** Width follows content type: number inputs sized to their digits,
  percent selects small, text inputs medium, URLs/paths long. *(doctrine
  E2 width tokens)* — **[type]**
- **W4.** Sliders and other stretchy controls get a **bounded width** —
  never a full row. *(consequence of W1; violation observed in tractor-nav
  2026-08-09: Inner Opacity and Transition sliders span the panel)* —
  **[TODO-check]**
- **W5.** Columns and fields **may expand to avoid wrapping or cropping**
  (L2/L4 outrank W2's uniformity). *(8/9 example "Allow columns to expand
  width to avoid wrapping")* — **[eye]**
- **W6.** A field must never push another field out of view. *(7/1 "Page
  Title, Slug, and Template fields are so wide that they knock the
  Background field off the end so it is invisible")* — **[eye]**

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
  should never happen")* — **[TODO-check]** (a Playwright width assertion
  per CRUD at three viewports is the obvious checker)

- **T7. The width ladder.** When a CRUD is too wide, reclaim width in this
  order and **stop at the first rung that makes it fit**. The order is by
  what each step costs the operator: the early rungs cost nothing, the late
  ones cost visibility, and rung 12 is an admission that the earlier rungs
  were skipped. *(rungs 1, 4, 6 and 9 are the operator's own 8/10 list, in
  his stated order; the rest fill in around them)* — **[eye]**

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
  9. **Wrap, never crop.** *(operator step 4)* A long value takes two lines
     rather than losing characters. Costs row height, which is cheap;
     upholds L4.
  10. **Hide the least important columns at narrow breakpoints**, restoring
      them when there is room. Costs data on small screens only.
  11. **Truncate, with the full value one hover or click away** — only once
      wrapping has already failed. Costs cropped text; see T2.
  12. **Let the table's own container scroll sideways**, with the
      identifier column frozen. The last resort, and never the page body.

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
  **Amended 8/10:** truncation is no longer the first tool for making a
  table fit — it is rung 11 of the T7 ladder, reached only after wrapping
  has failed, and always with the full value a hover or click away. The 8/6
  statement ("truncate the slug column") and the 8/10 statement ("don't
  truncate text") are reconciled as **wrap before you crop**. *Flagged for
  operator confirmation — this weakens a recorded rule, which per "How this
  list grows" needs his explicit ruling.*
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

## How this list grows

New operator statement → lands here as a numbered rule with its quote and
date → gets a checker where possible (status upgrades from `[TODO-check]`
to `[auto]`) → panels are re-swept against it. **The list only gains rules;
removing or weakening one takes an explicit operator decision recorded in
the rule's annotation.**
