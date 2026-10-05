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

- **Backing size = CSS size × devicePixelRatio**, capped by the device budget
  (2×, 1.5× under 768px, 1× on a low-power device or data saver — see
  Performance), with `ctx.scale` so all drawing stays in CSS pixels. A
  `ResizeObserver` on the container and the canvas, plus window `resize`,
  re-measures; the field is regenerated only when the star budget
  (`scaleGalaxyCount`) actually changes.
- **A settings change regenerates the field without remounting.** The effect
  that runs the loop is keyed on the settings' value; its cleanup cancels the
  frame loop and the next run regenerates. The canvas element survives, and so
  does the frame counter, which lives in a ref.
- **Frame delta clamped to 50 ms**, so a stall never makes the galaxy jump.
- **Pauses** on `visibilitychange` → hidden and on window `blur`; resumes on
  the opposite. **And when nobody can see it** (Performance, below):
  `data-galaxy-paused` says which.
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
  "Showing N of M stars on this device (small screen)" in the Builder only,
  through `BuilderOnlyNote`; nothing on a published page. The bracket is the
  budget's reason, also published as `data-galaxy-budget`.

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
| `flareSize` | Flare Size | 41 | How far the four-point streak reaches; hidden with Flare Stars at 0 |
| `flareIntensity` | Flare Intensity | 28 | How bright the streak is; 40 and above saturate |
| `seed` | — | 27 | Not offered in the panel; fixes the layout so every load is the same galaxy |
| `intro` | Structure › Intro | converge | `converge` / `none` — see *Intro and scroll* |
| `introDelay` | Intro Delay | 1 | Seconds, 0–5; shown only with Intro on Converge |
| `introDuration` | Intro Length | 5 | Seconds, 1–10; shown only with Intro on Converge |
| `scrollDisperse` | Scroll Away | true | Checkbox |
| `scrollDistance` | Scroll Distance | 800 | Pixels, 200–2000; shown only with Scroll Away on |

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

## Intro and scroll (task 86bc7f5hj)

The galaxy's entrance and exit. Five settings on the Structure axis, after
Twinkle and before Interaction (the table above).

**Every star has a scatter offset.** `generateGalaxyField` gives each star a
point 2 to 4 field radii away from where it belongs, in a random direction
mostly in the disc's plane — from a random source of its OWN, seeded from the
field's seed, so no star of the layout slices 1 to 3 shipped moved (a test
pins five of them against values read off `main` before this slice). It is an
offset, not a position, so a star that has turned or streamed since still
flies in to where it is now.

**One number per moment, a wave per star.** The runtime works out a
`GalaxyMix` — `converge` (0 = everything scattered, 1 = everything home) and
`disperse` (0 = home, 1 = scattered and faded) — and `projectGalaxyField`
draws each star `galaxyStarPlacement(converge, disperse, radius)` of the way
home. A star's turn in the wave is its radius: the core sets off at converge
0, the rim at `GALAXY_INTRO_STAGGER` (0.5), and each takes the remaining half
of the timeline to arrive, eased with smoothstep. So the centre settles first
and the arm tips last. Dispersing is the same wave run backwards — the tips
leave first — multiplied in, so scrolling away mid-intro never jumps. The
card passes no mix and is always the assembled galaxy.

**The intro.** From the moment the galaxy mounts: wait Intro Delay, then
converge runs in a straight line from 0 to 1 over Intro Length
(`galaxyIntroProgress`; linear because each star eases itself). The start time
lives in a ref, so dragging a slider in the Builder does not fly every star
back out. A `galaxy:replay` event on the document (`GALAXY_REPLAY_EVENT`)
restarts it on every galaxy that hears it, and draws the scattered frame at
once rather than on the next frame.

**The scroll.** One passive `scroll` listener marks the position dirty; the
frame loop measures once per frame however many events arrived.
`galaxyScrollDisperse` maps it to 0..1:

- **In Place** — how far the block's top has gone above the top of the
  window, over Scroll Distance **or the block's own height, whichever is
  smaller**. The cap is deliberate: the acceptance criterion is that the
  galaxy has faded to nothing *before it leaves the window*, and a 480px block
  under the default 800px would otherwise leave 40% visible. Measured: a 400px
  block reads 0.67 with 130px of it still on screen and 1.00 as its bottom
  edge reaches the top.
- **Window** — the page's own scroll from the top, over Scroll Distance.

The fade (`galaxyDisperseOpacity`, 1 − disperse) scales the Opacity setting
and the haze strength for the frame; the black backdrop stays.

**Replay intro** is a button under the galaxy in the Builder, inside
`BuilderOnlyNote`, so a published page never renders it. Shown only when
Intro is Converge. It is the confetti module's Test Burst pattern.

**Reduced motion:** converge is fixed at 1 and disperse at 0; no timeline, no
scroll listener, no replay listener. The one still frame is the assembled
galaxy.

Published on the canvas, two decimals, written only when they change:
`data-galaxy-converge` and `data-galaxy-disperse`.

## Look (task 86bc7f5hm)

Everything here lives in `lib/builder-client/galaxy-render.ts`, and one frame
is painted in this order by `drawGalaxyFrame`:

1. **Backdrop and haze.** Black, then one radial fill of `haze` at
   `hazeStrength` over the whole canvas.
2. **Core glow.** One radial gradient at the centre, drawn with `"lighter"`
   before any star. Its radius is the engine's core radius (Core Size) × 2.6
   field radii, never below 0.05; its peak opacity is 0.85 × Core Stars ×
   Opacity. The colour is slot 1 warmed a third of the way toward slot 5, so
   the core reads warm white as in the reference. It is multiplied by the
   intro's converge, so the centre lights up as the stars arrive instead of
   glowing alone in an empty sky.
3. **Stars.** One pre-built sprite per colour × size class (never one per
   star), blended with `"lighter"`. Brightness is
   `base × (1 − twinkle × 0.5 × (1 + sin(phase)))` — Twinkle 0 is a still sky,
   Twinkle 100 lets a star go dark for an instant (`galaxyTwinkle`).
4. **Flare streaks.** The first `flareStars` stars carry, just under their
   round sprite, two thin streak sprites — one horizontal, one vertical. Each
   is a gaussian across (σ 0.7 CSS px, so it stays a hairline at any size) and
   a power curve along, steep near the star and long in the tail, which reads
   as a diffraction spike rather than a plus sign. Painted once per settings
   change through ImageData; `drawImage` stretches each along its length
   only. Reach is 0.085 field radii at Flare Size 41 and scales linearly with
   it; peak opacity is Flare Intensity × 2.5, capped at 1. Flare stars twinkle
   at half the rate of everyone else (`GALAXY_FLARE_TWINKLE_RATE`), so they
   read as steady beacons. A context that cannot make ImageData leaves them as
   round stars.

**Colour shares are exact.** `assignGalaxyColours` bins each star index into a
slot by the Share weights, seeded; a test bins 10,000 stars and holds every
slot within ±2% of its weight.

### Presets

Choosing one writes every key below into the module's settings; nothing reads
a preset's name at render. Moving any of these sliders afterwards shows
**Custom**. Every preset writes every key any other preset writes, so
switching never leaves a value behind (a test holds that).

| | Astra (reference) | Classic | Nebula | Subtle |
|---|---|---|---|---|
| Stars | 4000 | 5000 | 3000 | 1500 |
| Arms / turns | 2 / 2.35 | 3 / 1.6 | 2 / 2 | 2 / 2.35 |
| Arm width | 40 | 35 | 75 | 45 |
| Core size / stars | 12 / 66 | 14 / 70 | 16 / 55 | 10 / 45 |
| Flare stars / size / intensity | 7 / 41 / 28 | 5 / 36 / 24 | 6 / 48 / 30 | 3 / 30 / 16 |
| Star size | 2 | 1.8 | 2.4 | 1.6 |
| Spin / inner / flow | 10 / 50 / 30 | 8 / 40 / 25 | 6 / 50 / 25 | 4 / 30 / 15 |
| Twinkle | 60 | 45 | 70 | 30 |
| Colours (share) | #F5F6FB 52, #6DCBF4 15, #7AB1FE 18, #F87915 7, #FA994C 8 | #FFFFFF 60, #CFE3FF 40 | #B388FF 45, #7AB1FE 30, #F5F6FB 25 | as Astra |
| Haze / strength | #23435F 55 | none (0) | #1B1040 90 | #23435F 30 |
| Glow / opacity | 70 / 100 | 60 / 100 | 85 / 100 | 40 / 60 |

### Browser checks for the look

Two differentials in `scripts/ui/render-contracts.mjs` read the canvas's own
pixels (`series.luma`: the mean Rec. 709 luminance 0–255 of EVERY pixel of the
canvas at full resolution), because neither setting changes any attribute or
style. Measured when they were written, under reduced motion so each canvas is
one still, assembled frame:

| Contract | Low | High |
|---|---|---|
| `galaxy-glow-brightens-the-canvas` (Glow 0 vs 100) | 3.71 | 8.37 |
| `galaxy-flare-stars-brighten-the-canvas` (Flare Stars 0 vs 7) | FLARE_NONE | 6.43 |
| … and its streak pair (7 flare stars, Flare Size 100, Intensity 0 vs 100) | 6.424 | 6.487 |

**The streak pair is the half that matters, and it exists because the first
version could not fail.** Break-tested by deleting the streaks from the engine,
Flare Stars 0 against 7 still passed: moving seven stars into the bright
flare class changes the reading on its own. The pair holds everything but the
streak's strength fixed — same seed, same still frame — so its difference is
the streaks and nothing else, and the contract asks for at least 0.02.

**It reads every pixel, not a 64×64 shrink, for the same reason.** The first
reader drew the canvas into 64×64 and averaged that; a downscale samples a few
source pixels per cell and skipped the hairline streaks almost entirely (seven
of them measured +0.001). At the defaults a streak on a 300px card reaches
about 11px, and seven of them move the full-resolution mean by about 0.009 —
real, but too close to nothing to assert on, which is why the pair runs the
streaks at full size and strength.

## Performance (task 86bc7f5hp)

The galaxy draws less where it must, automatically. There is no setting for
any of this on purpose: a setting the operator has to know about is a setting
left at "everything" on a phone.

**It stops drawing when nobody can see it.**

- **In Place:** an `IntersectionObserver` on the block. Under 5% on screen
  (`GALAXY_VISIBLE_FRACTION`) the frame loop stops; back in view it resumes.
- **Window:** the canvas is fixed over the viewport, so it is always
  "intersecting" and an observer would never fire. It stops instead on the
  frame the scroll disperses it to nothing (opacity 0), and the scroll listener
  restarts it when the page scrolls back. With Scroll Disperse off, a Window
  backdrop is visible at every scroll position and never pauses for scrolling.
  *The ticket asked for the page's first section to be observed instead; that
  would freeze a still-visible backdrop the moment the first section scrolled
  past, so it was corrected on the ticket before building.*
- `start()` refuses while paused, so a refocused window or a replayed intro
  cannot restart frames nobody sees. The canvas carries
  `data-galaxy-paused="true"` / `"false"`.

**It draws fewer stars on weaker screens.** `scaleGalaxyCount(requested,
{ areaPx, viewportWidth, tier, inline })` returns the count, the pixel-ratio
cap and the reason, from three cuts multiplied together:

| Cut | When | Count | Pixel ratio cap | Note reads |
|---|---|---|---|---|
| Device | data saver on | × 0.5 | 1 | "data saver" |
| Device | under 4 cores, or under 4 GB reported | × 0.5 | 1 | "low-power device" |
| Viewport | narrower than 768px | × 0.6 | 1.5 | "small screen" |
| Area | box smaller than 1440 × 900 | × √(area ÷ 1440·900) | — | "small module" In Place, "small screen" in a Window |

Never more than asked, never under 100 unless fewer were asked. The note names
the first cut that applied, device before viewport before area. Safari hides
`deviceMemory` everywhere, so an iPhone is judged on its cores and caught by
its narrow screen, not by a guess at its chip.

**Measured** 2026-10-04 on the **Mac mini** (the build machine; the ticket
named Dane's MacBook, which this pass could not reach), headed Chromium, 10 s
per row, defaults with Intro None. The phone rows are **Chrome's iPhone 14
emulation (390 × 844, 3× screen) with a 4× CPU throttle — no real phone was
at hand.** CPU is Chrome's `TaskDuration` over wall time: the page's main
thread as a share of one core (canvas rasterising happens in the GPU process
and is not in this number).

| Scenario | Stars drawn | fps | CPU (main thread) | Paused |
|---|---|---|---|---|
| Desktop 1440×900, Window backdrop | 4000 | 59.9 | 16.1% | false |
| Desktop, Window backdrop scrolled away | 4000 | 0 | 0% | true |
| Desktop, In Place 600px | 3266 (small module) | 60.1 | 15.3% | false |
| Desktop, In Place scrolled out of view | 3266 (small module) | 0 | 0% | true |
| Phone (emulated, 4× throttle), Window | 1210 (small screen) | 60 | 4.4% | false |
| Phone (emulated, 4× throttle), In Place | 993 (small screen) | 60 | 4.0% | false |

Re-taken the same day (3:47 PM Mountain) on **Dane's MacBook Pro**, the
machine the ticket named, by the fast-track review pass with the same script.
Its screen refreshes at 120 Hz, so a frame loop that keeps up reads 120 fps,
and the CPU share is roughly double the Mini's because it draws twice the
frames. The phone rows are the same emulation with a 4× CPU throttle.

| Scenario | Stars drawn | fps | CPU (main thread) | Paused |
|---|---|---|---|---|
| Desktop 1440×900, Window backdrop | 4000 | 120 | 40.8% | false |
| Desktop, Window backdrop scrolled away | 4000 | 0 | 0% | true |
| Desktop, In Place 600px | 3249 (small module) | 120 | 32.5% | false |
| Desktop, In Place scrolled out of view | 3249 (small module) | 0 | 0% | true |
| Phone (emulated, 4× throttle), Window | 1210 (small screen) | 120 | 51.7% | false |
| Phone (emulated, 4× throttle), In Place | 993 (small screen) | 119.9 | 44.5% | false |

Targets were 60 fps desktop and at least 30 fps phone; both met, so the count
scaling was not tightened. Re-take it with:

```
PORT=3061 node server.js
UI_HARNESS_BASE_URL=http://localhost:3061 node scripts/ui/measure_galaxy.mjs
```

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
4. **Never put `data-galaxy-frame`, `data-galaxy-count`, `data-galaxy-paused`
   or `data-galaxy-budget` in JSX.** They are
   written imperatively. In JSX, every React re-render (the shortfall note
   setting state, for one) would reset them to the literal.
5. **Presets are values, not a mode.** Nothing reads a preset name at render.

## The browser checks

`scripts/ui/render-contracts.mjs`, sixteen contracts named `galaxy-*`, read
through the series reader's `attrs` (added for this module — a canvas's pixels
are invisible to computed style), plus the two `luma` differentials above:

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

- `galaxy-intro-converges` — after a replay at a 1.2 s Intro Length,
  `data-galaxy-converge` starts below 0.3, never falls, and passes 0.9 within
  1.5 s;
- `galaxy-intro-skipped-under-reduced-motion` — the same replay under reduced
  motion reads 1.00 throughout;
- `galaxy-intro-none-starts-assembled` — Intro None reads 1.00;
- `galaxy-replay-button-in-the-builder` — the button renders, reading
  "Replay intro";
- `galaxy-replay-button-never-on-a-live-site` — absence, on the page rendered
  as a published page, paired with the one above.

- `galaxy-pauses-out-of-view` — an In Place block scrolled fully away reads
  `data-galaxy-paused="true"` within 500 ms with a frame counter that has
  stopped, and resumes counting when scrolled back. Uses the series'
  `scrollTo` (added in slice 6): one absolute scroll position per sample,
  because `scrollBy` can only go one way;
- `galaxy-draws-fewer-stars-on-a-phone` — at 390 × 844 a Window galaxy asked
  for 4,000 carries at most 60% of what the same area gets on a wide screen,
  and names a reason. Compared against the area cut, not against 4,000: the
  area cut alone already lowers a phone's count, so "fewer than asked" passed
  with the viewport rule deleted.

The arrow-key two use the harness's `press: { selector, key }` (added for this
module): it focuses the element, refuses if focus did not land, and presses
the key before the sample is taken. The intro ones use `dispatch` (added in
slice 4): a document event fired after the settle and immediately before the
series — after, because the intro would otherwise be 600 ms gone before the
first reading. The live-site one uses `emulate: { liveSite: true }`, which
loads `builder-preview.html?live=1` — the preview rendered with `liveSite`,
exactly as `BuilderPublicSitePage` renders a published page.

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
