# Image effects

**Shipped:** 2026-08-16 → 08-17 — PRs #299 (the effects render at all, Rotation
Rate, Effects column), #302 (bounce, Frequency, full-width corridor, sizing),
#303 (Bounce Height, Direction), #305 (Speed, Repeat, Start Delay).
**Applies to:** the `image` and `floating-image` module types.
**Source:** `components/builder/builder-image-effects.ts` (options + variables),
`components/builder/builder-image-preview.tsx` (the DOM),
`src/css/_builder-react-overrides.css` (the keyframes, at the end of the file).

An image module can move: bounce in place, spin in place, or cross the page.
This file is the whole model — what the settings mean, how the motion is put
together, and the four ways it has already gone wrong.

---

## The settings

Every one of them is gated: with **Effect** on *None* the Effects column is
empty, and each control appears only for the effects it can actually change.
A control that does nothing is the specific bug this feature was born from
(see "How this started" below), so nothing here is ever shown greyed out.

| Setting | Applies to | Values | Default | Means |
|---|---|---|---|---|
| **Effect** | all | None, Bounce, Fast Bounce, Big Bounce, Spin, Slide, Tumbleweed, Axis Rotate, Flips | None | What it does |
| **Direction** | Slide, Tumbleweed | Left to Right, Right to Left | Left to Right | Which way it crosses |
| **Speed** | Slide, Tumbleweed | 2s – 60s | 8s | How long ONE crossing takes |
| **Repeat** | Slide, Tumbleweed | Forever, Once | Forever | Loop, or cross once and stay gone |
| **Rotation Rate** | Spin, Tumbleweed, Axis Rotate, Flips | 5 – 120 turns/min | 25 | How fast it turns |
| **Frequency** | Tumbleweed, Flips | 1 – 16 per crossing | 4 | How many hops per crossing |
| **Bounce Height** | Tumbleweed, Flips | 10% – 500% | 50% | Hop height, as a share of the picture's own height |
| **Start Delay** | Slide, Tumbleweed | 0 – 12s | 0 | Wait before setting off |

**Slide, Axis Rotate and Flips were surfaced on 2026-08-22.** They had full
keyframes in the stylesheet and no way to pick them — the mirror image of the
bug below. Cartwheels and Parkour are still unsurfaced; Cartwheels because it
is Tumbleweed under another name.

**Cruise was retired the same day and IS Slide.** The two were one effect
under two names, with byte-for-byte identical CSS, so the operator collapsed
them: "wherever you see Cruise, consolidate it into Slide." Pages saved before
that still store `effect: "cruise"` and still animate — `RETIRED_IMAGE_EFFECTS`
in `components/builder/builder-image-effects.ts` maps the old name to the new
one at every entry point, the same way `RETIRED_MODULE_TYPES` handles a renamed
module. Nothing needs migrating; the picker simply no longer offers it.

Two of those units are deliberate and worth keeping:

- **Frequency is per CROSSING, not per second.** Change Speed and four hops
  stay four hops; only their rate changes. Per-second would have meant every
  Speed change silently re-timing the bounce.
- **Bounce Height is a share of the picture's own height.** 100% is one whole
  picture off the ground, so the arc stays in proportion when the image is
  resized. A fixed 50px hop is enormous under a 60px ball and invisible under
  a 600px banner.

`Rotation Rate` is per MINUTE for the opposite reason: Spin turns in place
forever and Tumbleweed turns while crossing, so "turns per crossing" would
mean two different speeds on the two effects. One rate reads the same on both.

### Normalization

`normalizeImageEffectSettings` in `lib/builder-client/builder-template.ts`
stamps and clamps these per type, and **deletes the keys that do not apply** —
a Spin module carries no Frequency, a still image carries none of them. Run
`npm run build:builder-template` after touching it (root `CLAUDE.md` landmine 1).

---

## How the motion is built

Three motions, three rates, and they cannot share one `transform` — the last
animation to touch a property wins and the others silently vanish. So they are
split across the independent transform properties, over two elements:

```
.starcaster-effect-motion-clip        overflow-x: clip, and the full-page corridor
  └ .starcaster-effect-hop-stage      animates `translate` (the hop)      — tumbleweed only
      └ figure.starcaster-effect-*    animates `translate` (travel) and `rotate` (spin)
```

- **travel** — `sc-effect-travel`, `-100vw` → `100vw`, duration = Speed
- **spin** — `sc-effect-turn`, one turn, duration = 60 ÷ Rotation Rate.
  Shared with the plain Spin effect, so a turn is defined once.
- **hop** — `sc-effect-hop`, up and back, duration = Speed ÷ Frequency, height
  from `--sc-effect-bounce`. Rise is `ease-out`, fall is `ease-in`; that
  pairing is the difference between a bounce and a balloon bobbing.

The renderer passes every rate in as a CSS variable
(`getImageEffectStyle` for the figure, `getImageEffectStageStyle` for the hop
stage), so one stylesheet rule serves every setting combination and there is
never a class per speed.

### The corridor is the page, not the column

`.starcaster-effect-motion-clip` breaks out of whatever column contains it:

```css
width: 100vw;
margin-left: calc(50% - 50vw);
```

`50% - 50vw` walks back from the centre of its container to the centre of the
viewport, so the corridor **corrects itself** if the padding above it ever
changes — the same self-correcting shape `.builder-preview-section-full-width`
uses. A number copied from today's theme would not.

It does **not** apply inside the editor's module card
(`:not(:has(.builder-module-preview-image))`): the card renders the same
component at thumbnail size, and a 100vw child in a settings panel is a card
that bursts its own editor.

### Reduced motion

All of it stops under `@media (prefers-reduced-motion: reduce)`. Motion here
is decoration; a visitor who has asked their system for less of it gets the
picture, standing still.

### Email

Unchanged and deliberately so — an animation has no meaning in an email
client, and the module already renders there as a still image
(`docs/MODULE_UI_DOCTRINE.md` §5.6: email render is a decision, not an
oversight).

---

## Sizing, which is not an effect but arrives with one

**Width is a share of the COLUMN, not of the picture.** This surprised the
operator and it is worth stating plainly: 25% on a full-bleed section is about
480px, whatever the file's own size is.

Two rules keep that honest:

1. **A picture never renders larger than its own file.** The frame carries
   `max-width: max-content` whenever there IS a picture, so a 400px file stops
   at 400px instead of being blown up and going soft. An empty module keeps
   its placeholder box (capping THAT would shrink the drop target to the width
   of the words "Choose an image").
2. **The width floor is 5%,** not 10%. On the operator's page 10% was 112px
   and on a full-bleed section ~190px, so a decorative graphic had no way to
   be small. `getModuleWidthPercent` clamps there, for every module type.

Practical consequence for whoever is building a page: **upload the graphic at
the size you want it**, because the file is now the ceiling.

---

## How this started, and the four traps

### 1. A class name is not a rendering

Cruise and Tumbleweed were offered in both image panels from the Normie port
onward and **no stylesheet ever defined them**. Choosing either set a class
nobody styled: the operator saw a still picture and no error, for months.

Doctrine E7 says walk editor → renderer in both directions. That was done, in
an audit of this very module on 2026-08-07, and it passed — because the
setting DID reach a renderer. The renderer just had nothing to say about it.
**When the last hop is CSS, "the setting reaches the render path" is not the
same as "something renders."**

Five effects have the opposite gap and still do: `flips`, `slide`,
`cartwheels`, `parkour`, `axis-rotate` have full keyframes in
`_builder-react.css` and appear in no panel. They are reachable only by
hand-editing a setting, which is where they already were; surfacing or
deleting them is a design question for the operator.

**Guards, in the order they would now catch it.** As of 2026-08-17 this is no
longer the only one, and the last hop is no longer unwatched:

- `npm run check:css` — in CI on every pull request. C2 fails an
  `animation-name` with no `@keyframes`; C4 fails a `starcaster-effect-*`
  class no stylesheet defines.
- `npm run check:render` — its effect sweep reads `IMAGE_EFFECT_OPTIONS` and
  requires **every offered effect to produce a live animation**. This is the
  one that would have caught Cruise and Tumbleweed on the day they shipped,
  with no foresight required.
- `builder-image-effects.test.ts` — reads `src/css/` and fails when an offered
  effect has no rule. Narrower than the two above and kept as the scar it is.

The five effects below are **reported by name** on every `check:render` run
now, rather than waiting to be noticed.

### 2. An invalid CSS value drops the whole declaration

The never-upscale cap first shipped as `max-width: min(100%, max-content)`.
Intrinsic keywords are **not allowed inside `min()`**, so the browser threw
the declaration away and the computed value was `none` — a cap that looked
right in the diff, in review, and in the source, and did nothing. Caught only
by reading `getComputedStyle` in a real browser.

If a CSS value is doing something clever, read it back from the browser.

### 3. One `animation-*` keyword applies to EVERY animation on the element

Repeat = Once could not be `animation-iteration-count: 1`: the figure runs two
animations, so that would have stopped the **spin** after a single turn and
the ball would slide the remaining seven seconds of an eight-second crossing
without turning. Each animation is counted separately —

```css
animation-iteration-count: var(--sc-effect-travel-iterations, infinite),
                           var(--sc-effect-turn-iterations, infinite);
```

— and the renderer works out how many turns fit inside one crossing. The hop
is easier: hops per crossing IS the Frequency.

Direction goes the other way and uses the same fact deliberately: one
`animation-direction: reverse` turns the travel **and** the spin around
together, which is correct — a ball crossing right to left rolls
anticlockwise. Reversing the travel alone would have it sliding backwards.

### 4. The panel checker only measures what the fixture contains

`check:panels` reported green on this module for months while its editor was
five separate hand-rolled mini-layouts stacked above its axis columns. The
module WAS seeded — straight out of `createEmptyModule`, so with no picture,
no link and no effect, rendering about half its controls. An empty module
measures almost nothing and passes.

`scripts/ui/seed_fixture.mjs` now gives it real content and a rotating,
bouncing, travelling effect, so every gated field is on screen and measured.
Both times a control was added here, the check was proved by **staggering a
label on purpose and watching it fail** before the pass was believed.

---

## Adding another effect setting

1. Options list, default, and normalizer in `builder-image-effects.ts`.
2. Emit it as a CSS variable from `getImageEffectStyle` (figure) or
   `getImageEffectStageStyle` (hop stage).
3. Read the variable in `_builder-react-overrides.css` — **never**
   `_builder-react.css`, which is regenerated wholesale (R2).
4. Add the field to BOTH panels (`builder-image-module-settings.tsx` and
   `builder-floating-image-module-settings.tsx`), gated by `visibleWhen`.
5. Clamp it in `normalizeImageEffectSettings`, delete it for the types it does
   not apply to, then `npm run build:builder-template`.
6. Seed it in `scripts/ui/seed_fixture.mjs` — a `visibleWhen` field that the
   fixture never triggers is a field `check:panels` cannot see.
7. Extend `builder-image-effects.test.ts`, and if the setting has a fallback
   in the stylesheet, assert the two copies match. Two copies of one default
   is how a panel comes to disagree with the page.
8. **Add it to the differential registry** in
   `scripts/ui/render-contracts.mjs` (`RENDER_DIFFERENTIALS`) — a
   `{setting, from, to}` triple whose two values must render differently.
   Without that line, nothing proves the new control does anything at all.
   A whole new *effect* needs no entry: the sweep reads
   `IMAGE_EFFECT_OPTIONS` and already requires every offered effect to
   produce a live animation.
9. Run `npm run check:panels` for the editor, then
   `npm run check:render` for the page (`PORT=3058 node server.js` first),
   and break each on purpose to watch it fail before believing the pass.

`npm run check:css` runs in CI on every pull request and will catch the two
mistakes this feature has already made in the stylesheet: a value the browser
throws away, and an `animation-name` with no `@keyframes` behind it.

**What none of them can tell you is whether it looks right.** The
differential proves a setting changed something, never that it changed
correctly — it cannot tell a bounce from a wobble (`docs/DOCTRINE.md` §5.14).

**The Effects column holds eight controls and the panel generator caps a
module at four axes.** One or two more settings fit; past that the question is
which of these belong together, not what else to add.
