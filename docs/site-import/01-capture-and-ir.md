# Site Import — Phase 1 Functional Spec: Capture, IR, Assets

Status: **ratified 2026-08-05** (HQ draft, corrected against the codebase
in pass 1, amendments approved by the operator). Prerequisite reading:
`00-builder-schema.md` (Phase 0 discovery — the platform facts this spec
depends on).

## Context

Site Import is an **internal Starcaster tool**, not a customer-facing
product. Given a client's existing website URL, it captures all content,
assets, taxonomy, and theme information so a later phase can reconstruct
it in Builder in approximately the original order — a starting scaffold
for a redesign, not a faithful clone.

**Governing principle: COMPLETENESS OVER FIDELITY.** Nothing from the
source may be silently dropped. Anything that can't map to a real Builder
module later becomes a placeholder carrying a screenshot, a description,
and the original HTML. Approximate layout is fine. Lost content is not.

The accuracy bar is deliberately low — a human reviews and redesigns
every import. Optimize for never crashing and never losing data, not for
visual matching.

## Ratified decisions and changes from the HQ draft

| # | Decision |
|---|---|
| 1 | Worker runs on the operator's Mac as a doppler-run Node process. The incoming Mac mini (M4/16GB) becomes its natural home — **design nothing that assumes a specific machine.** No hosted worker in this phase. |
| 2 | Capture uses **local Playwright** behind the `CaptureProvider` interface (already a repo dependency; the worker is off-Vercel anyway). A hosted browser provider can slot in later without touching downstream code. |
| 3 | **Staff-only**: `/api/site-import` is added to `PROJECT_ADMIN_SESSION_DENY_PREFIXES` so tenant project-admin sessions cannot reach it. |
| 4 | robots.txt is **respected by default**; a per-job override exists but `--client-authorized <ref>` **takes a required value** (client name or deal reference) recorded on the job row. Every override is attributable. |
| — | Storage is **Vercel Blob** (not Supabase Storage — unused in this codebase; not Google Drive — legacy fallback). |
| — | Job scoping is **`project_id`** (+ `owner_user_id`), not "org id". |
| — | Status UI **polls**; no Supabase Realtime. |
| — | The existing `direct_acquire` path is untouched; its BFS/sitemap crawl logic may be reused. Long-term supersession is a later decision. |

## Out of scope for Phase 1 (hard constraints)

- No Builder mapping. No writes to `builder_landing_page`,
  `builder_saved_sections`, or any Builder table.
- No section-type inference (`section.type` stays `"unknown"`).
- No LLM/vision calls.
- No changes to the HTML sanitizer allowlist.
- Every stage persists its output to storage before the next begins, so
  any stage is independently re-runnable.
- Comment any non-obvious architectural choice.

---

## 1a. Job infrastructure

### Schema — `docs/SQL/site_import_setup.sql`

Applied by hand in the Supabase SQL editor, logged in
`docs/Markdown Files/MIGRATIONS_APPLIED.md`, header comments in the style
of `project_support_requests.sql`. Sketch (implementer refines):

```sql
create table if not exists public.app_site_import_jobs (
  id                   text primary key,
  project_id           text not null references public.app_projects(id) on delete cascade,
  owner_user_id        text,
  source_url           text not null,
  status               text not null default 'queued',
  -- Worker lease. No queue infra exists in this codebase (Phase 0 §9);
  -- these columns establish the pattern: claim = set claimed_at/claimed_by
  -- where claimed_at is null. Single local worker in Phase 1, so this is
  -- forward-provisioning, not contention handling.
  claimed_at           timestamptz,
  claimed_by           text,
  attempts             integer not null default 0,
  -- Decision 4: robots.txt override attribution. Null = no override.
  -- When set, holds the client name or deal reference supplied via
  -- --client-authorized <ref>. Every override is attributable.
  client_authorization text,
  -- Per-stage checkpoints: { "<stage>": { at, blobPath, notes } }
  checkpoints          jsonb not null default '{}'::jsonb,
  -- Coverage accounting incl. per-element-class counts (amendment C) —
  -- shape defined in §1c.
  coverage             jsonb not null default '{}'::jsonb,
  -- Cost tracking: { browserSeconds, pagesCaptured, assetBytes, ... }
  cost                 jsonb not null default '{}'::jsonb,
  error                text not null default '',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  started_at           timestamptz,
  finished_at          timestamptz
);

alter table public.app_site_import_jobs
  drop constraint if exists app_site_import_jobs_status_check;
alter table public.app_site_import_jobs
  add constraint app_site_import_jobs_status_check
  check (status in ('queued','capturing','normalizing','extracting','complete','failed'));

create index if not exists idx_site_import_jobs_project_created
  on public.app_site_import_jobs (project_id, created_at desc);

-- Per-asset rows: queryable failure accounting (failed downloads are
-- recorded, never silently skipped) and the dedupe ledger.
create table if not exists public.app_site_import_assets (
  id            text primary key,
  job_id        text not null references public.app_site_import_jobs(id) on delete cascade,
  project_id    text not null,
  original_url  text not null,
  storage_url   text not null default '',   -- Blob URL once downloaded
  content_hash  text not null default '',   -- sha256; dedupe key within a job
  mime_type     text not null default '',
  byte_size     bigint not null default 0,
  width         integer,
  height        integer,
  alt_text      text not null default '',
  -- [{ pageUrl, sourceId }] — every element referencing this asset
  referenced_by jsonb not null default '[]'::jsonb,
  status        text not null default 'pending',
  error         text not null default '',
  created_at    timestamptz not null default now()
);
alter table public.app_site_import_assets
  drop constraint if exists app_site_import_assets_status_check;
alter table public.app_site_import_assets
  add constraint app_site_import_assets_status_check
  check (status in ('pending','downloaded','failed','skipped_cap'));
create index if not exists idx_site_import_assets_job
  on public.app_site_import_assets (job_id, status);
```

Caps stopping a job cleanly still end in `complete` — partiality is
recorded in `coverage.caps` (see §1c), not a separate status. `failed` is
reserved for jobs that produced no usable result.

### Storage layout — Vercel Blob

Binaries and large JSON never pass through Postgres (house doctrine).
Everything for a job lives under one Blob prefix via
`uploadBufferToBlob()` (`lib/blobStorage.js`):

```
SiteImport/<jobId>/capture/<pageSlug>.<viewport>.json   raw CaptureResult
SiteImport/<jobId>/shots/<pageSlug>.<viewport>.full.png
SiteImport/<jobId>/shots/<pageSlug>.<viewport>.s<idx>.png     per-section
SiteImport/<jobId>/shots/<pageSlug>.<viewport>.e<sourceId>.png  per-element (§1b)
SiteImport/<jobId>/assets/<hash>.<ext>                  downloaded assets
SiteImport/<jobId>/ir.json                              the emitted IR
```

The job row's `checkpoints` maps each stage to its Blob path, which is
what makes stages independently re-runnable.

### Worker

`scripts/site_import_worker.mjs` + engine code in `lib/site-import/`.
Runs **off-Vercel** on the operator's machine (Decision 1), following the
house script conventions (Phase 0 §9): cloud-credentials guard that
refuses localhost and instructs
`doppler run --config prd -- node scripts/site_import_worker.mjs`, env
resolution tolerant of worktrees, plain-English header comment. The
worker only writes `app_site_import_*` tables and the job's Blob
namespace — it never touches Builder data, so no `--apply` gate is
needed; the localhost guard still applies.

Modes:

```
... site_import_worker.mjs --job <id>          run one specific job
... site_import_worker.mjs --watch             claim queued jobs in a loop
... site_import_worker.mjs --stage capture --job <id>   re-run one stage
```

Claiming: `update ... set claimed_at = now(), claimed_by = <host:pid>,
attempts = attempts + 1 where id = ? and claimed_at is null` — first
claim wins; a `--reclaim-stale <minutes>` flag frees abandoned claims.

### Hard caps

All configurable per job, with defaults; the job stops cleanly at any cap
and reports partial results in `coverage.caps`:

| Cap | Default |
|---|---|
| Max pages | 60 |
| Max crawl depth | 4 |
| Max browser-seconds (total) | 900 |
| Max total asset bytes | 500 MB |
| Max single asset bytes | 50 MB |
| Per-page capture timeout | 60 s |

---

## 1b. Capture layer

### CaptureProvider interface

One interface; all downstream code sees only this. Phase 1 ships the
Playwright implementation (`lib/site-import/capture-playwright.ts`).
Adding a hosted provider later = implement the same interface and switch
by config.

```ts
export type CaptureOptions = {
  viewport: { width: number; height: number; label: "desktop" | "tablet" | "mobile" };
  timeoutMs: number;
  userAgent: string;      // "StarCaster-SiteImport/1.0 (+https://starcaster.pro)"
};

export interface CaptureProvider {
  capture(url: string, opts: CaptureOptions): Promise<CaptureResult>;
  close(): Promise<void>;
}
```

### CaptureResult contents

- Rendered HTML (post-JavaScript, serialized DOM).
- Computed styles for all visible elements (compacted — see §1c).
- Full-page screenshot.
- Per-top-level-section screenshots.
- **Per-element screenshot crops (amendment A)** for every element whose
  root tag the Builder embed sanitizer strips — at minimum `form`,
  `video`, `table`, `iframe`/embed, plus `svg`, `canvas`, `audio`.
  Rationale: for exactly these elements the raw HTML cannot survive the
  `code` module's sanitizer, so the screenshot is the placeholder's
  primary payload in the mapping phase. Crops are keyed by the element's
  `sourceId` (§1c).
- Asset URL manifest: every image (including CSS background images and
  `srcset` candidates), PDF, video, and font URL observed.
- Detected font families (computed `font-family` values with usage
  counts).
- Page metadata: title, meta description, og tags, canonical URL, lang.

### Capture procedure

- Viewports: **1440 / 768 / 390 px** per page. Full capture at 1440;
  768/390 capture rendered HTML + full-page screenshot (element-level
  duplication across viewports is not required in Phase 1).
- Crawl: same-registrable-domain BFS seeded from the sitemap when
  present (reuse/port the logic of `lib/directAcquire.js`), depth- and
  page-capped, URL-normalized dedupe (strip fragments and tracking
  params).
- robots.txt (Decision 4): fetched and honored by default — a disallowed
  job fails with a clear message naming the blocking rule. With
  `--client-authorized <ref>` the worker proceeds, stamps
  `client_authorization = <ref>` on the job row, and logs the override.
  The flag without a value is an error.
- Politeness: serial page fetches with a small delay; identifying
  user-agent as above.

---

## 1c. Site IR (intermediate representation)

### The contract

Versioned TypeScript types in **one file**:
`lib/site-import/ir.ts`, with `irVersion` on the root (start `"1.0"`).
This file is the contract everything downstream depends on — design
deliberately, comment thoroughly, and treat changes as versioned events.
It must be covered by `npm run typecheck`.

Shape (types abbreviated here; the real file is exhaustive):

```
SiteIR {
  irVersion, jobId, sourceUrl, capturedAt,
  pages: PageIR[],
  assets: AssetRef[],          // mirrors app_site_import_assets
  taxonomy: {                  // nav trees, breadcrumb trails, sitemap order
    navs: NavTree[], pageOrder: string[]
  },
  rawTokens: {                 // every observed value with occurrence counts
    colors:    { value, count }[],
    fontSizes: { value, count }[],
    fontFamilies: { value, count }[],
    spacing:   { value, count }[]
  }
}

PageIR {
  url, path, title, metaDescription, ogTags, canonicalUrl, lang,
  sections: SectionIR[],
  screenshots: { desktop, tablet, mobile }   // Blob paths
}

SectionIR {
  sourceId,
  type: "unknown",             // NO classification in this phase
  screenshot,                  // Blob path (1440px crop)
  elements: ElementIR[]
}

ElementIR {
  sourceId,                    // stable within the job: <pageIdx>-<domPath-hash>
  class: "text" | "heading" | "image" | "link" | "button" | "form"
       | "video" | "embed" | "table" | "other",
  html,                        // original outer HTML, verbatim
  textContent,
  textLength,                  // REQUIRED — Builder's module.text caps at
                               // 10,000 chars; the mapper needs this to
                               // know when to split (invariant iii)
  computedStyles,              // compacted
  documentPosition,            // index in normalized flow
  depth,                       // original nesting depth
  screenshot?,                 // Blob path — present for sanitizer-stripped
                               // classes (amendment A)
  assetRefs: string[]          // AssetRef ids this element references
}
```

Every element carries a stable `sourceId`, its original HTML, computed
styles, document position, and nesting depth — nothing is discarded.

### Normalizer — `lib/site-import/normalize.ts`

`CaptureResult → IR`, pure function, no I/O.

- Strip layout-only wrapper divs (no text, no media, single child, no
  visual styling of its own).
- Compact computed styles: keep a curated property set (typography,
  color, background, border, spacing, display/position essentials); drop
  browser defaults.
- Classify elements into the `ElementIR.class` set above.
  **Classification is per-element mechanics (tag/role-based), not
  section-type inference** — `section.type` stays `"unknown"`.
- Split each page into top-level candidate sections (direct children of
  `body`/`main` after wrapper-stripping, merged by visual-band
  heuristics; approximate is fine).
- **Never throw.** Unknown or pathological constructs degrade to
  `class: "other"` with raw HTML preserved. There is a test that feeds it
  deliberately malformed HTML (§ Testing).

### Coverage accounting (amendment C)

Counted twice — once in the raw capture, once in the emitted IR — and
stored on the job row as `coverage`, **broken down by element class, not
just totals**, so we can see *what kind* of content is at risk, not just
how much:

```json
{
  "captured": { "text": 412, "heading": 96, "image": 88, "link": 240,
                "button": 31, "form": 6, "video": 2, "embed": 4,
                "table": 3, "other": 17 },
  "emitted":  { "text": 412, "heading": 96, "image": 88, "link": 240,
                "button": 31, "form": 6, "video": 2, "embed": 4,
                "table": 3, "other": 17 },
  "dropped":  {},
  "pages":    { "discovered": 19, "captured": 19, "failed": 0 },
  "caps":     { "hit": [] }
}
```

**Any non-empty `dropped` is a bug** and must be loudly visible in the UI
and the worker log. Counting methodology (what constitutes one countable
text node/image/link) is defined once, in a comment block in `ir.ts`, and
used by both counters.

---

## 1d. Asset ingestion

- Download every referenced image, PDF, video, and font into
  `SiteImport/<jobId>/assets/` via `uploadBufferToBlob()`.
- One `app_site_import_assets` row per unique asset: original URL,
  storage URL, mime, dimensions (images), byte size, alt text, and
  `referenced_by` (every page/element `sourceId` that uses it).
- Deduplicate by sha256 content hash within the job.
- **Failed downloads are recorded as `status: 'failed'` with the error,
  never silently skipped.** Cap-skipped assets are `skipped_cap`.
- Phase 1 does **not** create rows in the main `assets` library —
  imported files stay in the job namespace so unreviewed material never
  pollutes the tenant's asset picker. Promotion into the library happens
  at mapping time (later phase), which is also when the "Used In"
  URL-matching and `MEDIA_EXT_RE` extension for PDFs/fonts become
  relevant (Phase 0 §6).

---

## 1e. Minimal UI

React only (`public/js/` is frozen; the one accepted exception is the
few-line mount wiring every React screen already uses).

- `components/builder/site-import-page.tsx`; mount/unmount exported as
  `window.SiteImportReact` from `builder-react-entry.tsx`; host div in
  the appropriate `src/pages/*.html` (then `npm run build:html` +
  `npm run build:builder` + asset pinning via the normal build).
- URL submission form → `POST /api/site-import/jobs`
  (validates URL, creates a `queued` job; the worker is started by the
  operator — the UI says so plainly).
- Job status view: **poll** `GET /api/site-import/jobs/:id` every 5 s
  while the page is visible (house pattern; no Realtime).
- On completion: coverage report (per-class captured/emitted/dropped
  table — dropped ≠ 0 rendered as an error state), captured screenshots,
  asset gallery with failure list, and a raw IR JSON viewer (fetches
  `ir.json` from Blob). No Builder integration this phase.

### API surface (`routes/siteImport.js`)

| Endpoint | Purpose |
|---|---|
| `POST /api/site-import/jobs` | create job (`{ sourceUrl, caps?, clientAuthorization? }`) |
| `GET /api/site-import/jobs` | list jobs for the active project |
| `GET /api/site-import/jobs/:id` | job status + coverage + checkpoints |
| `GET /api/site-import/jobs/:id/assets` | asset manifest incl. failures |
| `POST /api/site-import/jobs/:id/cancel` | mark for cancellation (worker checks between stages) |

Conventions (all from Phase 0 §10): `{ handle, manifest }` route module
registered in `ROUTE_MODULES`; `sendOk`/`sendErr` envelope; scope via
`requestProjectScope(req)`; `/api/site-import` added to
`PROJECT_ADMIN_SESSION_DENY_PREFIXES` (Decision 3); new
`siteImport.jobs` key in `lib/rateLimiter.js` `LIMITS` used as
`if (checkEndpointLimit(req, res, 'siteImport.jobs')) return true;`
(landmine #11 — never invert).

---

## Invariants for later phases

Recorded now so the mapping phase inherits them verbatim:

1. **Imported nav writes to the saved-section master, never per-page.**
2. **Snapshot the site before import; land all pages as unpublished
   drafts.**
3. **`module.text` has a 10k cap — the IR records text length per
   element** so the mapper knows when to split.
4. **All page writes go through `lib/builder/document.js`.**

---

## Testing

- Snapshot tests for the normalizer against **three saved CaptureResult
  fixtures** from structurally different sites:
  1. WordPress, server-rendered — **delraytennis.com** (the launch
     client; confirmed WordPress with real content in the markup).
  2. A modern JS-framework site (content assembled client-side).
  3. An older table/float-layout site.
  Fixtures are captured once with the real provider, then committed as
  JSON under `scripts/site-import/fixtures/` so tests run offline.
- **The normalizer must NEVER throw.** A dedicated test feeds it
  deliberately malformed HTML (unclosed tags, mis-nesting, exotic
  entities, 10 MB single node) and asserts degradation to `other`
  elements with raw HTML preserved.
- Coverage-accounting test: for each fixture, `dropped` is empty; a
  mutation test that removes an element from the IR asserts the counter
  catches it.
- Runner: `node --test` via a new `npm run test:site-import`, mirroring
  `test:builder`. TS build for worker/normalizer follows the repo's
  esbuild pattern; any generated bundle is gitignored and registered in
  the CLAUDE.md generated-files table with its rebuild command.

## Definition of done for Phase 1

1. `npm run typecheck` passes (IR types included).
2. `npm run test:site-import` passes (three fixtures + malformed-HTML +
   coverage tests); `npm run test:builder-ui` passes if UI touched.
3. All rebuild commands for touched generated artifacts run.
4. `node scripts/check_conventions.cjs` passes.
5. A real end-to-end run against delraytennis.com from the operator's
   Mac completes with `dropped` empty, and the coverage report, screens,
   assets, and IR are visible in the UI.
6. This doc updated with any deviations discovered during implementation.

## Deliverables

Working code per the file map in Phase 0 §10, plus this document kept
current: the IR schema, the CaptureProvider contract, the coverage
metric definition, and how to run the worker locally
(`doppler run --config prd -- node scripts/site_import_worker.mjs ...`).
