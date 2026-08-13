# Panel form sweep — apply the 8/12–8/13 form rules to every module

**Status:** queued. Filed here because ClickUp writes were rate-limited when
this was written (2026-08-13); it belongs in the **Loop Queue** list
(`901418546619`, Starcaster space) and can be pasted in verbatim.

Feature Cards was rebuilt over several rounds until its form obeyed the panel
rules. The same rules have never been applied to the other module panels.
This is that sweep.

## The rules to apply

- **W0 — the lattice.** One label width and one field width per column, each
  sized to the longest string plus 40px (`--builder-field-room`), built the
  prescribed way: the COLUMN is the grid, fields are `display: contents`,
  **never a width on an individual field**. `docs/UI_RULES.md`.
- **L6a — item managers.** A repeating item editor either stays a clean
  titled-column grid, or becomes one labelled block per item on its own
  lattice. Feature Cards is the worked example.
- **L8 — the block edge** (new, 8/13). The form is one rectangle: one left
  edge, one right edge; a wide control runs to the edge rather than stopping
  where it ran out; a trailing button sits on the edge and matches the width
  of any button under it; the space between columns is a real 40px gap; the
  panel's chrome sits on the same edges.
- **W9 — the ceiling.** No control wider than `--builder-field-long-max`.
  Where it fights L8, bound the BLOCK rather than widening the control — see
  `.builder-cards-panel-fields`.

## Known first item

**The module chrome and the settings column are two separate lattices.**

In a two-column editor (Feature Cards, Slideshow) the operator reads them as
one column, and their field widths visibly differ: Label / Background / the
four margins are sized one way, the Layout and Card fields another. Operator,
8/13: *"notice in the left column how the column width varies arbitrarily
between the Settings fields and the Layout fields."*

He is right, and it is not fixable inside one module. The chrome is rendered
by `builder-module-card.tsx` for **every** module as a flowing bar (D1/D2);
the settings column is a separate lattice grid below it. Two grids cannot
share a track width — the only correct fix is to put chrome and the panel
column in ONE grid, which changes the chrome every module inherits. That
blast radius is why it is the first item of a sweep rather than a bodge in
one editor.

## How to work it

One module (or one small family) per PR, not a big bang. For each panel:

1. Read `docs/UI_RULES.md` W0 **including the mechanism half**, plus L6a and
   L8.
2. Open the panel in the running app at 1440 / 1600 / 1920 and look at it.
   Screenshots, not source reading — every miss in this thread was invisible
   in the source and obvious on screen.
3. `npm run check:panels`. If the panel uses markup the check has never seen,
   it reports a clean pass over nothing: give it a shape the check knows
   (`.builder-module-field`, `.builder-setting-row`, `label.field`), or
   declare it with `data-lattice-pairs` and seed real content into
   `scripts/ui/seed_fixture.mjs`.
4. **Prove the check fails** by breaking the layout on purpose before
   trusting the pass.

## Acceptance criteria

- Every module panel passes `npm run check:panels` at 1440/1600/1920 **with
  real content seeded** — an empty manager measures nothing and passes.
- No panel carries a per-field width in CSS; widths come from the shared
  tracks and tokens.
- Every form reads as one rectangle at all three widths (L8), verified by
  screenshot.
- Any panel deliberately exempted is listed with its reason in
  `docs/UI_RULES.md`.

## Why it is worth the time

Three consecutive rounds on one panel went to rules that were already written
down and already had a checker. The checker could not see the new markup, the
fixture had no cards in it, and the widths tested did not include the
operator's own screen. All three are fixed now. This task spends that fix
across the rest of the app instead of rediscovering it panel by panel.
