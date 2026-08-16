# Carousel module (`carousel`)

**Shipped:** 2026-08-16 — PR #273 (the merge), #282 (Height), #283 (loop).
**Replaces:** the `slideshow` and `slider` module types.
**ClickUp:** `86bba1e74` Carousel.

One module, two formats. It holds an ordered row of items and moves through
it; `format` decides whether one item fills the frame or several share it.

---

## Why the two modules became one

`slideshow` and `slider` were separate types until this merge. They were
never two mechanisms — both held an ordered row and moved through it. They
differed in exactly two settings, each hard-coded at opposite extremes:

| | how many visible | moves by itself |
|---|---|---|
| `slideshow` | one | yes |
| `slider` | many | no |

Because those were fixed rather than chosen, neither could borrow the
other's behaviour: a slideshow had no arrows and no clickable slides, a card
shelf could not rotate. `format` is that choice now, and everything
downstream reads it.

The operator kept **both palette tiles** (2026-08-16): you know whether you
want one big picture or a shelf of cards before you place anything. Both
tiles create the same module and differ only in the `format` they preset.

---

## Where it lives

| Piece | File |
|---|---|
| Public renderer (canvas, `/builder-preview`, live sites) | `components/builder-template-preview.tsx` → `CarouselPreview` |
| Loop arithmetic (pure, unit-tested) | `lib/builder-client/builder-carousel-loop.ts` |
| Settings panel | `components/builder/builder-carousel-module-settings.tsx` |
| Canvas card preview | `components/builder/builder-module-card.tsx` |
| Type, defaults, migration | `lib/builder-client/builder-template.ts` (search `carousel`) |
| Item model (shared with Feature Cards) | `lib/builder-client/builder-card-items.ts` |
| Palette tiles + group | `components/builder/builder-types.ts` |
| Styles | `src/css/_builder-react-overrides.css` §"Carousel module" |
| Import detection | `lib/site-import/map.ts` (writes `carousel` + `format: slideshow`) |

Remember the dual registration: after touching `builder-template.ts`, run
`npm run build:builder-template`, or the server coerces the type to `"text"`
on every load (CLAUDE.md landmine 1).

---

## Settings

Everything applies to both formats except the three noted. That list lives
in **one place** — `carouselFormatSupports()` in the settings panel — read by
both the panel and the renderer, so the editor cannot offer a control that
renders nothing.

| Setting | Key | Notes |
|---|---|---|
| Format | `format` | `slideshow` \| `cards` |
| Auto-advance | `autoplay` | defaults on for slideshow, off for cards |
| Interval | `intervalMs` | 1000–20000 |
| Transition | `transition` | **slideshow only** — fade needs one item to fade between |
| Loop | `loop` | see *The loop* below |
| Pause on hover | `pauseOnHover` | |
| Arrows | `showArrows` | both formats — the slideshow had none before the merge |
| Dots | `showDots` | both formats — neither module had them |
| Height | `heightPx` | 0 = auto. **Sizes different things per format — see below** |
| Card width | `cardWidth` | **cards only** — a slideshow item fills the frame |
| Gap | `gap` | |
| Show captions | `showCaptions` | **slideshow only**; off by default |
| Caption position | `captionPosition` | 5 positions |
| Items | `items` | the shared card shape |

### Height means different things, on purpose

The label follows the meaning: **"Height"** on a slideshow, **"Image height"**
on a card slider.

- **Slideshow** — the frame *is* the picture, so Height sizes the frame.
- **Cards** — the row's height comes from the cards in it, so sizing the row
  only adds an empty band underneath. Height sizes each card's **picture**.
- **Auto (0)** — the picture keeps its own proportions and nothing is
  cropped. A fixed height crops to that box (`object-fit: cover`),
  deliberately, so a row of mismatched photos can be made to line up.

This was wrong on the day of the merge and is worth not re-breaking: the
card picture was pinned at a hard `180px`, which cropped every poster and
made the Height control appear dead (PR #282).

---

## The item model

`items` uses the same shape as Feature Cards (`builder-card-items.ts`):
`{ id, title, body, imageUrl, imageAlt, linkUrl, linkLabel, icon, iconImageUrl }`.
Deliberately shared so content moves between the two modules without
retyping. A slideshow slide is simply a card with only its picture filled in.

Captions are how the slideshow format shows the `title` / `body` / `linkLabel`
a card would show beside its picture — there is nowhere else on a
full-frame slide for them to go.

---

## Migration from the retired types

`RETIRED_MODULE_TYPES` in `builder-template.ts` maps `slideshow` and `slider`
to `carousel`, checked at the top of `normalizeModuleType`.

**These entries are permanent.** An unrecognized type falls through to
`return "text"`, which rewrites the module into an empty text block on the
next page load — silent, no undo. Old documents keep arriving from page
revisions, saved sections, imports and backups long after a rename.

`migrateCarouselSettings()` folds the old collections into one:

```
slideshow  slides      [{ id, url, alt }]              → items
slider     sliderItems [{ id, title, body, imageUrl…}] → items
```

`url` → `imageUrl`, `alt` → `imageAlt`, everything else arrives empty.
Which key a document carries also seeds `format`, so a page that never
named one still renders as what it was authored as. `sliderCardWidth` and
`sliderGap` carry across; `sliderHeight` is dropped, having been written on
every Card Slider ever created and read by nothing.

Hand-rolled rather than reusing `parseBuilderCardItems`, because that module
resolves asset URLs through browser-only code and must not be imported by
`builder-template.ts`, which also bundles for the server.

**Emitting a retired name is a bug even though it works** — see
`docs/DOCTRINE.md` §5.11.

---

## The loop (cards format)

Asked for on 2026-08-16: *"remove the bottom scrollbar, and let the tiles go
in a continuous loop, so the first slide scrolls in from the left when the
series is finished."*

The card set is rendered **three times** and the strip is parked on the
middle copy. Once scrolling settles it is put back by exactly one
set-width. The copies are identical, so the jump lands on the same picture
in the same place and cannot be seen.

Four things that are load-bearing:

1. **It only loops when the set overflows the container.** Otherwise two
   cards render as "A B A B A B". Measured against the real container.
2. **The recentre waits for a quiet period** (120ms), never mid-animation —
   `scrollend` would say this exactly but Safari lacks it.
3. **Assigning `scrollLeft` cancels a smooth scroll in flight,** so the
   pending target is shifted with the ground and the journey re-issued.
   Without it, eight quick presses moved seven cards.
4. **Steps count from where the strip is headed,** not where it currently
   is. Reading a half-finished position threw presses away.

Clones are `aria-hidden` and `inert`: a keyboard or screen-reader visitor
meets each card once, not three times.

The scrollbar is hidden with three properties (`scrollbar-width`,
`-ms-overflow-style`, `::-webkit-scrollbar`) because each engine reads a
different one. `overflow-x: auto` stays, so swipe and drag still work.

---

## What the tests do and do not cover

Covered: the migration, the format-conditional panel, the renderer's markup,
and the loop arithmetic (`builder-carousel-loop.test.ts` — the seam shift and
the shorter-way-round step, both of which were wrong at least once).

**Not covered — and this is the module's live risk:**

- **Appearance.** Nothing in this repo tests CSS. Both defects that reached
  the operator during this work were pure CSS and every gate was green. Two
  narrow guards now read the stylesheet directly (that the card picture pins
  no height, and that the row hides its scrollbar); they are patches, not
  coverage. See `docs/DOCTRINE.md` §5.13.
- **Scroll behaviour.** Cloning, the seam, swipe and autoplay stepping exist
  only in a browser — under SSR the container measures zero, so the module
  renders a single un-cloned copy and a markup test sees nothing of the loop.
  Verify by driving a browser; that is how the two loop bugs above were
  found.
