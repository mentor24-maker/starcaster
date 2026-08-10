-- Theme Wizard — session, candidate, job, and library tables (Phase 1).
--
-- The Theme Wizard replaces the Builder's one-field-at-a-time Themes form with
-- a conversation: it reads a site, proposes three complete looks, and the
-- operator ranks them and says what worked. Round 2 generates variations on the
-- winner. Spec: docs/THEME_WIZARD_SPEC.md (ratified 2026-08-07).
--
-- Backed by lib/themeWizardStore.js and routes/themeWizard.js.
--
-- Two things deliberately DO NOT get their own table here:
--
--   * Apply snapshots reuse public.builder_page_snapshots. Spec §5 allowed
--     either a new table or the existing revert tooling; reusing it means a
--     wizard revert and a manual Builder restore read the same rows and cannot
--     drift apart. The session records which snapshot is its undo point.
--   * Generated themes reuse public.builder_themes. The wizard never invents a
--     storage shape for a theme — applying a candidate writes an ordinary
--     Builder theme, so everything downstream renders it with no special case.
--
-- Apply by hand in the Supabase SQL editor and log the run in
-- docs/Markdown Files/MIGRATIONS_APPLIED.md.

-- ---------------------------------------------------------------------------
-- One row per wizard run.
-- ---------------------------------------------------------------------------
create table if not exists public.theme_wizard_sessions (
  id                   text primary key,
  project_id           text not null references public.app_projects(id) on delete cascade,
  owner_user_id        text,

  -- Where the look is derived from. Phase 1 and 2 ship 'current_pages' only;
  -- the other three arrive in Phase 5 (spec §9).
  seed_type            text not null default 'current_pages'
                         check (seed_type in ('current_pages', 'external_url', 'brand_kit', 'brief')),
  -- The raw seed: the URL, the uploaded asset id, or the typed brief.
  seed_payload         jsonb not null default '{}'::jsonb,
  -- The normalised palette/type/mood that a seed adapter produces. Kept apart
  -- from seed_payload so re-running an adapter never loses the original input.
  style_brief          jsonb not null default '{}'::jsonb,

  -- Which real page candidates render against. Nullable: the wizard falls back
  -- to the project's home page when unset.
  preview_page_id      text,

  -- Values the operator pinned from a winner, which later rounds must not
  -- change (spec §6.4). Shape: { "colors.primary": "#123456", ... }
  locked_values        jsonb not null default '{}'::jsonb,

  round_count          integer not null default 0,
  -- Running tally for the per-project cost metering that is deliberately
  -- deferred (spec §9). Recorded from day one so the throttle has history to
  -- work with whenever it gets built.
  tokens_spent         integer not null default 0,

  status               text not null default 'active'
                         check (status in ('active', 'applied', 'abandoned')),

  -- Set together by apply, and the reason revert is one operation rather than
  -- a search: the candidate that was applied, and the builder_page_snapshots
  -- row captured immediately before it (hazard 4.1).
  applied_candidate_id text,
  apply_snapshot_id    text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists theme_wizard_sessions_project_idx
  on public.theme_wizard_sessions (project_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Three rows per round.
-- ---------------------------------------------------------------------------
create table if not exists public.theme_wizard_candidates (
  id                   text primary key,
  session_id           text not null references public.theme_wizard_sessions(id) on delete cascade,
  -- Denormalised from the session so every tenant-scoped query can filter on
  -- project_id directly, the same as every other scoped table.
  project_id           text not null references public.app_projects(id) on delete cascade,

  round                integer not null default 1,
  slot                 integer not null default 1 check (slot between 1 and 3),

  -- The distinct brief this candidate was told to commit to. Variety has to be
  -- engineered into the prompt rather than sampled, because current models
  -- reject temperature/top_p/top_k and left alone reach for the same warm
  -- cream-and-serif look every time (hazards 4.3 and 4.4). Storing the
  -- direction is what makes a bland round diagnosable after the fact.
  direction            text not null default '',
  -- The model's one-paragraph explanation, shown to the operator.
  rationale            text not null default '',

  -- Colours and typography only, in BuilderTheme shape. The model fills in a
  -- JSON structure the Builder already renders; it never writes CSS.
  theme_patch          jsonb not null default '{}'::jsonb,

  -- The winner this was derived from. Null in round 1.
  parent_candidate_id  text references public.theme_wizard_candidates(id) on delete set null,

  -- Set when the operator ranks the round. Null until then.
  rank                 integer check (rank is null or rank between 1 and 3),
  feedback             text not null default '',

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (session_id, round, slot)
);

create index if not exists theme_wizard_candidates_session_idx
  on public.theme_wizard_candidates (session_id, round, slot);

create index if not exists theme_wizard_candidates_project_idx
  on public.theme_wizard_candidates (project_id);

-- ---------------------------------------------------------------------------
-- Generation jobs.
--
-- Generation cannot run inside the request that asks for it: three model calls
-- plus a possible site capture will outrun the serverless ceiling, and a
-- half-finished run is exactly the 2026-07-22 propagation failure that updated
-- 30 of 50 pages and left the rest stale (hazard 4.2). The request queues a row
-- here and returns a job id; the UI polls it.
-- ---------------------------------------------------------------------------
create table if not exists public.theme_wizard_jobs (
  id                   text primary key,
  session_id           text not null references public.theme_wizard_sessions(id) on delete cascade,
  project_id           text not null references public.app_projects(id) on delete cascade,
  owner_user_id        text,

  type                 text not null default 'generate_round',
  -- What the runner needs to do the work: round number, parent candidate,
  -- locked values as of queue time.
  input                jsonb not null default '{}'::jsonb,

  status               text not null default 'queued'
                         check (status in ('queued', 'running', 'succeeded', 'failed')),
  -- Operator-facing failure text. Empty string, never null, so the UI has no
  -- null branch to get wrong.
  error                text not null default '',

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  started_at           timestamptz,
  finished_at          timestamptz
);

create index if not exists theme_wizard_jobs_session_idx
  on public.theme_wizard_jobs (session_id, created_at desc);

create index if not exists theme_wizard_jobs_status_idx
  on public.theme_wizard_jobs (status, created_at);

-- ---------------------------------------------------------------------------
-- The agency shelf (Phase 6 — table created now so the schema lands in one go).
--
-- DELIBERATELY NOT PROJECT-SCOPED. This is the one exception in the feature:
-- the shelf belongs to Alphire, not to any client. Applying an entry to a
-- project COPIES its values into a new builder_themes row for that project —
-- the library row is never referenced live, so no tenant query ever reaches
-- this table and client separation is preserved (spec §5).
-- ---------------------------------------------------------------------------
create table if not exists public.theme_wizard_library_entries (
  id                   text primary key,
  name                 text not null default '',
  theme_patch          jsonb not null default '{}'::jsonb,

  -- Provenance only. origin_project_id is which client the look was born from;
  -- it is a reference for the operator, never a scoping filter.
  source_session_id    text,
  origin_project_id    text,
  created_by           text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists theme_wizard_library_entries_updated_idx
  on public.theme_wizard_library_entries (updated_at desc);
