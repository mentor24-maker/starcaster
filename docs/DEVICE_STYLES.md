# Device styles — one page, three screens

A row or a module can look different on a phone and on a tablet without
becoming a different row or a different module. This is how that works, what
it stores, and the two rules that keep it from quietly forking a page into
three pages nobody maintains.

Shipped in slices: **rows** (86bc13a6v, PR #716), **modules** (86bc14pfq).
Still open: the preview's Tablet frame and harmonising the pre-device phone
rules onto the same widths (86bc14pgq).

## The two decisions everything follows

Dane, 2026-09-15:

* **A device follows the screen above it until a setting is changed there.**
  Desktop → tablet → phone. Only the differences are stored.
* **Tablet is 1024px and below. Phone is 767px and below**, and phone wins.

The first decision is the one with teeth. A device map holds only what
*differs*, and setting a value back to the one it would inherit **removes** it
rather than pinning it — which is what keeps a later desktop change flowing
down to every screen that never asked to be different. A system that copied
desktop into each device on first edit would look identical on day one and
drift apart for ever after.

## What a device may change

| | Row | Module |
|---|---|---|
| Spacing | margin and padding, four sides each | margin, four sides |
| Size | Width mode, Width %, min height, column gap | Width % (Simple/Rich Text) |
| Nudge | horizontal / vertical offset | horizontal / vertical offset |
| Type | — | font size (heading, headline-rotator, poll-category-list) |
| Other | alignment, border width/style/colour/radius | alignment |
| Visibility | Hide on this screen | Hide on this screen |

Everything else is one value for every screen, on purpose: **content, colours,
backgrounds, overlays, layout and column widths**. A phone that could hold its
own copy of the text is three pages to keep in step, and nobody would.

## Where it is stored

Two shapes, because the two objects are shaped differently.

**A row** carries a typed field:

```json
"deviceOverrides": { "tablet": { "paddingTop": "30" }, "phone": { "paddingTop": "60" } }
```

**A module's** settings are a flat `Record<string, string>` that keeps unknown
keys, so a device value is a flat key:

```json
{ "marginTop": "10", "phone.marginTop": "4", "phone.fontSize": "16" }
```

Both are cleaned by the same discipline: each value passes through the very
normalizer its desktop field uses, so a device can never store what desktop
could not, and a device with nothing left disappears rather than serializing
as an empty object.

* `lib/builder-client/builder-device-overrides.ts` — rows
* `lib/builder-client/builder-module-device-overrides.ts` — modules
* `BUILDER_SECTION_DEVICE_KEY_NORMALIZERS` and
  `BUILDER_MODULE_DEVICE_KEY_NORMALIZERS` are the key lists. **Adding a key is
  an edit to one of those two objects and nothing else.**

### The pre-device phone fields

Three module settings predate all of this and are live on real pages:
`mobileHidden`, `mobileAlignment`, `mobileFontSize`. They are read as **phone
fallbacks** — they sit in the phone chain between tablet and `phone.*` — so an
untouched page resolves on a phone to what it already renders, and a new
`phone.*` value simply wins over the old field.

They still RENDER through the stylesheet classes they always did, at **900px**
rather than 767px, and the generator deliberately emits nothing for a module
that carries only them. Harmonising those widths is slice 4's job; until then,
a page nobody has opened on a phone must not move.

> Measured 2026-09-15: `mobileFontSize` on a heading has in fact never reached
> a real phone. Inside the same 900px block,
> `.builder-react-root .builder-preview-heading:not(.builder-preview-heading-eyebrow)`
> sets `font-size: clamp(1.35rem, 9vw, 2.35rem) !important` at equal
> specificity and later in the file, so it wins. Mobile Font Size works only
> inside the preview's phone frame, which has a rule of its own. That is a real
> defect and it belongs to 86bc14pgq, which owns the old phone rules.

## How it reaches the page

An inline style cannot say "only below 1024px", and every one of these settings
is painted inline. So the renderer emits a scoped `<style>` element carrying
only what came out different, with `!important` — without it the inline desktop
value outranks every rule and the Phone panel silently does nothing.

* **Rows** — `components/builder/builder-device-css.ts`. It runs the
  renderer's OWN style builder twice, once per device, and diffs the two
  objects. Reusing the builder is the point: a device rule can never disagree
  with how desktop computes the same value.
* **Modules** — `components/builder/builder-module-device-css.ts`. A module's
  styles land on three different elements (the wrapper, the module's own root,
  and deeper still for a font size), so there is no single style object to
  diff; this one maps each device KEY to its declarations and its element. The
  two values where drift would actually matter — Width % and the nudge — are
  still computed by the renderer's own helpers.

Three details that are load-bearing rather than incidental:

* **The style element is the LAST child.** A row's goes inside the row, a
  module's inside its column. The phone reverse-stack rules count children with
  `nth-child`, and an element placed first renumbers the columns (86bbwmp2y).
* **Phone rules are emitted twice** — under a media query for the live site,
  and under `.builder-preview-device-mobile` for the preview's phone frame,
  which is a narrow box on a wide screen and matches no media query.
* **A module's scope selector is repeated three times.** The pre-device mobile
  stylesheet is class-based and therefore beats a single attribute selector;
  the tallest rule to clear is at (0,4,0). This is spelled out rather than
  fixed with a `.builder-react-root` prefix because a published tenant page has
  no such wrapper.

### Hiding, and showing again

Hiding is `display: none !important`. A phone follows its tablet, so a tablet
hide normally applies at phone width too.

When the phone shows the module again, the tablet hide is confined to the
tablet **band** — `(min-width: 768px) and (max-width: 1024px)` — rather than
being undone by a second `display` declaration. There is no one value to undo
it to: a module in an equal-height row is `display: flex` and everywhere else
it is block, so writing `display: block` back would break the one case. (Rows
do write the display back, because a row's own display is always `grid`.)

## The editor

`BuilderDeviceSwitch` — three icons, Desktop highlighted — is shared by rows
and modules so the control is one thing to learn. An icon carrying a dot means
that screen has settings of its own.

Choosing Tablet or Phone **replaces** the panel rather than adding to it: one
panel is one screen's settings, so there is never a question of which screen a
field you can see belongs to. The panel shows a banner naming the screen, a
chip per setting this screen changes with a `reset` beside it, `Reset all`, and
a dot beside each changed label.

Every control in it reads the object as that screen sees it and writes through
`writeSectionDeviceEdit` / `writeModuleDeviceEdit`, so **the controls
themselves do not know devices exist**. That is what makes adding a key cheap.

The switch is deliberately absent in three places: the old page-list Mobile
mode (it has its own pane), the **module repository**, and the
**saved-section modal**. A master in those two is a template rather than a
placed module, and its device settings would be copied onto every page that
follows it with no screen to check them on.

## Changing this

* Run `npm run check:render` — `scripts/ui/render-contracts.mjs` holds twelve
  contracts for this feature, read out of a real browser at 420px and 900px.
  Every failure mode here is invisible in the markup (a rule that loses to the
  inline style, a rule that loses to the old stylesheet, a query at the wrong
  width), which is why none of them is a unit test.
* Run `npm run check:panels` — it switches one row and one module to Phone and
  measures those panels like any other.
* **Break it on purpose and watch the named check fail before believing a
  pass.** Every contract above was break-tested when it was written; the ones
  worth re-breaking after a change are the specificity (`SCOPE_REPEATS`), the
  `!important`, and the tablet band.
