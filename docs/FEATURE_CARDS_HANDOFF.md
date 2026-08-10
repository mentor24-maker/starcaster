# Feature Cards — styling thread handoff

**Branch:** `feature-cards-style` (worktree `.claude/worktrees/feature-cards-style`, off `origin/main` @ 5558fc5)
**Opened:** 2026-08-08

## The complaint

Feature Cards render "generic black and white" — see the live staging page
`https://delraytennis.starcaster.pro` (four TEST CARD tiles, white boxes, black
text, no theme color, no icons). The module shipped in PR #105 with a full
settings panel and ~520 lines of CSS, so the capability exists; it is not
reaching the page.

## What the module is

Shipped in PR #105 (`33a2ad8`), Site Import auto-detection in PR #109 (`18a1b49`).

| Piece | File |
|---|---|
| Settings panel | `components/builder/builder-feature-cards-module-settings.tsx` |
| Card data model + tests | `lib/builder-client/builder-card-items.ts` |
| Canvas rendering | `components/builder-template-preview.tsx` |
| Type + defaults | `lib/builder-client/builder-template.ts` (search `"feature-cards"`) |
| Styles | `src/css/_builder-react-overrides.css` §"Feature Cards module" (~line 753) |
| Import detection | `lib/site-import/map.ts`, spec `docs/site-import/03-card-grids.md` |

## Leads — verified

**1. The defaults are hardcoded neutral, not theme-derived.**
`builder-template.ts` seeds a new Feature Cards module with:

```
cardBackground: "#ffffff"
cardBorderColor: "#e1e8f0"
iconColor:      "#0b2a4a"
iconAltColor:   "#4f9c3a"
```

The settings panel *does* offer theme colors (it imports
`BuilderThemeColorField` and passes `themeColors` to six fields), so an operator
can pick brand colors by hand — but a freshly-inserted or freshly-imported card
grid starts white/gray and stays that way until someone does. This alone
explains the screenshot. Site Import (PR #109) emits cards with these same
defaults, so every imported grid lands generic.

**2. Nearly all the card CSS is scoped to the editor, not the public site.**
23 of the 33 `feature-card` rules in `_builder-react-overrides.css` are prefixed
`.builder-react-root` — a wrapper that exists only inside the Builder's editing
canvas. `legacy.css` (which published pages do load) carries only four stale
`.builder-template-feature-card` rules, and nothing in the codebase emits that
class name any more — it is dead CSS from an older component.

Consequence to confirm: cards may look right in the Builder and lose most of
their styling once published. **Not yet proven** — see below.

## Not verified — do this first

`curl https://delraytennis.starcaster.pro` returns a 3 KB shell; the page paints
client-side, so the published markup could not be greped from the terminal.
**Open the live page in a browser, inspect one card, and write down the actual
class names on it.** That single observation decides whether lead #2 is real or
a red herring. Do not write CSS before you have it.

## Local trap — fix before you debug anything

`lib/builder/template.js` in a fresh checkout of this branch is stale or absent.
It is a gitignored build artifact, and the copy in the main folder was built
Aug 6 — *before* Feature Cards existed, so it does not know the type at all.
Per CLAUDE.md landmine #1, an unknown module type is **silently coerced to
`"text"` on every page load**. You would see cards vanish into plain paragraphs
locally and conclude the module is broken when it is not.

```
npm run build          # once, in this worktree, before anything else
```

Production is unaffected — Vercel rebuilds from source.

## Definition of done for this thread

1. `npm run typecheck`
2. `npm run test:builder-ui` and `npm run test:builder`
3. `npm run build:builder-template` + `npm run build:css` (both are affected by
   any change here)
4. `node scripts/check_conventions.cjs`

---

## Preserved into the repo 2026-08-10

This lived only on the operator's Desktop until now. The Feature Cards
work it describes shipped (PR #115 made the themed default visibly
designed; PR #116 added the Delray demo-content script), and the module
was then carried through the whole UI overhaul — axes, checkboxes, the
titled-column item grid, and its colours moved behind Advanced as theme
overrides (`docs/UI_RULES.md` A1). Kept for the incident history: it
records *why* the module looked generic, which is the kind of thing
`docs/DOCTRINE.md` says never to lose.
