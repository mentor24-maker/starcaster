-- Site Import — job and asset tables (Phase 1).
--
-- Site Import is an internal Alphire-staff tool: given a client's existing
-- website URL, a worker running on the operator's Mac captures every page,
-- screenshot, and asset so a later phase can rebuild the site in Builder.
-- Spec: docs/site-import/01-capture-and-ir.md (ratified 2026-08-05).
--
-- These tables hold only bookkeeping — status, coverage numbers, URLs.
-- Screenshots, captured HTML, and downloaded assets all live in Vercel Blob
-- under SiteImport/<jobId>/; no binary or large JSON ever passes through
-- Postgres (house doctrine).
--
-- Backed by lib/siteImportStore.js and routes/siteImport.js; the worker is
-- scripts/site_import_worker.mjs (runs off-Vercel — Playwright cannot run
-- there and capture jobs outlive the 300 s function ceiling).
--
-- Apply by hand in the Supabase SQL editor and log the run in
-- docs/Markdown Files/MIGRATIONS_APPLIED.md.

create table if not exists public.app_site_import_jobs (
  id                   text primary key,
  project_id           text not null references public.app_projects(id) on delete cascade,
  owner_user_id        text,
  source_url           text not null,
  status               text not null default 'queued',

  -- Worker lease. No queue infrastructure exists in this codebase; these
  -- columns establish the pattern: claiming = "set claimed_at/claimed_by
  -- where claimed_at is null", first claim wins. Phase 1 runs a single
  -- local worker, so this is forward-provisioning, not contention handling.
  claimed_at           timestamptz,
  claimed_by           text,
  attempts             integer not null default 0,

  -- robots.txt override attribution (ratified decision 4). Null = no
  -- override; the crawl honored robots.txt. When set, it holds the client
  -- name or deal reference supplied via --client-authorized <ref>, so every
  -- override is attributable to a client relationship.
  client_authorization text,

  -- Per-stage checkpoints: { "<stage>": { "at": ..., "blobPath": ..., "notes": ... } }.
  -- Every stage persists its output to Blob before the next begins; this map
  -- is what makes any stage independently re-runnable (--stage <name>).
  checkpoints          jsonb not null default '{}'::jsonb,

  -- Coverage accounting, broken down by element class — shape defined in
  -- lib/site-import/ir.ts (the Coverage type). Any non-empty "dropped" is a
  -- bug and renders as an error state in the UI.
  coverage             jsonb not null default '{}'::jsonb,

  -- Cost tracking: { "browserSeconds": ..., "pagesCaptured": ..., "assetBytes": ... }
  cost                 jsonb not null default '{}'::jsonb,

  error                text not null default '',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  started_at           timestamptz,
  finished_at          timestamptz
);

-- A job stopped cleanly by a cap (max pages, byte budget, …) still ends
-- 'complete' — the partiality is recorded in coverage.caps. 'failed' is
-- reserved for jobs that produced no usable result.
alter table public.app_site_import_jobs
  drop constraint if exists app_site_import_jobs_status_check;
alter table public.app_site_import_jobs
  add constraint app_site_import_jobs_status_check
  check (status in ('queued','capturing','normalizing','extracting','complete','failed'));

-- The only list read path: newest-first for one project.
create index if not exists idx_site_import_jobs_project_created
  on public.app_site_import_jobs (project_id, created_at desc);

-- One row per unique downloaded asset (deduped by sha256 within a job).
-- This is the queryable failure ledger: a download that fails is recorded
-- as status 'failed' with its error — never silently skipped. Nothing here
-- touches the tenant's main assets library; imported files stay in the job's
-- Blob namespace until a human reviews them at mapping time (later phase).
create table if not exists public.app_site_import_assets (
  id            text primary key,
  job_id        text not null references public.app_site_import_jobs(id) on delete cascade,
  project_id    text not null,
  original_url  text not null,
  storage_url   text not null default '',   -- Blob URL once downloaded
  content_hash  text not null default '',   -- sha256; dedupe key within a job
  mime_type     text not null default '',
  byte_size     bigint not null default 0,
  width         integer,                    -- images only
  height        integer,                    -- images only
  alt_text      text not null default '',
  -- [{ "pageUrl": ..., "sourceId": ... }] — every element referencing this
  -- asset, so the mapping phase can re-link pictures to their pages.
  referenced_by jsonb not null default '[]'::jsonb,
  status        text not null default 'pending',
  error         text not null default '',
  created_at    timestamptz not null default now()
);

-- 'skipped_cap' = the per-asset or total byte budget stopped this download;
-- distinct from 'failed' so a partial-but-healthy job reads differently
-- from a broken one.
alter table public.app_site_import_assets
  drop constraint if exists app_site_import_assets_status_check;
alter table public.app_site_import_assets
  add constraint app_site_import_assets_status_check
  check (status in ('pending','downloaded','failed','skipped_cap'));

create index if not exists idx_site_import_assets_job
  on public.app_site_import_assets (job_id, status);
