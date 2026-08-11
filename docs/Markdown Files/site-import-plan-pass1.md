# Site Import — Plan Review, Pass 1

*From cc-starcaster, 2026-08-05. This is my review of HQ's Phase 0 + Phase 1 plan
after reading the actual Starcaster codebase. HQ's plan is structurally sound —
the "completeness over fidelity" principle and the capture → intermediate format
→ mapping pipeline are exactly right. But it was written without seeing our code,
and the code changes several things.*

---

## The headline: Phase 0 is essentially done, and we already have a "Site Import v0"

HQ's Phase 0 says "read the codebase and answer ten questions, then stop."
I ran that discovery today with three parallel read-only scouts. All ten
questions are answered below. The single biggest finding:

**Starcaster already contains a primitive version of this feature.** The
Acquire section has a crawler (`lib/directAcquire.js`) that walks a site's
pages by following links (seeded from the sitemap — the machine-readable
page list most sites publish), saves each page's HTML and images into a
`direct_acquire_runs` database row, and a Builder endpoint
(`bulk-create-with-model`) that turns a crawl run into real Builder pages
using pluggable "content display models." One model exists today
(`duda-alternating-2col` — built for a previous client site). This was used
for real work already.

So we are not building from zero — we are building the professional version
of something that exists as a prototype. That changes the plan from
"greenfield" to "supersede carefully": reuse the crawl logic, keep the old
path working, build the new pipeline alongside it.

---

## Answers to HQ's ten discovery questions (condensed)

1. **Page data structure.** A Builder page is one row in the
   `builder_landing_page` table; the whole page design lives in a single
   JSON column called `layout_sections`. In code the types are in
   `lib/builder-client/builder-template.ts`: a page holds `sections`, each
   section holds layout/width/background settings plus `modules`, each
   module is `{ id, type, column, name, text, settings }` where `settings`
   is a flat map of strings. Slugs are unique per project, not globally.

2. **Block types.** 52 module types exist (heading, text, image, video,
   button, navigation, table, slider, forms, a whole blog suite, admin-*
   modules, etc.). No props are formally "required" — every module is
   normalized to something valid — but each has fields it needs to render
   meaningfully.

3. **Programmatic write path — YES, three of them.** (This was HQ's
   "critical" question; the answer is a strong yes.)
   - In-process: `lib/builderPagesStore.js` → `createPage()/updatePage()`
     (handles project scoping and document serialization — the preferred path).
   - HTTP: `POST /api/builder/landing-pages` and friends, including the
     existing `bulk-create-with-model` import endpoint.
   - One-off scripts: the Marinoff punch-list scripts write pages directly.
     They established the house safety pattern: **dry-run by default,
     `--apply` to write, JSON backup first, idempotent re-runs.**

4. **Themes.** Token-based typography system (font roles, modular type
   scale, semantic colors) resolved to CSS variables, with per-module inline
   settings that win over tokens. One hard limit: **fonts are a closed list
   of 11 Google fonts.** An imported site's exact fonts mostly won't map;
   nearest-match is the realistic outcome.

5. **Raw-HTML block — already exists.** The `code` module renders sanitized
   raw HTML from `module.text`. This is HQ's "PlaceholderBlock" for free —
   no new module type needed for Phase 1 or even early Phase 2. Caveat: the
   HTML sanitizer (DOMPurify allowlist in
   `lib/builder-client/sanitize-html.ts`) strips `<video>`, `<form>`,
   `<table>`, `<svg>`, `srcset`, inline `<style>`/`<script>` and more.
   Widening it for imported content is a real security decision and the main
   design point when we get to mapping. If we do later add a dedicated
   `site-import-placeholder` module type, it's a known 8-file checklist with
   one non-negotiable command (`npm run build:builder-template` — skipping it
   makes the server silently convert the new type to plain text).

6. **Media storage.** NOT Supabase Storage (used nowhere) and no longer
   Google Drive (legacy fallback only). **Vercel Blob is the live primary
   store** (`ASSET_STORAGE_PROVIDER=vercel_blob`), with
   `lib/blobStorage.js → uploadBufferToBlob()` as the right entry point for
   a worker (no size-capped base64 round-trip). Asset rows live in the
   `assets` table, per-project; Builder modules reference assets **by URL**,
   with an optional asset-id alongside. The "Used In" scan matches by
   normalized URL — so the importer must write the same canonical URL into
   both the asset row and the page JSON, and its extension list needs
   extending to cover PDFs/fonts.

7. **Versioning/drafts.** Pages have `is_published` / `is_private` flags
   (draft = unpublished). Whole-site snapshots exist
   (`builder_page_snapshots` + a restore endpoint). No per-page revision
   history. The import pattern that fits: **snapshot the site first, land
   all imported pages as unpublished drafts.** Rollback = restore + delete
   drafts.

8. **Nav.** Not a first-class object — nav is a `navigation` module whose
   items live as JSON inside the module, and the site's Header/Footer are
   "canonical saved sections": one master row that force-propagates to every
   page on save. **Hard rule from a real incident (the 7/21 Marinoff menu
   loss): any nav the import produces must be written into the saved-section
   master, never onto individual pages,** or the next unrelated header save
   silently reverts it.

9. **Background jobs.** None. One Vercel cron (social publish), everything
   else is browser-triggered with the tab as keep-alive. No queue, no
   claiming worker, no idempotency keys anywhere. We'd be establishing the
   pattern — and Playwright (the headless browser) **cannot run on Vercel**
   (confirmed in-repo; also a 300-second function ceiling). The worker must
   run elsewhere.

10. **Where it lives.** House conventions are clear:
    `routes/siteImport.js` (new small route module — the repo explicitly
    says don't grow the monoliths), `lib/siteImport/` + a
    `lib/siteImportStore.js`, SQL in `docs/SQL/site_import_setup.sql`
    (applied by hand in Supabase, logged in MIGRATIONS_APPLIED.md — there is
    no migrations framework), React admin screen in
    `components/builder/site-import-page.tsx` mounted via
    `builder-react-entry.tsx`. Never `public/js/` (frozen).

---

## Corrections to HQ's Phase 1 (what I'd change and why)

1. **"org id" → `project_id`.** Starcaster scopes everything by project via
   `lib/projectScope.js` and the `x-project-id` header. The jobs table gets
   `project_id` + `owner_user_id` like every other table.

2. **"Supabase storage bucket" → Vercel Blob.** Screenshots, downloaded
   assets, and the captured-site JSON all go to Blob under a
   `SiteImport/<job-id>/...` path prefix. Job row keeps pointers + stats.
   (House doctrine, quoted from an existing migration: binaries never pass
   through Postgres; store the URL.)

3. **"Hosted browser provider" → Playwright on our own machine, behind the
   same interface.** HQ assumed we'd pay a cloud browser service
   (Browserless etc.). Playwright is already a dependency and already used
   for screenshots in this repo. Since the worker has to run off-Vercel
   anyway, local Playwright costs nothing and removes a vendor integration.
   Keep HQ's `CaptureProvider` interface exactly as specified so a hosted
   provider can slot in later if we need scale. Bonus: delraytennis.com is
   WordPress with server-rendered HTML — even a plain fetch captures most of
   it, which makes it an easy first fixture.

4. **"Supabase Realtime status view" → polling.** Realtime is used in
   exactly one place in the app; every other progress UI polls on an
   interval. A `GET /api/site-import/jobs/:id` endpoint polled every few
   seconds is the house style and one less moving part.

5. **Worker runtime, concretely.** Phase 1 worker = a Node process run on
   the operator's machine (`scripts/` + `lib/siteImport/`), following the
   established script conventions: dry-run default, `--apply`, the
   cloud-credentials guard (`doppler run --config prd -- node ...`), refuses
   localhost. It talks to the same Supabase/Blob as production. A hosted
   always-on worker is a later phase, and the jobs table is designed now
   (status + `claimed_at` + `attempts`) so that upgrade is additive.

6. **Two security items HQ couldn't have known:**
   - Tenant project-admins can reach any new `/api/` prefix by default.
     Site Import is Alphire-staff-only → add `/api/site-import` to the
     project-admin deny list in `routes/index.js`.
   - Rate limiting: add a `siteImport.*` key to `lib/rateLimiter.js` LIMITS
     and use the `checkEndpointLimit` idiom exactly (landmine #11 — the
     inverted form kills the endpoint silently).

7. **Two data-loss traps for the eventual mapping phase, worth encoding in
   the IR now:**
   - `module.text` is hard-capped at 10,000 characters (silently truncated
     on load). The IR normalizer should record text length per element so
     the mapper knows when to split.
   - The on-disk page document key is `sections` while in-memory it's
     `layoutSections`, and writes must go through `lib/builder/document.js`
     or several fields get dropped. (Mapping-phase detail; noting it so it
     doesn't get lost.)

8. **Relationship to existing Acquire import:** don't touch the existing
   `direct_acquire` path in Phase 1. Reuse its BFS/sitemap crawl logic where
   convenient. Long-term the new pipeline supersedes it; retirement is its
   own later decision.

Everything else in HQ's Phase 1 stands as written: the IR shape
(Site → Pages → Sections → Elements + assets/taxonomy/rawTokens), coverage
accounting as a first-class job stat, capture at three viewport widths,
dedupe by content hash, failed downloads recorded not skipped, the
never-throw normalizer with malformed-HTML tests, three structurally
different fixture sites including delraytennis.com, and hard caps with clean
partial-result stops.

---

## Decisions — my recommendations (say the word if you disagree)

1. **Run the capture worker on your Mac for Phase 1** (via a doppler-run
   script, same as every other production script). No new server to rent or
   secure yet. Revisit when import volume justifies an always-on worker.
2. **Playwright locally instead of a paid hosted-browser service.** Free,
   already installed, interface-compatible with switching later.
3. **Staff-only:** block tenant admins from `/api/site-import`.
4. **robots.txt:** respect it by default; add an explicit per-job
   `--client-authorized` override, since this is an internal tool used on
   sites whose owners have hired us. (HQ said hard-fail; I think the
   override is justified with the client's authorization on record.)

## Proposed next steps

1. You (and HQ, when quota allows) review this pass. We iterate as needed.
2. On sign-off I open a dedicated worktree/branch `site-import`, write the
   two docs into the repo — `docs/site-import/00-builder-schema.md` (the
   full Phase 0 discovery, expanded from today's scout reports with the
   pasted types) and `docs/site-import/01-capture-and-ir.md` (the corrected
   Phase 1 spec) — and PR them for the record.
3. Then Phase 1 implementation begins on that branch: SQL first, then
   capture provider, then IR + normalizer with fixtures, then asset
   ingestion, then the minimal UI.
