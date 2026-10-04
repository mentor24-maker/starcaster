# Galaxy module

An animated spiral galaxy drawn on a Canvas 2D element: a field of stars that
slowly turns, streams inward along its arms and twinkles. Filed under
**Special Effects** in the Module Library. Six slices (plan:
`~/Desktop/Galaxy-module-plan.md` on Dane's MacBook):

| Slice | Task | What it adds |
|---|---|---|
| 1/6 | 86bc7f5hf | The star-field engine — `lib/builder-client/galaxy-field.ts`, pure arithmetic |
| 2/6 | 86bc7f5hg | **This doc's subject:** the module itself — card, page runtime, panel, contracts |
| 3/6 | 86bc7f5hh | Drag, arrow keys and cursor tilt rotate the galaxy |
| 4/6 | 86bc7f5hj | The intro: stars converge on load and disperse on scroll |
| 5/6 | 86bc7f5hm | Flare-star streaks, core glow, presets tuned against the reference picture |
| 6/6 | 86bc7f5hp | Stays smooth on phones; stops drawing when nobody can see it |

## The model — three files, three jobs

| File | Job | Has a DOM? |
|---|---|---|
| `lib/builder-client/galaxy-field.ts` | Where every star is and how it moves: seeded layout, spin, inward flow, twinkle phase, 3D projection, device budget | No |
| `lib/builder-client/galaxy-render.ts` | What a star looks like: the look settings, presets, glow sprites, and `drawGalaxyFrame` — the ONE function that paints a frame | Only a canvas context it is handed |
| `components/builder-galaxy-module.tsx` | When frames are drawn: `GalaxyCardPreview` (one still) and `GalaxyRuntime` (the loop), canvas sizing, placement, reduced motion, the poster | Yes |

The panel is `components/builder/builder-galaxy-module-settings.tsx`, a
`BuilderSettingsSchema` on the four D8 axes.

**One painter.** The card and the page both draw through `drawGalaxyFrame`,
and `components/builder-galaxy-module.test.tsx` reads the component file to
hold that — no `drawImage`, `arc`, `fillRect` or gradient anywhere in it.
TractorNav is why: its card and its page had separate drawing code and
disagreed on live tenant sites for two months while the card looked right
(`docs/PROXIMITY_EFFECTS.md`).

**Glow is pre-drawn.** Each of the five colours × eight size classes gets one
small offscreen canvas with a soft star painted on it once; a frame is
`drawImage` calls blended with `globalCompositeOperation = "lighter"`, so
overlapping halos add up like light. A gradient per star per frame would be
thousands of gradient objects sixty times a second.

## What the page runtime does

- **Backing size = CSS size × devicePixelRatio**, capped at 2 (1.5 when the
  window is narrower than 768px), with `ctx.scale` so all drawing stays in CSS
  pixels. A `ResizeObserver` on the container and the canvas, plus window
  `resize`, re-measures; the field is regenerated only when the star budget
  (`scaleGalaxyCount`) actually changes.
- **A settings change regenerates the field without remounting.** The effect
  that runs the loop is keyed on the settings' value; its cleanup cancels the
  frame loop and the next run regenerates. The canvas element survives, and so
  does the frame counter, which lives in a ref.
- **Frame delta clamped to 50 ms**, so a stall never makes the galaxy jump.
- **Pauses** on `visibilitychange` → hidden and on window `blur`; resumes on
  the opposite.
- **Reduced motion** (`prefers-reduced-motion: reduce`, listened for, so
  switching it on mid-visit applies at once) draws exactly ONE frame and
  starts no loop.
- **Poster:** when `posterUrl` is set and motion is reduced or the canvas has
  no 2D context, an `<img>` of the poster renders in the canvas's place.
- **Two facts published on the canvas** for the browser checks:
  `data-galaxy-count` (stars actually generated, after the device budget) and
  `data-galaxy-frame` (a counter, +1 per drawn frame). The canvas is
  `aria-hidden="true"`: it is decoration.
- **Fewer stars than asked** (the device budget cut the count) shows
  "Showing N of M stars on this device" in the Builder only, through
  `BuilderOnlyNote`; nothing on a published page.

### Placement

Reuses `lib/builder-client/effect-placement.ts` exactly as TractorNav does.

- **Window Center** (default): the canvas is `position: fixed`, full viewport,
  at the Z-Index setting (default -9999, behind the page). The module takes no
  room in its column.
- **In Place**: a block as tall as **Height**, the full width of its cell, in
  the flow, scrolling with the page. A negative Z-Index is lifted to 0 so the
  galaxy is not hidden behind its own cell.

Position X / Y nudge the galaxy's centre in pixels; positive Y moves it up.

## Settings

Engine numbers are clamped by `readGalaxySettings` (ranges in
`GALAXY_SETTING_RANGES`); look numbers by `readGalaxyLook`.

| Key | Panel | Default | Notes |
|---|---|---|---|
| `posterUrl` | Content › Poster | (empty) | Shown instead of the canvas under reduced motion or with no canvas |
| *(preset)* | Structure › Preset | Astra | Not stored. Writes the values below; shows Custom when they no longer match a preset |
| `particleCount` | Star Count | 4000 | 500–8000; scaled down by area and device tier |
| `arms` | Arms | 2 | 1–6 |
| `turns` | Turns | 2.35 | 0.5–4, counted over the visible arm band |
| `armWidth` | Arm Width | 40 | |
| `coreSize` | Core Size | 12 | Moving it re-twists the spiral (slice 1 decision) |
| `coreStrength` | Core Stars | 66 | |
| `flareStars` | Flare Stars | 7 | 0–12 |
| `starSize` | Star Size | 2 | CSS-pixel radius of a typical star |
| `spinSpeed` | Spin Speed | 10 | 100 = one turn per 10 s |
| `spinDirection` | Direction | clockwise | |
| `differential` | Inner Speed | 50 | Along-arm streaming in proportion to the spin |
| `flowSpeed` | Flow | 30 | Along-arm streaming of its own |
| `twinkle` | Twinkle | 60 | |
| `placement` | Placement › Sits | window | `window` / `inline` |
| `height` | Height | 480 | In Place only; hidden otherwise |
| `posX`, `posY` | Position X / Y | 0 | |
| `zIndex` | Z-Index | -9999 | |
| `c1`..`c5` | Frame › Colour 1–5 | reference palette | Theme-colour controls: emptied = the reference colour for that slot |
| `w1`..`w5` | Share 1–5 | 52 15 18 7 8 | How many stars wear each colour |
| `haze` | Haze | #23435F | Emptied = the reference haze |
| `hazeStrength` | Haze Strength | 55 | |
| `glow` | Glow | 70 | How far each star's halo reaches |
| `opacity` | Opacity | 100 | |
| `seed` | — | 27 | Not offered in the panel; fixes the layout so every load is the same galaxy |

The normalizer (`normalizeBuilderModuleSettingsForType`) fills every number
above on load, and deliberately **not** `c1`..`c5`, `haze` or `posterUrl` —
their absence means something (DOCTRINE §5.27), and a backfill would undo a
colour reset on the next reload. A test holds both halves.

Galaxy is skipped in email (`builder-email-render.ts`: an email client draws
no canvas and runs no script) and never indexed by site search.

## Interaction (task 86bc7f5hh)

One setting, **Interaction**, on the Structure axis after the motion group.
What it offers depends on **Sits**:

| Sits | Choices | Default |
|---|---|---|
| In Place | Drag to Rotate, None | Drag to Rotate |
| Window Center | Tilt with Cursor, None | Tilt with Cursor |

A stored value the placement does not offer (Drag to Rotate left on a galaxy
somebody then moved to Window) runs as that placement's default, and the
normalizer rewrites the key to match — it never deletes it.
`resolveGalaxyInteraction` in `galaxy-field.ts` is the one rule; the panel's
select, the runtime and the normalizer all give the same answer.

**Why drag is In Place only.** A Window galaxy is `position: fixed` at
z-index -9999, behind the whole page, so it can never receive a pointer
(TractorNav trap 3). A button lifted above the page to fix that would swallow
every click on every link. So the Window galaxy reads the cursor from the
document instead, and only In Place gets something to press.

**Drag to Rotate.** A real `<button type="button" class="galaxy-drag-surface">`
covers the canvas, labelled *"Drag or use the arrow keys to rotate the
galaxy"*, focusable, with a visible focus ring.

- Drag: yaw += dx × **0.005** rad/px, pitch += dy × 0.005, pitch clamped to
  **±1.2** so the disc cannot flip onto its back. The pointer is captured on
  press, so releasing outside the canvas still ends the drag; it is also
  ended on pointer cancel and window blur.
- Arrow keys: **0.08** rad per press (Left/Right turn, Up/Down tip), with
  `preventDefault` so the page does not scroll while the button has focus.
  Every other key keeps its normal meaning.
- `touch-action: pan-y` on the button: a vertical swipe on a phone scrolls
  the page; a horizontal one turns the galaxy.

**Tilt with Cursor.** One passive `mousemove` on the document, coalesced so
only the newest position is applied, once per frame. The cursor's place in
the viewport maps to yaw **±0.25** (0.5 rad from the left edge to the right)
and pitch **±0.15**.

**Easing.** Both set a target; the frame loop eases toward it with damping
**6** through `easeToward`, which closes the gap by e^(-6·dt) per frame —
the reference's "(target − current) × 6 × dt" to first order, but it cannot
overshoot however long a frame was, and lands within 1% in about 0.77 s.

**What adds no listener at all:** Interaction set to None, and reduced
motion. Under reduced motion the button still renders (the page reads the
same to a keyboard or screen reader) but pressing it does nothing, because a
still galaxy has no loop to ease anything.

The angle a frame was drawn at is published on the canvas as
`data-galaxy-yaw` and `data-galaxy-pitch` (three decimals, written only when
they change), for the browser checks and a console readout.

## The rules

1. **Nothing paints a star except `drawGalaxyFrame`.**
2. **A star's colour belongs to its INDEX, not to `field.colour`.** The engine
   re-stamps `field.colour` from the reference weights whenever a star streams
   in and is re-seeded at the rim, so honouring the panel's Share weights
   through it would drift back to the reference mix within a minute.
   `assignGalaxyColours` gives each index a slot once, seeded; re-seeding keeps
   the index, so it keeps the colour.
3. **The frame counter survives a settings change.** It is the evidence that a
   slider redraws without a remount; resetting it would hide a remount.
4. **Never put `data-galaxy-frame` or `data-galaxy-count` in JSX.** They are
   written imperatively. In JSX, every React re-render (the shortfall note
   setting state, for one) would reset them to the literal.
5. **Presets are values, not a mode.** Nothing reads a preset name at render.

## The browser checks

`scripts/ui/render-contracts.mjs`, nine contracts named `galaxy-*`, read
through the series reader's `attrs` (added for this module — a canvas's pixels
are invisible to computed style):

- `galaxy-draws-a-canvas` — the canvas has a box and stars;
- `galaxy-keeps-drawing-frames` — the frame counter rises on every one of five
  samples over 500 ms;
- `galaxy-draws-one-frame-under-reduced-motion` — under reduced motion it is
  ≥ 1 and flat;
- `galaxy-star-count-reaches-the-canvas` — 1,000 and 3,000 stars generate
  different counts;
- `galaxy-shows-its-poster-under-reduced-motion` — the poster `<img>` renders
  and no canvas beside it.
- `galaxy-in-place-rotate-has-a-labelled-drag-surface` — the button renders,
  labelled, `type="button"`, covering the canvas;
- `galaxy-window-tilt-has-no-drag-surface` — absence, paired with the one
  above;
- `galaxy-arrow-key-turns-it` — one real ArrowLeft carries `data-galaxy-yaw`
  toward -0.08;
- `galaxy-reduced-motion-keeps-the-button-but-does-not-animate` — under
  reduced motion the button still takes focus, and the frame counter is flat
  for 300 ms after an ArrowLeft.

The last two use the harness's `press: { selector, key }` (added for this
module): it focuses the element, refuses if focus did not land, and presses
the key before the sample is taken.

`scripts/ui/seed_fixture.mjs` seeds two galaxies for `check:panels`, one
Window and one In Place, because Height is only visible In Place.

## Traps found while building it

- **The harness's zero-box guard masks behaviour contracts.** A canvas with no
  width fails every galaxy contract with the same "occupies no space" line, so
  breaking two things at once to save a run showed only one of them. Break one
  thing per run.
- **`:nth-child(n of S)`** is how the star-count contract tells two identical
  modules apart, because the rendered DOM carries no module id.
- **A context method EXISTING is not that method WORKING.** jsdom — and any
  degraded or stubbed 2D context — exposes `createRadialGradient` and returns
  `undefined` from it, so a `typeof ctx.createRadialGradient === "function"`
  guard passes and the very next `.addColorStop` throws. Inside the runtime's
  effect, a throw unmounts the React tree the module sits in, which on a
  published tenant page is a blank screen for a visitor — not a missing
  galaxy. Every gradient here therefore comes through
  `galaxyRadialGradient()`, which checks the RETURNED value and catches, and
  both callers treat null as "paint without it": no sprites, or a frame with
  no haze. This is what `check_live_placeholders.cjs` caught, reported as
  three failing modules.
- **Start the loop through `start()`, never a bare `requestAnimationFrame`.**
  `start()` is where the reduced-motion and hidden-tab guards live, so a
  direct call silently bypasses both and animates for a visitor who asked for
  less motion. The reduced-motion contract is the only thing that sees it —
  nothing in vitest does, because the loop needs a real browser clock.
