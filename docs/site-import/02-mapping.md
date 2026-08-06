# Site Import — Phase 2 Functional Spec: Mapping (IR → Builder drafts)

Status: **operator ratified the base draft 2026-08-06; HQ-review
amendments folded in, awaiting operator confirmation** (merging this PR
is that confirmation). The amendments: clobber-guard section hashes,
Header-master JSON backup under `--nav` (verified: site snapshots cover
pages only), `--nav-replace` gate for non-empty masters, durable
crop/asset copying on apply, fixture-completeness requirement, the
oversize-element split ladder, and the slug normalizer incl. the
`admin-*` auto-private trap. Prerequisites:
`00-builder-schema.md` (platform facts) and `01-capture-and-ir.md`
(Phase 1, COMPLETE 2026-08-06 — the delraytennis.com IR exists and is the
reference input for everything below).

## Context

Phase 1 banks the raw material: every page of a client's site captured
into a lossless IR plus screenshots and assets in Blob. Phase 2 turns
that IR into **real Builder pages** — a starting scaffold a human
redesigns, not a faithful clone.

**Governing principle carries over: COMPLETENESS OVER FIDELITY.** Every
element in the IR must land in exactly one Builder module (or be
explicitly accounted as consumed/skipped with a reason). The mapper gets
its own coverage accounting, mirroring Phase 1's: any unaccounted element
is a bug. Approximate layout is fine; lost content is not.

Unlike the Phase 1 worker, the mapper **writes Builder tables** — the
platform's crown jewels. Every safety rule the house has learned the hard
way applies (snapshot first, drafts only, dry-run default, locked
sections untouchable, nav to the master).

## Inherited invariants (ratified in Phase 1, binding here)

1. **Imported nav writes to the saved-section master, never per-page**
   (the 2026-07-21 Marinoff menu-loss rule).
2. **Snapshot the whole site before any write; land every page as an
   unpublished draft.**
3. **`module.text` caps at 10,000 chars** — the IR's `textLength` exists
   so the mapper splits long content across multiple text modules.
4. **All page-document writes go through `lib/builder/document.js`**
   (via `lib/builderPagesStore.js: createPage/updatePage`) — the raw
   template normalizer silently drops fields (Phase 0 §1 trap 2).

## Decisions to ratify

| # | Proposed decision | Why |
|---|---|---|
| 1 | **Placeholder = `code` module carrying the element's screenshot crop.** `module.text` = an `<img>` of the crop + a one-line caption ("Imported form — rebuild with a real module"); the original source HTML rides in `settings.importSourceHtml` (capped) with overflow to Blob. Applies to the sanitizer-stripped classes: `form`, `video`*, `table`, `embed`, `other`. | The sanitizer strips these tags (Phase 0 §5), so the crop IS the content until a human rebuilds it. This is exactly why Phase 1 captured per-element crops. No new module type, no sanitizer widening. |
| 2 | **Prose maps to `text` modules, merged then split.** Consecutive `heading`/`text`/`link` elements within one IR section merge into one rich-text module (their original HTML, which the rich-text allowlist accepts: h1–h6, p, lists, a, img…), split at 9,500 chars on element boundaries. **A single element over 9,500 chars** splits at its own top-level child boundaries, recursively; a still-atomic text run hard-splits at the nearest whitespace (a seam may break inline formatting mid-run — recorded, acceptable); only content with no split point at all demotes to placeholder. | Matches how Builder pages are actually built (headings live inside rich-text modules). Merging avoids a 400-module page; the margin below 10k keeps normalizer truncation impossible; the oversize ladder means no element ever silently truncates OR silently disappears. |
| 3 | `image` → `image` module; `button` (incl. `a[role=button]`) → `button` module (label + href); direct-file `video` src → `video` module, otherwise placeholder per #1. | Mechanical, unambiguous. |
| 4 | **Slugs: normalized original path, suffixed on collision; home lands as `imported-home`.** Builder slugs are single-segment (middleware rewrites `/{slug}`) and lowercase, so the mapper ships a slug normalizer: flatten path separators to dashes (`/about/team` → `about-team`), lowercase, ascii-fold, strip non-alphanumerics. **Never emit `admin`, `admin-*`, or the private-exact slugs** (`lib/builder-client/public-site-page-slugs.js` makes those auto-private — an imported `/admin-office` page would silently vanish from the public list); such paths get an `imported-` prefix. Existing pages always win collisions. | The operator promotes slugs deliberately at review time. An import must never shadow a live page — or fall into the auto-private trap. |
| 5 | **One IR section → one single-column Builder section** (`layout: "single"`, modules stacked in `main`), background color seeded from the section's dominant captured background when present. | Column inference from arbitrary sites is guesswork; approximate is ratified. The redesign pass re-lays-out anyway. |
| 6 | **Nav is a separate, explicitly-flagged step** (`--nav`), never part of a default run. It writes the header `NavTree` into the Header saved-section **master's** `navigation` module (`settings.navItems`), creating the master if the project has none. **If the master already carries a non-empty nav, `--nav` refuses unless `--nav-replace` is also given** — replacing a live nav propagates tenant-wide and deserves a second deliberate step. **Verified: whole-site snapshots cover pages only, NOT saved-section masters** — so `--nav` takes its own JSON backup of the master to `docs/SQL/backups/` before any write. Without `--nav`, nav links are accounted as `nav-consumed`, not mapped. | Invariant 1 — plus canonical propagation fans the master out to every linked page (Phase 0 §8). The snapshot gap is exactly the Marinoff-menu-loss shape; the master backup closes it. |
| 7 | **Assets and crops are COPIED into a durable project namespace on `--apply`.** Referenced assets and every placeholder screenshot crop are copied from `SiteImport/<jobId>/…` to `SiteImportApplied/<projectId>/…` (via `uploadBufferToBlobAtPath`); asset rows and page JSON reference the **copied** URLs — the same canonical URL in both so "Used In" matches (Phase 0 §6). Promotion stays referenced-only; unreferenced downloads remain in the job namespace, which is then free to be cleaned up. | Placeholder crops are the ONLY representation of forms/tables/embeds until a human rebuilds them — a page must never depend on a transient job folder. Copying dissolves the lifetime caveat entirely instead of recording it. |
| 8 | **Target project = the job's `project_id`; first DoD run goes into a scratch project**, not the live Delray project. | Same reason test posts don't go to real channels. |
| 9 | **Deferred (recorded, not built in Phase 2):** table→`table`-module conversion, theme seeding from `rawTokens` (nearest-match against the 11 curated fonts), meta-description carriage (no field exists on `BuilderPageRecord`), LLM-assisted section naming (post-embargo Builder Agents idea). | Each is real work with real decisions; none blocks a usable scaffold. The IR keeps everything they need. |

*`video`: a `<video>` whose resolved `src` is a direct media file maps to
the `video` module; YouTube/Vimeo iframes are `embed` class and become
placeholders (the `code` module's click-to-load iframe shield may render
some of them live — a bonus, not a promise).

## Architecture

```
lib/site-import/map.ts        pure engine: SiteIR → { pages: BuilderPageRecord-shaped
                              drafts, navItems, assetPromotions, report }  (no I/O)
scripts/site_import_map.mjs   operator runner: dry-run default, --apply to write,
                              --nav for the master, --job <id> selects the import
lib/site-import/dist/map.js   generated bundle (build:site-import, gitignored)
```

The engine is pure and fixture-testable, like the normalizer. The runner
follows the house one-off conventions (Phase 0 §3c): cloud-credentials
guard, dry-run default, JSON backup of every page it will touch to
`docs/SQL/backups/`, idempotent re-runs, documented rollback.

### Write path

- `lib/builderPagesStore.js: createPage / updatePage` with project scope —
  never direct table writes, never `lib/builder/template.js` directly.
- Before the first write: `builderPageSnapshotsStore` whole-site snapshot;
  its id is recorded on the import job row (`checkpoints.map.snapshotId`).
- Every page lands `isPublished: false`. Nothing the mapper does is
  visible on the tenant's live site until a human publishes.
- `locked` sections are never touched (content-fill convention, Phase 0
  §3b) — relevant when re-running onto existing imported pages.

### Idempotent re-runs — and never clobbering human work

The job row gains `checkpoints.map.pageIds` — `{ <irPagePath>: <builderPageId> }`.
A re-run **updates** those pages in place and never duplicates. Deleting
the drafts and clearing the checkpoint resets cleanly.

But "import-owned" is not enough to make replacement safe: these drafts
exist to be redesigned, and a half-redesigned section still carries the
import markers. So the mapper distinguishes *untouched* from
*human-modified*: when it writes a section, it stores a **content hash**
of exactly what it wrote in `checkpoints.map.sectionHashes`
(`{ <sectionId>: <sha256 of serialized section> }`). On re-run, a section
whose current content no longer matches its stored hash is **skipped and
accounted as `humanModified` in the report** — visible and reconciled,
never silently overwritten. (`--force-section <id>` exists for the rare
deliberate overwrite, one section at a time.)

### Mapping report — the coverage accounting

`SiteImport/<jobId>/map-report.json`, persisted before `--apply` writes
anything (the dry run produces the identical report):

```json
{
  "elements": { "total": 0, "mapped": 0, "placeholder": 0,
                 "navConsumed": 0, "humanModified": 0, "skipped": 0 },
  "skipped": [ { "sourceId": "…", "class": "…", "reason": "…" } ],
  "pages": [ { "path": "/", "slug": "imported-home", "modules": 0,
               "placeholders": 0, "builderPageId": null } ],
  "assets": { "promoted": 0, "cropsCopied": 0, "leftInNamespace": 0 }
}
```

(Shape sketch — counts filled by real runs.) Rule:
`total === mapped + placeholder + navConsumed + humanModified + skipped`,
`skipped` entries must each carry a reason, and `humanModified` counts
elements whose target section was hash-protected on a re-run. A dry run
whose numbers don't reconcile refuses to `--apply`. The UI's job page
shows the report next to the Phase 1 coverage table.

## Verification loop (how we know a mapped page is right)

1. Engine-level: snapshot tests — delraytennis fixture IR → mapped
   documents, round-tripped through `serializeBuilderDocument` + the
   server template normalizer, asserting the round trip changes nothing
   (proves no silent coercion/truncation — the Phase 0 §5 landmine).
   **Fixture completeness is a stated requirement, not an accident of
   what delraytennis happens to contain**: the test fixtures must
   deliberately exercise every module type and every settings key the
   mapper can emit — including a placeholder with capped
   `importSourceHtml`, the overflow-to-Blob case, an oversize-element
   split, a slug-normalization edge (nested path, admin-prefix), and a
   `navItems` seed — because the round-trip proof only covers what the
   fixtures put through it.
2. Report-level: reconciliation rule above, enforced in tests and at
   runtime.
3. Eyeball-level (DoD): imported drafts open in the Builder editor, render
   in preview, and their placeholder crops display. Side-by-side with the
   Phase 1 page screenshots.

## Out of scope for Phase 2 (hard constraints)

- No publishing, ever — the mapper cannot set `isPublished: true`.
- No writes outside: imported draft pages, the Header master (only with
  `--nav`), promoted asset rows, the job row's `checkpoints.map`.
- No sanitizer-allowlist changes.
- No LLM/vision calls.
- No template switching or applying content display models
  (`bulk-create-with-model` stays untouched; long-term supersession is
  still a later decision, per Phase 1).

## Definition of done for Phase 2

1. `npm run typecheck`, `npm run test:site-import` (engine tests +
   existing 43 green), `node scripts/check_conventions.cjs` pass.
2. Dry-run against the delraytennis job reconciles: every IR element
   accounted, zero unexplained skips.
3. `--apply` into a **scratch project**: snapshot taken, all drafts,
   report persisted, re-run idempotent (second `--apply` changes
   nothing).
4. Operator eyeball: drafts open in Builder, render, placeholders show
   their crops; nothing appeared on any live site.
5. `--nav` writes the Delray header tree into the scratch project's
   Header master and every imported page instantiates it. **Verified
   mechanics** (2026-08-06 code check): `propagateCanonicalSection`
   targets every page carrying the linked canonical section with no
   publish-state filter — drafts included — so the mapper attaches the
   master instance (`savedSectionId` + `canonical: true`) to each page
   **at creation time**, and later master saves propagate to the drafts
   automatically.
6. A re-run after hand-editing one imported section leaves that section
   untouched and reports it as `humanModified` (the clobber guard,
   exercised as part of DoD — not just unit-tested).
7. This doc updated with deviations discovered during implementation.

## Deliverables

`lib/site-import/map.ts` + tests, `scripts/site_import_map.mjs`, the
`map-report.json` contract, UI report panel on the job page, and this
document kept current.
