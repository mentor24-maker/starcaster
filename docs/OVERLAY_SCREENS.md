# Overlay screens

An **overlay screen** is a layer of colour, gradient or image painted *over* a
section's own background and *under* its content. It is what makes white text
readable on a photograph, what tints a stock image toward a client's brand
colour, and what stops a video background from competing with the words on top
of it.

The controls are in **Section Settings → Overlay**, a group in the row editor's
lattice, next to Visibility.

---

## What is built, and what is not

A doc that describes queued work as though it exists is worse than no doc, so
this is stated first and in three states rather than two.

**Live on `main` today:**

* The overlay editor itself — type, opacity, and colour / gradient / image
  (#482, commit `c335921a`).
* The renderer that paints it (#475).
* **Gradient angle** (86bbqb06q). This one is worth calling out because it was
  spec'd as an overlay follow-up and has since shipped: an angle box replaced
  the hardcoded 135°, and because of the shared-type property described below,
  it arrived working on overlays without an overlay-specific line of code.

**Built, reviewed, not yet merged** — do not describe these as available to the
operator, and do not assume their shape is final:

* **Blend mode** — tint a photo instead of fogging it (86bbqb08p).
* **Cell-level overlays** — an overlay screen on an individual cell rather than
  the whole row (86bbqb0ac).

**Not built:** anything else. There is no per-breakpoint overlay, no animation,
and no second overlay layer on a single row.

---

## The idea the feature rests on

An overlay screen is two fields:

```ts
// lib/builder-client/builder-template.ts:247
export type RowOverlayScreenSettings = {
  background: BackgroundSettings;
  opacity: number;
};
```

`BackgroundSettings` is **the same type a section's own background uses**. Not a
parallel type with the same shape — the same one.

That single decision is why the overlay editor needed no renderer work and no
new picker. The moment the panel mounted the shared `BuilderBackgroundControls`
against `overlayScreen.background`, colour, gradient and image all worked on
arrival, because every one of them was already implemented for row backgrounds.
It is also why gradient angle, built for backgrounds, appeared on overlays for
free.

The same property sets the ceiling. An overlay can only ever be made of things
`BackgroundSettings` can express. **Video is deliberately excluded** from the
Overlay picker (`allowVideo` is not passed): a video screen over a video
background is a second `<video>` element, and the panel's own test asserts the
option is absent.

---

## Two layers, two opacities, and they are not the same knob

This is the single most misread thing about the feature, and the panel shows
both controls at once.

**The inner opacity** lives on `BackgroundSettings.opacity` — the overlay's
*material*. `getBuilderBackgroundStyle` applies it two different ways depending
on the mode: for **colour and gradient** it is folded into the colour itself via
`applyBuilderColorOpacity`, so the style comes out as an already-transparent
colour; for **image, video and style** modes it is not applied there at all.

**The outer opacity** is `RowOverlayScreenSettings.opacity`, a 0–100 integer
applied to the whole painted screen at the end:

```ts
// lib/builder-client/builder-template.ts:1439 — getBuilderRowOverlayScreenStyle
const style = getBuilderBackgroundStyle(normalized.background);
if (!style) return undefined;
const opacity = normalized.opacity / 100;
return Number.isFinite(opacity) && opacity < 1 ? { ...style, opacity } : style;
```

**The Overlay panel's Opacity row drives the outer one.** It is the only one
that works for every mode, which is why it is the one given a labelled row, and
it appears only once a type other than None is chosen — there is nothing for it
to act on before that.

The inner one is still reachable, and this is where the confusion comes from:
with the type set to Colour or Gradient, the colour swatch is a
`BuilderThemeColorField` carrying its own opacity control. So **both opacities
are on screen in the same group at the same time**, and they multiply. An
overlay that looks stubbornly too faint at 100% on the labelled slider usually
has a half-transparent colour inside the swatch.

Two more details worth knowing:

* The scales differ. The outer opacity is 0–100; the CSS value is that over 100.
* An outer opacity of exactly 100 adds no `opacity` property at all, rather than
  `opacity: 1`. That is intentional — it keeps the emitted style identical to
  what the pre-overlay code produced.

---

## Seeds, never owns

When a row first becomes a **video** row, `seedVideoBackgroundOverlayScreen`
(`builder-template.ts:1416`) fills in a dark neutral tint — `#101820` at 45% —
because text laid over moving footage is unreadable without something between
them. Operator's call, 2026-08-31: *"Default overlay tint ON"*.

It seeds; it does not lock:

* A row that already has an overlay configured is returned **untouched**.
* Nothing here ever *removes* a tint. Switching a row away from Video leaves the
  overlay exactly where it was.

Since #482 that seeded value is visible and editable like any other — the
operator can recolour it, restrength it, or set the type to None and switch it
off entirely. That is the change #482 actually made to his experience: the tint
was always there, and until the editor landed there was no way to touch it.

---

## The half-built state is the normal state here

This feature has now shipped in a state that round-tripped perfectly and did
nothing **twice**:

1. `normalizeRowOverlayScreenSettings` existed in `builder-template.ts` for
   months. The only code that ever *painted* an overlay lived in the frozen
   vanilla builder (`public/js/builder.js`, `buildRowOverlayScreenStyle`), so a
   React-rendered row silently had none. The setting saved, loaded, and did
   nothing.
2. The renderer was then ported (#475) — and there was still no editor. The only
   overlay obtainable was the one the code seeded for itself on video rows.

Both times every test passed, because in both cases the tests were true.

**A Builder setting has four independent parts, and any three of them passing
proves nothing about the fourth:**

| Part | Overlay's | Fails as |
|---|---|---|
| **The type** | `RowOverlayScreenSettings` | won't compile / silently coerced |
| **The normalizer** | `normalizeRowOverlayScreenSettings` | value lost on load or save |
| **The renderer** | `getBuilderRowOverlayScreenStyle` | saves fine, never appears |
| **The editor** | the Overlay group in `builder-section-controls.tsx` | real, correct, unreachable |

The two failures above are both the bottom-right cell, and it is the quietest
one: the data is right, the render is right, and the operator simply has no way
in. When adding anything to this family, name all four parts and say which of
them the change touches.

---

## The trap every queued overlay slice will hit

**Adding a background mode means THREE dropdowns.** This is
`docs/VIDEO_BACKGROUNDS.md` trap 3, repeated here rather than cross-referenced
because every remaining overlay slice touches the same picker. Stated precisely,
because the three are not three copies of one thing:

1. `builder-background-controls.tsx:512` — the shared picker's **horizontal**
   layout mode row.
2. `builder-background-controls.tsx:665` — the shared picker's **vertical**
   layout mode row.
3. `builder-section-controls.tsx:401` — a **hand-written `<select>`** labelled
   "Row Background", in the Frame column of the section panel. This is a plain
   `<select>` with its own hardcoded `<option>` list, not an instance of the
   shared control, and **it is the one the operator actually uses** for row
   backgrounds.

The related-but-separate mechanism: the shared control is *also* mounted at the
bottom of the section panel with `hideModeRow`
(`builder-section-controls.tsx:551`), which suppresses its own mode row so it
does not render a fourth dropdown beside the hand-written one. `hideModeRow` is
what prevents a duplicate; it is not what creates the third copy.

One asymmetry to know about: the two shared mode rows gate the Video option
behind `allowVideo`, and the hand-written copy lists Video unconditionally.

The Overlay group mounts the shared control with **no** gallery callbacks. That
is deliberate — handing it the row's `onOpenSectionBackgroundGallery` would make
the image picker quietly write to the row's background instead of the overlay's.

---

## Placement is a check-coverage decision, not a layout preference

The Overlay group sits in a lattice **column**
(`.builder-schema-panel-column`) rather than in the trailing strip at the bottom
of the section panel, and the reason is mechanical:

`check_panels` measures panel columns, item managers and chrome strips, and
**nothing else**. A group placed in the trailing strip can stagger with the
check still green. That is the same class of hole `CLAUDE.md` already records
for item managers, and it is what put two visibly broken panels in front of the
operator in August 2026. In a column the group is measured like every other
group, and breaking it on purpose fails the check.

`scripts/ui/seed_fixture.mjs` seeds a real overlay on the check row (a gradient
at 45%), so the group is actually exercised rather than merely present. **A
green `check:panels` is only evidence if the fixture reaches your panel** — if
you add an overlay control, seed something that makes it render before believing
the pass.

`npm run check:render` carries `row-overlay-tint-actually-paints`
(`scripts/ui/render-contracts.mjs:1275`), which asserts
`.builder-preview-row-overlay-screen` is present and painted. The element is
rendered conditionally — no element at all when there is no overlay
(`components/builder-template-preview.tsx:1726`) — so an assertion that only
checks the element's style would pass on an absent overlay. Check the element
exists first.

---

## For the operator

**What it is for.** Three jobs, in rough order of how often they come up:

* **Readable text over a photo.** A dark overlay at 30–50% under white text.
* **Tinting.** A brand colour over a neutral photograph pulls the whole row
  toward the palette without editing the image.
* **Blending two images.** An image overlay at partial strength over an image
  background.

**Where the controls are.** Select a row → Section Settings → the **Overlay**
group.

* **Overlay Type** — None, Color, Gradient, Image, or Style. None removes it.
* **Color / Gradient** — the swatch. Its own opacity control is *inside* the
  swatch, and it stacks with the Opacity row below.
* **Opacity** — how strong the whole screen is, 0–100. Appears once a type is
  chosen.

**A video row starts with a tint already on.** That is on purpose, and it is
yours to change: recolour it, weaken it, or set the type to None to remove it.
Nothing puts it back.

**Why an overlay can't be a video.** Playing a video over a video means two
video players in one row. The option is left out rather than allowed and
warned about.

---

## See also

* `docs/VIDEO_BACKGROUNDS.md` — the video background layer, the seeded tint's
  origin story, and the full trap list.
* `docs/IMAGE_EFFECTS.md`, `docs/PROXIMITY_EFFECTS.md` — the other two
  Builder visual-effect families.
