# Handoff: the Builder module system

Written 2026-08-07 at the end of a long session (30 PRs, #76–#103), for
the agent picking up the module thread next. The operator (Dane) has been
thinking about this for weeks and named the goal directly:

> *"I want to develop an elegant and robust system for being able to
> easily replicate any type of module, plugin, widget, or snippet and turn
> it into a Starcaster-native module that has clear, intuitive UI so the
> user finds every single widget familiar in terms of structure and
> design."*

That is the north star. Everything below is the ground you start from.

---

## 1. Read these first, in this order

| Doc | Why |
|---|---|
| `CLAUDE.md` (root) | repo invariants, generated-file table, landmines |
| `docs/DOCTRINE.md` | hard-won rules with the incidents behind them |
| `docs/MODULE_DEV_PIPELINE.md` | how module work moves: Intake → … → Merge |
| `docs/MODULE_STANDARDS.md` | the 13-rule quality bar every module must clear |
| `components/CLAUDE.md` | field-strip conventions, module-adding checklist |
| `docs/site-import/00-builder-schema.md` §2, §5 | module type inventory + the cost of adding a type |

Both process docs were written **this session** and are new; they are not
yet deeply battle-tested. Improve them as you go — that is expected.

---

## 2. Where the module system actually stands

**52 module types**, enumerated in `BuilderTemplateModuleType`
(`lib/builder-client/builder-template.ts`). Grown fast, over a long
period, to no written standard. The operator's own framing:

> *"assume that all of our modules were coded in a slapdash manner by less
> competent AI models operated by a less educated me."*

Treat that as accurate but not cynical — the modules work; they are just
inconsistent, and several carry defects nobody has looked for.

### Every module owns four surfaces
1. **Public renderer** — `components/builder-template-preview.tsx`
   (one renderer serves editor canvas, `/builder-preview`, and live sites)
2. **Canvas preview** — `components/builder/builder-module-card.tsx`
3. **Settings editor** — usually `builder-<type>-module-settings.tsx`
4. **Palette entry** — `components/builder/builder-types.ts`

Plus **dual registration**: the type union + `normalizeModuleType`
allowlist + `createEmptyModule` defaults in `builder-template.ts`, then
**`npm run build:builder-template`**. Skip that command and the server
silently coerces the new type to `"text"` on every page load — data loss,
no error. This is CLAUDE.md landmine #1 and the single most dangerous
step.

### What is converged, what is not
- **`carousel`** (2026-08-16, PRs #273/#282/#283) — `slideshow` and `slider`
  merged into one module with a `format` setting. The structural example,
  and the worked example of retiring a type name without losing documents:
  `docs/CAROUSEL_MODULE.md`.
  - `slideshow` was built to the standard from scratch (PR #92); `slider`
    had been brought only partway — it had *no desktop CSS at all* (rules
    lived only inside `@media (max-width: 900px)`) until PR #95.
- **`image`** (PR #103) — the **reference implementation for the settings
  editor layout**. Copy its shape.
- **The other ~49** — unaudited. Assume breakpoint-only CSS, missing
  empty states, hand-rolled settings grids, and settings nothing renders,
  until proven otherwise.

Convergence rule, ratified: **boy-scout, not big-bang.** A module touched
for any reason is brought to standard in that same PR, and the PR states
which rules it now meets.

---

## 3. The vision, and a proposed architecture for it

Replicating "any widget" reliably needs three things the codebase does
not have yet. This is a proposal, not a decision — spec and ratify it
through the pipeline before building.

### (a) A declarative settings schema
Today each module hand-writes its settings editor, so consistency depends
on discipline and is therefore never achieved. If a module instead
*declared* its settings —

```ts
{ key: "size", label: "Width", control: "select", options: PERCENTS,
  group: "layout", width: "select-sm", default: "100",
  rendersVia: "getModuleWidthStyle" }
```

— then the editor UI is **generated** from the declaration, and:
- every module's UI is identical in structure by construction, which is
  precisely what the operator is asking for;
- **rule 13 becomes enforceable**: a setting must name what consumes it,
  so "a control that does nothing" fails a test instead of surviving for
  years (see §5);
- the settings/renderer contract is machine-readable, which makes the
  next two items possible.

Migration path: schema-driven editors alongside the hand-written ones,
converting modules boy-scout style. Do **not** attempt a big-bang rewrite
of 52 editors.

### (b) A module scaffold generator
`npm run new:module <type>` emitting all four surfaces, both
registrations, a CSS stub in the hand-authored layer, and a conformance
test — so a new module is correct by default rather than correct if the
author remembered the checklist. The checklist already exists in prose
(`docs/site-import/00-builder-schema.md` §5); this makes it executable.

### (c) A conformance test
One test asserting, for every type in the union: palette entry exists,
`createEmptyModule` defaults exist, the public renderer has a branch,
the settings editor is reachable, and every declared setting names a
consumer. That test is what keeps 52 modules honest without 52 audits.

### On "replicating any widget"
The realistic ladder, cheapest first:
1. **`code` module** — already renders sanitized HTML; the fallback for
   anything, and what Site Import uses for placeholders.
2. **Compose from existing modules** — most third-party widgets are a
   heading + image + button in a layout.
3. **New native module** — when the behaviour is genuinely new
   (auto-advance, data binding, interactivity).
The system should make step 3 cheap and consistent; it should not make
step 3 the default answer. Note the sanitizer allowlist
(`lib/builder-client/sanitize-html.ts`) strips `form`, `table`, `svg`,
`video`, `iframe`… from `code` embeds — widening it is a security
decision affecting client and server bundles.

---

## 4. Open work, with state

All in **ClickUp → Starcaster → Dev Backlog**. Each carries its stage per
the pipeline.

| Task | State | Note |
|---|---|---|
| `86bba3az6` **Responsive image variants** | Spec'd, Discovery done | **Start here.** Existing tooling makes ONE 480px thumbnail; no variant set, no `srcset`. Delray serves 1103×1426 flyers. |
| `86bba3eug` **Asset promotion not idempotent** | Discovery done | 249 asset rows for 23 images (15 copies of one). Needs dedupe + cleanup pass. |
| `86bba1e74` **Carousel** | **Done** (PRs #273/#282/#283, 2026-08-16) | Went further than ratified: `slideshow` and `slider` MERGED into one `carousel` with a `format` setting, rather than enhancing one of the two. Both palette tiles kept (operator's call). Backward compatibility held — migration is automatic and lossless, and live sites did not start moving because autoplay defaults follow the format. `docs/CAROUSEL_MODULE.md`. |
| `86bba3ax5` **Image module / settings standard** | **Done** (PR #103) | Reference implementation. |
| `86bb9zgbe` Crawl priority (menu pages first) | Intake | Menu parent items still link to uncaptured pages. |
| `86bb9yj74` Repeated site-chrome dedup | Intake | Import chrome once, not per page. |
| `86bba1hfq` Tracking-pixel filtering | Intake | Beacons captured as assets. |
| `86bba1dzz` Slider porting (part b) | Partial | Hydration done; importer module-choice rules open. |
| `86bba2tm5` Restore-material durability | **Tabled** by operator | Revisit before any client-facing restore promise. |
| `86bba2k2d` Slideshow gate + reversal | **Done** (PR #98) | Veto flags + reverter shipped. |

---

## 5. Lessons this session paid for — do not re-learn them

1. **Trace helper indirection before declaring a setting dead.** A grep
   for `settings.borderThickness` across three component files found
   nothing and I reported the controls decorative. They were live, read
   via `getImageModuleStyle()` in `builder-utils.ts`. Now rule 13.
2. **Layout CSS must never live only inside a breakpoint.** The Card
   Slider rendered as one giant image above 900px because every structural
   rule sat inside a mobile media query. Rule 3.
3. **New CSS goes in `_builder-react-overrides.css`.**
   `_builder-react.css` is regenerable and a regeneration silently ate the
   CRM modal styles for a month. Rule 4.
4. **`git pull` prints "Updating x..y" even when it ABORTS.** Verify
   syncs by comparing `HEAD` to `origin/main`, never by reading output.
   This left the operator's checkout 4 merges behind for hours.
5. **macOS `grep` does not support `\|` alternation.** Several searches
   silently returned nothing. Use `grep -E`, or search with node.
6. **An open Builder editor tab holds a stale copy of the page.** Saving
   it overwrites newer content. Ask the operator to close editor tabs
   before running anything that writes pages.
7. **Idempotency is per-resource.** The mapper was made idempotent for
   pages (section hashes) while assets quietly duplicated on every run.
   When you make one thing idempotent, ask what else the run writes.

---

## 6. Working with the operator

- **Coach in plain language.** Dane directs the project expertly but is
  not a career programmer; modern dev jargon does not land. Explain a term
  the first time it matters. This is a CLAUDE.md mandate, not a courtesy.
- **CC runs the commands.** He should never be handed a CLI incantation as
  the primary path — he speaks intent ("keep the gallery images on that
  page"), you pick the script and flags. Exception: anything touching a
  real secret value is his keystroke.
- **CC owns all git.** Branch, commit, PR, merge on his word. He does not
  want a GUI git client and does not intend to memorize commands.
- **One worktree per thread** — `.claude/worktrees/<topic>`. The module
  work lives in `.claude/worktrees/module-pipeline`.
- **He merges; you never merge unasked.** Report CI status plainly
  ("green, say the word") and wait.
- **Terminal output is invisible to him** unless you put it in your reply.
  Summarize results; do not point at logs.
- **He will spot design problems you miss.** Every significant improvement
  this session — the slideshow, the table-as-image insight, the "series of
  images might be intentional" caveat, the module-standardization push —
  came from him looking at real output. Ship things he can look at.

---

## 7. Suggested first move

Do **not** start by refactoring modules. Start by making the next real
task deliver, and let the system emerge from it:

1. Take **responsive image variants** (`86bba3az6`) through Spec →
   Ratify → Build. It is the operator's live pain, it exercises the asset
   pipeline end to end, and it will tell you whether the image module's
   settings surface is right.
2. While there, notice what you *wish* existed for declaring the image
   module's settings. That is the schema in §3(a), designed from a real
   case rather than in the abstract.
3. Then propose the schema + scaffold + conformance test as its own
   spec'd project. By then you will have three modules built to standard
   (carousel, image, and one more) to generalize from — a much safer base
   than generalizing from one.
