# Video backgrounds

A fifth background mode, after None / Color / Gradient / Image and before
Style. Built 2026-08-30 to 08-31 across five pull requests (#474, #475, #476,
#477, #478) and offered today on **section rows only** — the page background
(86bbqa7a5) and cells (86bbqa7a8) are specced and unbuilt.

Read this before changing anything in
`components/builder/builder-background-layer.tsx`, the video branch of
`getBuilderBackgroundStyle`, or the Video panel in
`builder-background-controls.tsx`.

**That first file is no longer video-only, and neither is this document.** It
was `builder-video-background-layer.tsx` until parallax shipped on 2026-08-31
(86bbqazxv); it now carries every image background that drifts as well. See
"The layer is shared with image backgrounds now", below.

---

## The one idea that makes the rest work

**`getBuilderBackgroundStyle` returns CSS, and a video is not CSS.**

Every other mode is a property on the section: a colour, a gradient, a
`background-image`. A video is an *element* that has to sit behind the
section's content. That difference is why the mode could not simply be added
to the existing function — and it is also why adding it broke nothing.

Mode `"video"` reports its **poster** as an ordinary CSS background image,
cropped to the same focal point the video layer uses:

```ts
if (background.mode === "video") {
  if (!background.posterUrl) return undefined;   // never url("")
  return {
    backgroundImage: `url("${backgroundImageUrlFor(background.posterUrl)}")`,
    backgroundSize: "cover",
    backgroundPosition: builderVideoBackgroundPosition(background)
  };
}
```

So every surface that *cannot* play a video — button backgrounds, email,
module cards, saved-cell thumbnails, the frozen vanilla builder in
`public/js/` — reaches that branch and paints the still. **Not one caller of
that function had to learn the new mode exists.** The feature shipped its
data model (#474) as a completely invisible change for exactly this reason,
and the two later slices had a safety net already in place.

The same fact drives the fallbacks. When the layer decides not to play —
reduced motion, phone width, a refused autoplay — it renders **nothing at
all**, and the poster the surrounding surface already painted is simply what
remains. "Show the still instead" is not a second code path that could drift;
it is the absence of the first one.

---

## What it is made of

| Setting | Meaning |
|---|---|
| `videoUrl` / `videoAssetId` | the clip, from the asset gallery |
| `posterUrl` / `posterAssetId` | the still frame — see below, it is load-bearing |
| `videoSpeed` | playback rate, 0.25–2 |
| `videoLoop` | default true |
| `videoLoopFade` | seconds of crossfade at the loop seam, 0–5, default 0.6 |
| `videoTrimStart` / `videoTrimEnd` | seconds; an end of 0 means "to the end of the clip" |
| `videoBlur` | pixels, 0–20 |
| `videoPlayOnMobile` | default false |
| `videoFocalX` / `videoFocalY` | percent, which part of the frame survives the crop |

**The poster is not decoration.** It is what shows before the clip loads, on a
slow connection, in email, in the builder canvas, under reduced motion, and on
every phone by default. A video background with no poster is a section that is
blank for most of its audience, which is why the panel warns about it.

---

## Three behaviours that are deliberately NOT settings

Each of these was considered as a control and rejected. Do not add them.

1. **Pause when scrolled off screen.** Nobody would turn it off, and decoding
   video nobody is looking at costs battery — twice over, once the clip is
   running as a crossfading pair.
2. **Sound.** Browsers refuse to autoplay a video with sound. A "sound on"
   checkbox would be a setting that silently does nothing, which is worse than
   its absence.
3. **Reverse / ping-pong.** Browsers ignore a negative playback rate. Doing it
   properly means generating a reversed copy of the file at upload time, which
   is a video-processing step this platform does not have. Raised by the
   operator and explicitly dropped, 2026-08-30.

And two that ARE settings, with defaults chosen against the common case:

- **Reduced motion** is honoured always, not optionally. It is a setting people
  turn on for migraines and motion sickness, and a full-bleed looping video is
  the loudest thing a page can do.
- **Phones show the poster** unless `videoPlayOnMobile` is on. A background
  video is megabytes of somebody else's cell data spent on decoration.

---

## The crossfade needs two video elements

Operator, 2026-08-31: *"some sort of transition on the loop so it doesn't have
the jerky switch — like a fade effect."*

**One video cannot dissolve into itself.** Seeking back to the start is a
single discontinuous jump; there is nothing to fade *into*. So the layer
renders the clip twice and hands off: as the leading copy nears its out point,
the trailing one starts from the in point and fades up over it, then the first
pauses and rewinds ready for its turn.

The cheaper alternative — fading one element to black and back — was
considered and rejected. It reads as a deliberate blink, which is a *different*
artifact rather than the absence of one.

Consequences worth knowing before editing this:

- **`videoLoopFade: 0` renders ONE element.** A hard cut costs exactly what it
  did before the crossfade existed. Do not render the pair unconditionally.
- **The native `loop` attribute is off whenever the clip is trimmed or
  crossfading.** It always restarts at zero, so with a trim it would play the
  part the operator cut off, and in crossfade mode it would restart the leading
  copy underneath a dissolve already in flight.
- **The fade is clamped to a third of the playing window.** A 3-second
  dissolve on a 3-second loop leaves the section permanently mid-fade, both
  copies half-visible and neither ever clearly on screen
  (`resolveBuilderVideoLoopFade`).
- **The outgoing copy is rewound only after it has finished fading out.**
  Seeking it while still visible is the exact jump the crossfade replaces.
- A `handingOff` ref guards the swap, because `timeupdate` fires many times
  inside the fade window and each one would otherwise restart the dissolve.

---

## The layer is shared with image backgrounds now

Parallax (2026-08-31, 86bbqazxv) is why `BuilderVideoBackgroundLayer` became
`BuilderBackgroundLayer`. **An image background had never needed an element.**
It is painted as an ordinary CSS background on the surface itself — which is
fine until it has to *move*, because CSS on the surface cannot translate.

That is the same argument that already said the page background and cell
backgrounds must use THIS component rather than grow copies of it: two
implementations of "pause when off screen" or "honour reduce motion" drift
apart silently and only one of them ever gets fixed. One layer that can
translate, used by image and video alike — not a video parallax and an image
parallax.

The rename is a rename. **The `<video>` element's own class names and data
attributes are untouched**, so every render contract written against them
still means exactly what it meant.

### What the image layer does with the picture already there

It paints the identical picture ON TOP of the surface's CSS background and
translates that copy. Nothing is stripped from the surface. This is the poster
idea from the top of this document applied a second time: with JavaScript off
the layer never mounts, and the static background underneath is simply what
the visitor sees — never blank, never mispositioned, and with no second code
path to keep in step. Exactly like "show the still instead".

### `background-attachment: fixed` was considered and rejected

It is the obvious one-line answer and it is wrong twice over:

- It is defeated by any ancestor carrying `transform`, `filter`, `perspective`,
  `backdrop-filter`, a `will-change` naming one of those, or paint/layout
  containment — the same six properties as `docs/DOCTRINE.md` §5.17, the
  `blur(0px)` incident fixed in #327. The hazard is structural, not historical:
  the moment a theme or effect puts a filter on an ancestor column, a
  fixed-attachment background inside it silently stops parallaxing. No error,
  no failing test.
- iOS Safari ignores it outright.

So the drift is computed and applied, which means it is arithmetic, which
means it can be held still by a test — the `lib/builder-client/proximity-effects.ts`
pattern, and for its stated reason: nothing in this repo tests CSS. The pure
driver is `lib/builder-client/background-parallax.ts`
(`backgroundParallaxGeometry`), scroll position and the element's box in, one
offset out, unit tested in vitest alongside it. The layer is the thin renderer
that asks it for every number.

### The three things that keep it honest

- **Reduced motion returns a flat zero**, read through the layer's exported
  `prefersReducedMotion()` — one reading, shared, or "reduce motion" ends up
  honoured by the video and ignored by the drift over it.
- **The layer is taller than its section by the travel distance.** This is the
  classic parallax bug: a layer the height of its band uncovers an edge as
  soon as it moves. `image-parallax-never-uncovers-the-band` measures the gap
  at every sampled scroll position.
- **Off is off.** With `parallax` unset — the default — no layer mounts at all,
  and an existing page renders byte-identically to before this shipped.

### What the panel promises about phones

The Motion note is mode-aware on purpose. An image background drifts on phones.
A **video** background only drifts there if Play On Phones is on: with it off
the clip is never loaded, so the poster is what visitors see and nothing moves.
The panel says so rather than leaving the control silently dead — that was a
condition of the ticket, and it is the rule to keep: a setting that does
nothing on a phone must admit it in the panel.

---

## The row overlay tint was normalized for months and never painted

`normalizeRowOverlayScreenSettings` has existed in `builder-template.ts` all
along. The only code that ever *painted* an overlay lived in the frozen vanilla
builder (`public/js/builder.js`, `buildRowOverlayScreenStyle`). A
React-rendered row silently had none — the setting saved, loaded, and did
nothing.

Text over moving footage is what finally forced the port
(`getBuilderRowOverlayScreenStyle`, #475). Choosing Video now seeds the tint if
the row has none — operator's call, 2026-08-31: *"Default overlay tint ON"* —
and it **seeds, it never owns**: an overlay already configured is untouched,
and switching away from Video does not tear it back out.

---

## Traps this work walked into

Five, and the pattern is the same each time: everything reported success.

1. **`Number("")` is `0`, and `0` is finite.** `clampBackgroundNumber` checked
   `Number.isFinite` *after* coercing, so an emptied Speed box clamped to the
   0.25× minimum instead of falling back to normal speed. Absent is now checked
   before coercion. Found by its own test while writing it.

2. **A tested helper is not a tested feature.** The tint seed had six passing
   tests while the *call* to it could be deleted outright with all 1303 tests
   still green. Break-test the wiring, not just the unit.

3. **Adding a background mode means THREE dropdowns.** The shared picker
   renders two layouts, and `builder-section-controls.tsx` has a third
   hand-written copy mounted with `hideModeRow` — that third one is the one the
   operator actually uses.

4. **The panel shipped visibly broken with every gate green.** Module-editor
   field strips inside the section editor: the lattice flattens the background
   picker's *known* wrappers into its grid tracks, and a new wrapper is not on
   that list, so it took one cell and laid its own rows out inside it. "Loop"
   rendered inside the Speed select. Fixed by rebuilding on `BuilderSettingRow`
   inside a `.builder-schema-panel-column` — the shape Section Settings uses
   for everything else, which also made the panel measurable by
   `check:panels` (564 → 567).

5. **`mediaCategory` is not the file type.** The gallery pickers opened
   filtered to a media *category* of "Video"/"Image" — a topical field ("Article
   Banner", "X Post") that no asset carries — so the modal painted the whole
   library and then emptied itself when the filter landed. The operator saw a
   flash and a blank shell. The right filter is `kind`, which
   `BuilderGalleryModal` takes as `initialKind`.

---

## Checking a change here

`npm run check:render` carries eight `video-background-*` contracts and seven
`*-parallax-*` ones, and reaching them needs no database, no login and no
fixture — a video and a greyscale poster are committed at
`public/images/render-fixture-background*`, and the parallax contracts reuse
the same banner image every other image contract already uses:

```
PORT=3058 node server.js
UI_HARNESS_BASE_URL=http://localhost:3058 npm run check:render
```

The poster is deliberately the same frame **without colour**, so "the fallback
is showing" is something a person can see across the room rather than squint
at.

**Read `docs/DOCTRINE.md` §5.14 before treating a green run as proof.** Two of
these contracts passed over a completely dead crossfade before the `series`
capability existed; that story is §3.15.
