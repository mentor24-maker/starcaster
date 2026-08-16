# Builder Module Standards

The bar every Builder module must clear — new ones on day one, existing
ones whenever they're touched. Written 2026-08-06, after the Card Slider
turned out to have no desktop styles at all: the module palette grew
fast, in a hurry, and much of it has never been held to a written
standard. This is that standard.

Each rule carries the incident that produced it (house style, per
`docs/DOCTRINE.md`). Rules without a dated incident are inherited
platform constraints.

**How this is used:** the Build stage of `docs/MODULE_DEV_PIPELINE.md`
checks a module against this list before its PR opens. A rule that
doesn't apply is stated and skipped ("no settings collection, N/A"),
never silently ignored.

---

## 1. Registration is dual, and skipping half is data loss

A new module type must be added to **both** the client union and the
regenerated server bundle: edit `lib/builder-client/builder-template.ts`
(type union + `normalizeModuleType` allowlist + `createEmptyModule`
defaults), then run **`npm run build:builder-template`**.

*Incident:* the server normalizer silently coerces unknown types to
`"text"` on every page load — a page saved with an unregistered type
loses its module the next time anyone opens it. (CLAUDE.md landmine #1.)

## 2. Every module owns four surfaces

1. **Public renderer** — `components/builder-template-preview.tsx`
   (one renderer serves editor canvas, `/builder-preview`, and live sites)
2. **Canvas preview** — `components/builder/builder-module-card.tsx`
3. **Settings editor** — same file or a `*-module-settings.tsx`
4. **Palette entry** — `components/builder/builder-types.ts`, with a
   group, icon, and a description a non-developer can choose from

Missing any one produces a module that exists but can't be used, edited,
or found.

## 3. Layout CSS may never live only inside a breakpoint

Structural rules (flex/grid, sizing, positioned containers) belong in the
**base** ruleset. Media queries may only *adjust* them.

*Incident (2026-08-06):* the Card Slider's flex row, card sizing, and
positioned image frame existed only inside `@media (max-width: 900px)`.
Above 900px the cards were unstyled and each `fill` image escaped its
card to span the page — the module showed one giant photo instead of a
row. It had presumably shipped that way from the start; nobody had put
images through it on a desktop screen. Its scroll arrows had no CSS at
all.

**Corollary — a module may not depend on ambient CSS it doesn't own.**
If a renderer uses `fill`/absolute positioning, the module's own stylesheet
must supply the positioned, sized container.

## 4. New rules go in the hand-authored CSS layer

`_builder-react.css` is regenerable by `extract_builder_css.mjs`, which
replaces the whole file. Hand-written module rules belong in
`_builder-react-overrides.css` (imported after, so it wins).

*Incident:* commit `2bd3018` regenerated `_builder-react.css` and
silently deleted the CRM modal styles, breaking Contacts delete for a
month. Nothing tests CSS. (PR #61 added a drop guard.)

## 5. Empty state is a designed state

A module with no content must render a short instruction ("Add slides in
the editor"), never a blank box, a zero-height element, or a crash. The
same applies to malformed settings: parsing a settings collection must be
wrapped and fall back to empty.

## 6. Collection settings must be registered for the large cap

Settings values are truncated at **10,000 characters** by the normalizer.
Keys holding JSON collections (`slides`, `navItems`, `tableData`,
`content`, `tableContents`) are explicitly exempted to 200k/500k in
`normalizeBuilderModuleSettingsForType`. A new collection key that isn't
added there is silently truncated mid-JSON on the next save — which
parses as empty and wipes the content.

## 7. Responsive by construction

Every module renders correctly at desktop (1440), tablet (768), and
mobile (390). Wide content scrolls inside its own container; the page
body never scrolls horizontally. Verify all three before the PR — the
`/builder-preview` device switcher exists for this.

## 8. Accessible by default

Images take alt text (a settings field, not a hardcoded blank).
Icon-only buttons carry `aria-label`. Interactive controls are real
`<button>`s. Auto-advancing content pauses on hover.

## 9. User HTML is always sanitized

Rich-text and embed HTML passes through `lib/builder-client/sanitize-html.ts`.
Never `dangerouslySetInnerHTML` with raw user content
(`components/CLAUDE.md`).

## 10. UI follows the doctrine → `docs/MODULE_UI_DOCTRINE.md`

**All UI rules now live in one place: `docs/MODULE_UI_DOCTRINE.md`** — both
the editor UI (settings panel) and the rendered UI (published page), plus
the framework rules for admin screens.

This rule used to hold the field-strip standard inline. It was moved out
on 2026-08-08 because the rules had spread across four documents and
none of them were checked: measured against the palette, **5 of 37**
settings editors actually followed this rule. The doctrine doc pairs
every rule with how it is *enforced* (`[auto]`, `[type]`, `[test]`,
`[eye]`), and the mechanical ones now run in `scripts/check_ui_doctrine.cjs`
at pre-commit and as a blocking CI step.

Two homes for the same rules is how they drift. This is a pointer, not a
summary, on purpose.

## 13. Every setting must be honoured by the renderer — check the helpers

A control that changes a setting nothing renders is a bug wearing a
feature's clothes. When touching a module, walk each setting from the
editor to the render path and confirm something consumes it.

*Incident (2026-08-07):* auditing the Image module, a `grep` for
`settings.borderThickness` across three component files found nothing,
and the settings were reported dead. They were not — the renderer reads
them through `getImageModuleStyle()` in `builder-utils.ts`, one level of
indirection away. The opposite error was real too: `horizontalOffset` and
`verticalOffset` genuinely were dead and have now been removed.
**Trace the helpers, not just the literals** — and confirm both
directions: settings with no renderer, and renderers reading settings no
editor exposes.

## 11. Email render is a decision, not an oversight

Each module either renders sensibly in email or is added to the skip list
in `builder-email-render.ts`. State which, and why, in the PR.

## 12. Import path is considered

If a source site could plausibly contain this component, note whether
Site Import can produce it (`lib/site-import/map.ts`) or file a task. A
module the importer can't emit means every imported site needs it built
by hand.

---

## Bringing the existing palette up to standard

52 module types predate this document. The approach is **boy-scout, not
big-bang**: any module touched for any reason gets brought to standard in
that same PR, and the PR says which rules it now meets. A standing audit
task tracks the highest-traffic modules (`text`, `image`, `heading`,
`navigation`, `button`, `carousel`, `table`, `code`) for deliberate review
rather than accidental discovery.

Three known-weak spots already logged: modules whose CSS may be
breakpoint-only (rule 3 — the Card Slider was found this way; others are
unaudited), modules with no defined empty state (rule 5), and editors
still using hand-rolled grids instead of field strips (rule 10 — Image
is converted; the rest are not).
