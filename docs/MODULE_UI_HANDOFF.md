# Handoff: module UI quality, and the UI doctrine

**Folder / branch:** `.claude/worktrees/module-ui` on `module-ui-doctrine`,
cut from `main` at `33a2ad8` (PR #105).

**Opened:** 2026-08-08, by the operator, immediately after checking out the
Feature Cards and mega-menu modules on production.

**The operator's framing, verbatim:** *"the functionality seems basically
right. The problem, as is the case with all the modules currently, is that
the UI is abysmal. We are going to address the UI of these modules and
establish a complete coding standards for UI doctrine in the process."*

Read that twice, because it sets the scope. This is **not** a bug-fix pass on
two modules. The two modules are the *worked example*; the deliverable is a
written UI standard general enough that the remaining ~50 module types can be
brought to it, and that a new module cannot be built badly without visibly
breaking a rule.

---

## 1. Read these first, in this order

| Doc | Why |
|---|---|
| `CLAUDE.md` (root) | repo invariants, generated-file table, landmines |
| `docs/DOCTRINE.md` | the house style for a rules doc: every rule carries the incident that produced it |
| `docs/MODULE_STANDARDS.md` | the existing 13-rule bar — rule 10 is the seed of the UI doctrine |
| `docs/MODULE_DEV_PIPELINE.md` | how module work moves: Intake → Discovery → Spec → Ratify → Build → Verify → Merge |
| `docs/MODULE_SYSTEM_HANDOFF.md` | the parent thread this one branches off; the declarative-settings-schema proposal lives there |
| `components/CLAUDE.md` | field-strip conventions, module-adding checklist |
| `src/css/CLAUDE.md` | icon house style ("Pods"), CSS layer rules |

---

## 2. Two different UIs are in scope — keep them separate

Almost every disagreement about "the module UI" comes from these two being
discussed as one thing. Sort every item on the operator's lists into one:

**(A) The editor UI** — what the operator sees in the Builder when a module is
selected: the settings panel, its fields, grouping, labels, order, pickers,
item managers. Governed today by MODULE_STANDARDS rule 10 (field-strip
layout) and rule 13 (no dead controls).

**(B) The rendered UI** — what a site visitor sees on the published page: the
module's own layout, spacing, type, colour, states, responsiveness.
Governed today by rules 3, 5, 7, 8.

Both are in scope. They fail for different reasons and get fixed in different
files, so a list that mixes them will produce a PR that mixes them.

---

## 3. Measured state, as of `33a2ad8`

Numbers taken in this worktree, not from memory:

- **37** `*-module-settings.tsx` files exist in `components/builder/`.
- **5** of them use `BuilderModuleFieldStrip`. The other **32** are
  hand-rolled. Rule 10 exists but is nearly unadopted — that gap *is* the
  "abysmal UI" the operator is describing, quantified.
- `components/builder/builder-module-card.tsx` is **4,684 lines** and holds
  settings UI for many types inline, including Navigation (`navDropdownStyle`
  appears there, not in any `*-module-settings.tsx`). Extracting an editor
  from this file is a prerequisite for standardising it.
- `src/css/_builder-react-overrides.css` is **1,274 lines** — the
  hand-authored layer where all new rules must go.

### The two modules under the microscope

**Feature Cards** (`feature-cards`)

| Surface | File |
|---|---|
| Renderer (published page) | `lib/builder-client/builder-template.ts` |
| Canvas preview | `components/builder-template-preview.tsx` |
| Settings editor | `components/builder/builder-feature-cards-module-settings.tsx` (329 lines) |
| Palette entry + icon | `components/builder/builder-module-card.tsx`, `builder-module-group-icons.tsx` |
| Shared card content model | `lib/builder-client/builder-card-items.ts` |
| Styles | `src/css/_builder-react-overrides.css` |
| Email | deliberately on the skip list in `builder-email-render.ts` (CSS grid; Outlook has neither grid nor flex) |

**Mega menu** (`navDropdownStyle: 'mega'` on the Navigation module — not its
own type)

| Surface | File |
|---|---|
| Panel logic / column derivation | `lib/builder-client/builder-nav-mega.ts` (+ `.test.ts`) |
| Renderer + canvas preview | `builder-template.ts`, `builder-template-preview.tsx` |
| Settings editor | inline in `builder-module-card.tsx` — **not extracted** |
| Styles | `src/css/_builder-react-overrides.css` |

Reminder that constrains every change here: **live tenant sites run the
Navigation module.** `list` is the default and its code path is untouched by
PR #105. Keep it that way — any restyle must not move an existing menu.

---

## 4. The operator's issue lists

He is supplying a laundry list per module. Paste each verbatim below as it
arrives, then work it — do not paraphrase into the doc, because the raw
wording is the requirement and the paraphrase is already an interpretation.

For each item record: **(A) editor or (B) rendered** · the file it lands in ·
whether it is *this module only* or *a general rule* (general ones are the
raw material of the doctrine).

### 4.0 RECOVERED FEEDBACK (2026-08-09) — awaiting operator confirmation

**How this section got here.** On 2026-08-09 the operator reviewed the
converted panels on `module-tester` and said: *"this looks absolutely
terrible, with lots of thinks I specifically talked about. For one thing,
look at all the wasted screen real estate on the right side. Orphaned
fields."* He was right: his design input from June–August sessions was never
recorded in this repo — these sections sat empty while the doctrine encoded
only the mechanically checkable layer. His words were then recovered by
mining every Claude session transcript on the machine (128 keyword hits, 46
genuine directives). Everything below is **verbatim**, with thread and date.
Input given in claude.ai chats (not Code sessions) is not on this machine
and is NOT here — the operator should add anything missing.

**The clearest proof of the loss:** on 2026-06-28 he supplied a layout
design for blog-post-list — *"Attached is a layout design for the
blog-post-list module to organize and compact the form. This arranges the
fields into three sections (general, Page Design, Card Design) arranged in
three columns."* That three-column design was built — and then the
2026-08-09 doctrine sweep **flattened it into stacked single rows**, because
no rule recorded why it was three columns. A convention pass that doesn't
know the design intent will steamroll it.

#### Recurring demands (each appeared 2–6 times across threads)

1. **Never force fields to maximum width; modest, uniform widths.**
   *"I've begged and pleaded with every AI model I've used again and again
   and agin not to always force every field to the widest possible width,
   but to no avail. There appears to be some mysterious master style to rule
   them all that overrides each and every attempt to reign in the width of
   fields."* (main, 7/1) · *"make them all 100px wide"* (6/28) · *"expand
   the field widths to 200px, which might get us to a uniform field width"*
   (6/28) · *"Make the two columns the same width"* (6/24)
2. **Minimize vertical space — related controls share a row; use the empty
   right side.** *"The goal is to minimize vertical space and the need for
   scrolling"* (6/30) · *"Put all the card elements on the same line. There
   is plenty of room for all three dropdown lists on the same row"* (6/30)
   · *"since there is plenty of room to the right of the Pages section,
   display the selected pages to the right, parallel to the Pages section"*
   (7/24) · *"wasted screen real estate on the right side. Orphaned
   fields"* (8/9)
3. **One uniform structure so every module feels familiar.** *"an elegant
   and robust system... so the user finds every single widget familiar in
   terms of structure and design"* (site-import, 8/7)
4. **Labels never cut off, never overlapping, never cryptic; grid columns
   get titles.** *"the labels Date Range filter, Popularity filter, and
   Category filter are all cut off by the fields"* (6/28) · *"Give each of
   those field columns titles: Parent Page, Page Name, Slug, Width,
   Action"* (7/1) · *"come up with a clearer description. I'm not quite
   sure what that even means"* (7/24)
5. **Remove dead/redundant fields.** *"I notice this field has a 'content'
   field that doesn't do anything. If that field is indeed extraneous,
   please remove it."* (7/1) · *"Remove the 'Post view page' field
   (redundant to the slug field)"* (6/28)
6. **Readable contrast, always.** *"you've got the font in white, so I
   can't see the pages"* (7/24) · *"fix the font and/or background colors
   so they are readible"* (7/20)
7. **Any long list gets search, filters, sort.** *"I anticipate dozens of
   categories/types... for a total of hundreds and eventually thousands of
   modules. So a clear navigation system is essential... we need at the top
   nexto to the sort icons is a text search field"* (blazefish, 8/7)
8. **Dropdowns with sensible presets over free-form fields.** *"it should
   be a matter of selecting the destination from a dropdown list, which
   will automatically format the URL"* (6/30) · standard width/height
   presets + "Other"/"None" (7/1)
9. **Standard icons for row actions, not ad-hoc buttons.** *"Use the
   standard delete icon rather than a button"* (6/30)
10. **Section width control: constrained vs full width** (7/24), and
11. **Language switcher as text buttons, not flags** (7/17, 7/22) — module
    specifics, kept for their modules.

The full 46-entry digest with complete quotes lives at
`docs/OPERATOR_UI_FEEDBACK.md` (same date). The operator then commissioned
**`docs/UI_RULES.md` — the Master UI Rules** (2026-08-09): every statement
distilled into numbered, sectioned rules with enforcement status. That list
is now the requirements source for the overhaul; it grows as he supplies
per-module lists.

### 4.1 Feature Cards

> *"The attached shows what the Feature Cards look like currently: generic
> black and white."* (main, 2026-08-08 — the trigger for PR #115.)
> _(further items awaiting the operator's list)_

### 4.2 Mega menu / Navigation

> _(awaiting the operator's list)_

### 4.3 General — applies to all modules

> See §4.0. _(items the operator adds or confirms land here as the working
> list)_

---

## 5. The deliverable: `docs/MODULE_UI_DOCTRINE.md` — **WRITTEN 2026-08-08**

**Status: ratified and shipped.** The operator chose the shape (one doc, two
halves) and the sequencing (doctrine and checks together, before the module
work). The doc exists; read it, don't re-derive it.

What landed with it:

- `scripts/check_ui_doctrine.cjs` — the mechanical half. Runs at pre-commit on
  staged changes and as a **blocking** CI step (`npm run check:ui`). It is a
  separate step from the older conventions check on purpose: that one is
  `continue-on-error: true` because of 7 pre-existing `button`-in-`<th>`
  violations, and folding the UI rules in would have made them advisory too.
- `npm run check:ui:report` — standing whole-repo debt. At time of writing:
  **5/37** field-strip adoption, **2** editors with unpaired H/V margin,
  **0** breakpoint-only layout selectors.
- `BuilderModuleField.width` is now a **required** prop, so "every field
  declares a width token" is a compile error rather than an eyeball check.
- One live bug fixed: `.builder-preview-table-wrap` had `overflow-x: auto`
  only inside `@media (max-width: 900px)`, so wide tables scrolled the page
  body on desktop. Found by the R1 checker on the day it was written.

The measured state in §3 below is what motivated all of it. The original
proposal is kept below for the reasoning; **the doc itself is now canonical.**

**Update 2026-08-08 (later, `module-ui-overhaul` branch):** the doctrine's
three prerequisite tasks are closed — spacing/type scales in
`_variables.css` (with rule R8 gating literal font sizes), Navigation's
editor extracted to `builder-navigation-module-settings.tsx`, and the
declarative settings schema built (`builder-settings-schema.tsx`, first
used by current-poll). The E4 margin debt is at zero and the full sweep of
the remaining hand-rolled editors is in progress on that branch. §4's
per-module issue lists are still awaited — deliberately after the sweep, so
the operator's comments land on design judgment, not on mechanical
inconsistency the rules already remove.

A new doc, in `DOCTRINE.md` house style — every rule paired with the concrete
thing that went wrong to produce it. Proposed structure:

1. **Editor UI** — absorbs and expands MODULE_STANDARDS rule 10: strip order,
   field width tokens, label wording and length, control choice (when a
   select beats a segmented control beats a checkbox), item-collection
   managers (add/remove/reorder), empty and error states, what belongs in
   *Advanced*, what is universal chrome and must never be duplicated per type.
2. **Rendered UI** — spacing scale, type scale, colour sourcing (theme tokens,
   never hard-coded hex), the responsive ladder and its breakpoints, the
   required states (hover, focus-visible, active, disabled, empty, loading),
   image handling and aspect behaviour.
3. **Shared** — the icon house style, motion and duration, accessibility
   floors, RTL/long-string/overflow behaviour.
4. **Conformance** — how each rule is *checked*. A rule nobody can test is a
   suggestion. Some are lintable, some need the test suite, some are an
   eyeball step; say which for every rule.

Then: MODULE_STANDARDS rule 10 shrinks to a pointer at this doc, so there is
one home for UI rules rather than two that drift.

**Interaction with the parent thread.** `MODULE_SYSTEM_HANDOFF.md` proposes a
declarative settings schema that would *generate* editors instead of having
50 hand-written ones. That proposal and this doctrine are the same work
approached from opposite ends: the doctrine says what a good editor looks
like, the schema makes it the only thing you can build. Write the doctrine
first — a generator built before the standard just mass-produces the current
mistakes. Note any rule that would be *free* under a generator; that list is
the schema's requirements document.

---

## 6. Landmines specific to UI work here

1. **`_builder-react.css` is regenerated and will eat your changes.**
   `extract_builder_css.mjs` replaces that file wholesale; commit `2bd3018`
   silently deleted the CRM modal styles this way and broke Contacts delete
   for a month. **All new CSS goes in `_builder-react-overrides.css`.**
   Nothing tests CSS — a deletion is silent.
2. **`public/styles.css` is a build artifact.** Edit `src/css/*`, run
   `npm run build:css`, never commit the artifact.
3. **No breakpoint-only layout CSS** (standard 3). Base layer holds the
   structure; media queries may only *adjust*. This is the exact bug that
   started the whole module-quality effort — Card Slider's entire layout
   lived inside `@media (max-width: 900px)`.
4. **Dual registration** (standard 1): after touching
   `lib/builder-client/builder-template.ts`, run
   `npm run build:builder-template`, or the server coerces the type to
   `text` on every page load.
5. **A module may not depend on ambient CSS it does not own.** If it looks
   right only because some other module's stylesheet happens to be on the
   page, it is broken.
6. **Restyling Navigation touches live client sites.** See §3.
7. **Whole-file staging** (root CLAUDE.md #5): `git add <file>` takes every
   uncommitted edit in that file. Inspect `git diff --cached` before
   committing.

---

## 7. Definition of done

Per the root `CLAUDE.md`, run and *state the results of*:

1. `npm run typecheck`
2. `npm run test:builder-ui` and/or `npm run test:builder`
3. The rebuild for every generated artifact touched — for UI work that is
   almost always `npm run build:css`, plus `npm run build:builder` and
   `npm run build:builder-template` if the module's TS changed
4. `node scripts/check_conventions.cjs`
5. `npm run check:syntax` if `public/js/` or `public/shared/` was touched

Plus, for this thread specifically:

6. **The eyeball at 1440 / 768 / 390** (standard 7). PR #105 shipped without
   it and that is part of why we are here. It is an operator step — set the
   work up so it is quick for him to do, and say plainly that it is pending
   until he has done it.

"It should work" is not done. Passing commands are done.

---

## 8. Working with the operator

- He directs this project but is not a career programmer; his background is
  hands-on HTML/LAMP-era building. **Plain language, always** — explain any
  term the first time it matters.
- **Terminal output is invisible to him.** Pasting a file into the terminal
  delivers nothing. Put the content in the reply text, and drop a copy of any
  document on his Desktop — files inside a worktree do not show up in his
  editor either.
- **He does not run git.** The agent runs branches, commits, pushes, merges,
  and the operational scripts. Secrets are the exception: he types those.
- **Narrate interactive commands keystroke by keystroke** if one is ever
  needed, including what success looks like.
- **Coach in the moment** when something is risky, in one sentence, with the
  safer command ready to run. That coaching is part of the deliverable, not
  an interruption — he has asked to be trained as the work proceeds.
- One folder per thread. `main` auto-deploys to production on merge.
