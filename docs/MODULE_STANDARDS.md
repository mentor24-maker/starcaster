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

## 10. Settings editors follow the field-strip conventions

`BuilderModuleFieldStrip` + `BuilderModuleField`, declared width tokens,
labels that don't wrap, advanced groups inside `<details class="hanging-details">`,
H/V margin offered together. Details in `components/CLAUDE.md`.

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
`navigation`, `button`, `slider`, `table`, `code`) for deliberate review
rather than accidental discovery.

Two known-weak spots already logged: modules whose CSS may be
breakpoint-only (rule 3 — the Card Slider was found this way; others are
unaudited), and modules with no defined empty state (rule 5).
