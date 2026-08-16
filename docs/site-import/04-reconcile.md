# Site Import — Phase 3: Reconcile (imported pages → hand-built pages)

Written 2026-08-16, measured against the delraytennis import
(`simp_1786047449851_duiqnj`, project `proj_1786047238296_opepjk`).

## Context

Phase 2 turned a captured site into one Builder draft per original URL.
The operator then built a fresh set of pages by hand from the NEW menu —
34 identical scaffolds, each carrying a `PLACEHOLDER SECTION` between its
menu banner and its footer. Phase 3 answers what is left: **which imported
page belongs to which new page, and what content moves across.**

```
lib/site-import/reconcile.ts        pure engine: pages in → { pairings, setAside,
                                    plans, report }   (no I/O, no clock)
scripts/site_import_reconcile.mjs   operator runner: dry-run default, --apply to write
lib/site-import/dist/reconcile.js   generated bundle (build:site-import, gitignored)
scripts/site-import/reconcile.test.js   46 tests, mostly of what it REFUSES to do
```

## The shape of the problem, as measured

| | count |
|---|---|
| imported pages | 95 |
| …real pages, per the ORIGINAL site's menu | 16 |
| …WordPress `tag`/`category`/`author` archives | 27 |
| …blog posts | 40 |
| …orphans the old menu never linked | 11 |
| …home (already rebuilt by hand) | 1 |
| hand-built pages | 36 |
| …eligible (still carrying `PLACEHOLDER SECTION`) | 34 |

Every imported page has the identical three-section shape: the old header,
one `Imported: <Title>` content section, and the old footer image. **Only
the middle section moves.**

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **The original site's menu decides what is a real page.** Everything else is set aside by class with a reason. | Matching before classifying is what makes `/tag/tennis/` score a perfect **1.00** against a real "Tennis" page. A merge that silently pours a tag archive into a client's page is worse than one that does nothing. Same rule as DOCTRINE §5.6. |
| 2 | **Blog posts are found by what the blog and archive listings link to**, not by URL depth. | WordPress serves posts from the site root, so `/some-post/` and `/a-real-page/` are indistinguishable by path. The listings link to posts and to little else. |
| 3 | **A pair applies only at score ≥ `CLEAN_SCORE` (0.6) AND margin ≥ `MIN_MARGIN` (0.15) over the runner-up.** Everything else goes to the review pile with its candidates. | An ambiguous auto-match is worse than no match. `/programs/adult-clinics` → `tennis-drills-clinics` is obvious to a person and scores 0.25; that is a judgment call, not a computation. |
| 4 | **The decisions file outranks every score, in both directions.** | The review pile is a worklist, not a dead end. It is also the permanent record of why each call was made. |
| 5 | **Content replaces the target's `PLACEHOLDER SECTION`**, i.e. between the menu banner and the footer. | A literal append puts the imported content below the footer and copyright. "The end of the page" means the end of the content. |
| 6 | **Chrome is detected by repetition, never by position.** A section signature on ≥50% of imported pages is furniture. | Hardcoding "section 0 and section 2" means a differently-shaped import silently copies its header onto every page. |
| 7 | **The same rule applies INSIDE the prose.** The capture flattens a page into one text module, so the old header block and copyright footer sit in the same module as real content. Whatever every content module starts with, and whatever they all end with, is furniture. | Stripping by pattern would hardcode one WordPress theme's class names. See the traps below — this took four attempts. |
| 8 | **Copied sections lose `savedSectionId`, `canonical` and `locked`; ids are rewritten deterministically.** | Carrying canonical linkage across would enrol the copy in propagation and fan a later edit across the tenant (the 2026-07-21 menu loss). Deterministic ids make a re-run update rather than duplicate. |
| 9 | **`is_published` is never changed, in either direction.** | The tool's job is content, not visibility. |

## Traps this hit, in order

Each of these produced a wrong answer that looked right:

1. **`listPages(scope)` silently returns EVERY project's pages.** The
   signature is `listPages(limit, scope)`. The first survey reported 185
   pages for a project that has none.
2. **The stores return `{ ok, status, data }` envelopes, never the row.**
   Reading `job.status` off the envelope yields `200`, so a complete job
   reads as status "200".
3. **The shared title suffix sinks every real match.** "Court Fees - Delray
   Beach Tennis Center" against "Court Fees" scores 0.33, not 1.00. The
   suffix is detected by repetition and discounted.
4. **Unanimity is too brittle for the prose furniture.** Phase 2 rewrote
   some internal links, so the header exists in two forms diverging 32
   characters in (`/` vs `/imported-home`). A strict common prefix
   collapses to nothing.
5. **A single majority run cannot describe two variants** — they are
   different lengths, so one cut-off strips 58 pages and silently leaves
   the furniture on 41. The engine clusters, then measures each cluster.
6. **Binary-searching the run length must range to the LONGEST text.**
   Capping at the shortest limited the header to 96 characters because one
   stray 113-character module was in the sample.
7. **The home page is in the import map AND is the rebuilt hand-built
   page.** Its 41 new sections outvoted the real captured furniture. It is
   excluded from the furniture sample.
8. **Cutting on any `>` leaves unbalanced markup** — ending a prefix just
   after an opening tag hands the page `Court Fees</h1>`. A prefix ends at
   the last CLOSING tag; a suffix starts at the first OPENING tag.
9. **`module.text` caps at 10,000 characters**, so the footer is often cut
   short. What remains is a PREFIX of the known footer at the end of the
   text, matched at a lower bar because it is checked against a footer
   already proven to repeat.

## Safety

- Dry run by default. The report must reconcile
  (`total === paired + setAside`) or `--apply` refuses.
- Whole-site snapshot before the first write; id printed and recorded on
  `checkpoints.reconcile.snapshotId`.
- Per-page JSON backup to `docs/SQL/backups/reconcile-<jobId>-<stamp>/`.
- Clobber guard: each written section is hash-recorded in
  `checkpoints.reconcile.sectionHashes`. On re-run, a section a human has
  since edited is skipped and reported, never overwritten.
  `--force-section <id>` overrides one at a time.
- All page writes go through `lib/builderPagesStore.js: updatePage`, which
  banks a revision — never raw table writes.

## Rollback

```
POST /api/builder/page-snapshots/<snapshotId>/restore
```
or restore the per-page JSON from `docs/SQL/backups/`.

## Usage

```
doppler run --config prd -- node scripts/site_import_reconcile.mjs --job <id>
doppler run --config prd -- node scripts/site_import_reconcile.mjs --job <id> --apply
```

`--keep-placeholder` leaves the marker above the new content;
`--keep-boilerplate` keeps the furniture; `--decisions <path>` points at a
different decisions file; `--allow-local` permits a localhost database.

## Known residue

A screen-reader-only `<h2 class="genesis-sidebar-title">Primary Sidebar</h2>`
survives on two of the twelve pages. It is invisible on the page and was
not worth over-fitting the detector to remove. All VISIBLE header and
footer chrome is gone from all twelve.

## Result of the first run

12 pages paired automatically, all but one on an exact menu-label match;
83 set aside — of which only **4** are real pages needing a human call
(`/programs`, `/course`, `/events-calendar`, `/programs/adult-clinics`).

---

# Phase 3b: the image top-up (`--images`)

Content reconciliation moves every image the capture put IN the content.
It cannot move what was never there: the old site's gallery and carousels
loaded their pictures with JavaScript, so those images never appeared in
the HTML the capture reads. The crawler downloaded them anyway — there was
simply nowhere in the content flow to put them. That left the Photo Gallery
page with 43 of its photos downloaded and none of them on the page.

No guessing is needed to fix it. The import already recorded, for every
downloaded asset, which original page referenced it
(`app_site_import_assets.referenced_by`). With the Phase 3 pairings that
says exactly which images belong on which new page.

```
lib/site-import/image-topup.ts       pure engine
scripts/site_import_reconcile.mjs    --images (separate, deliberate step)
scripts/site-import/image-topup.test.js   16 tests
```

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **`--images` is a separate flag**, never part of a default run. | It copies files into durable storage and creates asset rows. That is not something a content run should do as a side effect — the same reasoning as the mapper's `--nav`. |
| 2 | **A photo's identity is its filename stem, not its URL.** Size variants (`-768x576`, `-scaled`), resize queries and promotion prefixes all collapse to one photo. | WordPress serves the same picture under four URLs. Comparing URLs is how a gallery ends up with every photo in it three times. On this job it collapsed 476 files. |
| 3 | **Of several size variants, take the largest file.** | It is the original; the rest are derivatives. |
| 4 | **Furniture images are excluded by repetition** — referenced by ≥50% of captured pages. | Same rule as section and prose chrome. 605 excluded here: the logo, social icons, the "powered by" badge. |
| 5 | **≥5 images ⇒ one slideshow; fewer ⇒ individual image modules.** | A gallery's worth of pictures is what the old page WAS; two pictures are easier to move around as separate modules. |
| 6 | **Files are copied into `SiteImportApplied/<projectId>/topup/` before any page references them.** | The capture leaves them in `SiteImport/<jobId>/`, a namespace explicitly designed to be cleaned up. A page must never depend on it (Phase 2 decision 7). |
| 7 | **Every placed image is registered in the Assets library** with tags `site-import`, `image-topup`. | Otherwise it renders but is invisible to the Assets screen and its "Used In" column. |
| 8 | **A per-page cap is reported, never silently applied.** | `report.capped` is part of the accounting identity, so a truncation cannot read as completeness. |

## Accounting

`captured === furniture + sizeVariants + already + capped + planned`, per
page and in total. A run whose numbers do not balance refuses to place
anything.

## Traps

1. **`listAssets` capped at 2,000 rows with no way to page.** This job
   recorded 2,067, so a caller could not tell a complete list from a
   truncated one. It now takes `{ limit, offset }`.
2. **After content lands there are no pairings left.** Filling a page
   consumes its `PLACEHOLDER SECTION`, which makes it ineligible — correct
   for content, useless for a step that works on already-filled pages. The
   pairings are recovered from `reconciledFromPath`, stamped on every
   copied module, and are now also recorded on the job checkpoint.
3. **`--apply` returned early when there was no content to write**, which
   silently skipped `--images` on exactly the re-run where it was wanted.

## Result of the first run

73 images placed across 7 pages (photo-gallery 43, junior-programs 17,
blog 6, four pages with 1–2 each), 45 MB copied. Excluded: 605 furniture,
476 duplicate size variants, 83 already on the page. Verified against the
database: every image in the durable namespace, all 73 reachable, all 73
registered in the Assets library, each block sitting between the page's
content and its footer.
