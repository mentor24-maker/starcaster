# Proximity effects

**Shipped:** 2026-08-17.
**Applies to:** the `tractor-nav` module (UI name: the proximity-effect dot).
**Source:** `lib/builder-client/proximity-effects.ts` (all the geometry, unit
tested in `proximity-effects.test.ts`),
`components/builder-tractor-nav-module.tsx` (the DOM and the stylesheet),
`components/builder/builder-tractor-nav-module-settings.tsx` (the panel).

Something on the page answers the cursor: the closer you get, the more it does.
Two features had already built this separately — the module's concentric rings,
and the Explore link's halo on the login screen — so this is the shared driver
with the difference reduced to one branch.

---

## The model

**One driver.** Distance from a centre → one 0-to-1 number. `proximityValue()`
owns that curve and nothing else; it has no DOM in it, which is what lets it be
tested in a repo where **nothing tests CSS**.

**Two kinds of renderer.**

- **Continuous** (Glow, Spotlight, Swell) read the number straight, through the
  `--znav-prox` custom property. CSS does the rest.
- **Stepped** (Rings) ask a second question — which band am I in —
  and get an index from `activeRingIndex()`.

That single branch is the whole difference between "concentric circles" and
"a halo".

## The presets

| Effect | Draws | Controls it uses |
|---|---|---|
| **Rings** | Concentric circles; the smallest one still containing the cursor fills | Ring Count, Sizing Mode, Ring Step / Outer Size + Curve, Inner Opacity, Opacity Step, Transition, Hover Color |
| **Glow** | A blurred disc of light growing out of nothing at the dot | Outer Size, Reach, Falloff, Color |
| **Spotlight** | The same light, but riding the cursor instead of sitting on the dot | Outer Size, Reach, Falloff, Color |
| **Swell** | The dot itself grows | Reach, Falloff, Color |

**Reach** is how far away the cursor is first felt, in pixels. **Falloff**
shapes the approach — 1 rises steadily the whole way in, higher numbers hold
the effect back until the cursor is close and then open it quickly.

Rings deliberately have no Reach: their reach IS the outer ring, and a second
number that silently disagreed with the drawn circle would be a control that
looks like it works and does not.

---

## The traps

### 1. The rings were never concentric, and the preview hid it

From the day the module was added (2026-06-21, commit `15f1acc3`) until this
rewrite, `TractorNavRuntime` built its rings as **flex siblings** — ten circles
in a 670px-wide horizontal row, dot inside the fourth. The card preview in the
same file drew them correctly, absolutely positioned and centred. So the
Builder's module card showed the right picture while every real page showed a
row, for two months.

Published tenant sites render through `builder-bundle.js`, the same component.
This was live, not a preview-only glitch.

The tell was in its own stylesheet: `.znav-ring` set `display: flex;
align-items: center; justify-content: center` — instructions for centring your
CHILDREN, meaningless unless each ring contains the next. The port to React
flattened the nesting into `sizes.map()` and kept styling that no longer had
anything to centre.

**A preview that renders differently from the runtime is not a preview.** Both
now come from one `EffectLayers` component and one `readSettings` reader.

### 2. An inline transform silently kills an animated one

The obvious way to centre an absolutely positioned layer is
`transform: translate(-50%, -50%)` in the style object. Do that on a layer
whose transform is also animated and **the inline style wins over every class
rule** — so the stylesheet's `scale(var(--znav-prox))` and Spotlight's cursor
offset never ran.

Nothing errored. Glow still *appeared* to grow, because a blurred edge fading
in with opacity reads as growth, and Spotlight rendered pixel-identical to
Glow. It was caught by looking at a contact sheet of all four presets side by
side and noticing two rows were the same picture.

**Whoever animates the transform owns the whole transform**, translate
included. Rings do not animate theirs and keep it inline.

### 3. The pointer was tracked on an element nothing can touch

The old code bound `mousemove` to its own root. The module's default `z-index`
is `-9999`, so on any real page the content above it swallows the pointer and
the handler never fires — dead on arrival even where the layout looked fine.
One passive **document-level** listener, coalesced to a single write per frame,
is both correct and cheaper.

### 4. Do not delete the settings a preset ignores

`normalizeImageEffectSettings` deletes the keys its effect does not use, and
that is right for the image module: those keys exist only for the effect.
`normalizeProximityEffectSettings` deliberately does **not**. The keys it would
drop are Ring Count, Ring Step and Curve — a ring layout somebody tuned by
hand. Flicking to Glow and back would destroy it silently and unrecoverably.

Gate the display; keep the data. There is a test that fails if this is ever
"tidied up".

### 5. check:panels could not see half the panel, and said OK

The fixture seeds one module per type, so it carried a proximity module on the
default preset — Rings. Reach and Falloff are `visibleWhen: isContinuous`, so
neither ever rendered, and the check reported a clean pass across 636 panels
having measured a panel two fields short.

Found by dumping the field names the run actually measured, not by trusting the
green line. `scripts/ui/seed_fixture.mjs` now seeds a **second** proximity
module in Glow mode, exactly as it already does for the mega-panel menu and the
cards carousel. The count went 636 → 648.

**Known gap, not fixed here:** a hard pixel width on a `control: "custom"`
render is invisible to `check:panels`. A 1200px-wide slider was planted on this
panel, confirmed present in the built bundle, and the check still reported OK at
all three widths. W0's own words are "never put a width on one field" — for
custom-rendered controls, nothing enforces that. Filed for its own thread.

---

## Adding a preset

1. Add it to `PROXIMITY_EFFECT_OPTIONS`.
2. Decide continuous or stepped and say so in `proximityIsContinuous` /
   `proximityUsesRings` — stated positively, so a new stepped preset does not
   silently inherit two controls that do nothing for it.
3. Draw it in `EffectLayers`, once, so the card and the runtime cannot drift.
4. Gate its controls with `visibleWhen` — nothing is ever shown greyed out.
5. Seed a fixture module on that preset if it gates any control, or
   `check:panels` will pass without measuring them.
6. Screenshot it at four points on the curve. There is no other evidence.
