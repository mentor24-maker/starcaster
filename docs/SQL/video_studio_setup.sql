-- video_studio_setup.sql
-- The Studio catalog: the two tables every later Phase 1 slice writes to.
-- Loop Queue task 86bbjv681 (Studio Phase 1 · 1 of 8).
--
--   video_sessions  one recording session — a shoot, a talk, a screen capture.
--   video_sources   one media file belonging to a session (a camera angle, a
--                   screen recording, a separate audio take, a reference clip).
--
-- Nothing ingests, probes or renders yet. This file only creates the places
-- those later slices put their rows.
--
-- BOTH tenant columns on BOTH tables (CLAUDE.md landmine 12). lib/projectScope.js
-- decides whether to stamp a tenant by probing the table for project_id AND
-- owner_user_id together; a table carrying only one fails that probe, and
-- scopedInsertRow then silently stops stamping EITHER column. The insert still
-- succeeds and the rows land with no tenant at all. That is how 550 untenanted
-- builder_page_revisions rows shipped on 2026-08-16 without anything erroring.
--
-- project_id is text, never uuid (DOCTRINE 5.13) — project ids in this codebase
-- are slugs like 'delray-beach-tennis-center', not UUIDs.
--
-- RLS on, no policies, matching every table since the 2026-08-17 lockdown
-- (docs/SQL/enable_rls_lockdown.sql). All access goes through the Node server
-- with the Supabase service key, which bypasses RLS, so this is safe and keeps
-- Supabase's security-advisor findings from reopening.
--
-- Idempotent: every statement is `if not exists` or is itself a no-op when
-- already true, so running the whole file twice changes nothing.

-- ── video_sessions ──────────────────────────────────────────────────────────
-- state is deliberately NOT constrained by a check here. The ingest, probe and
-- proxy slices (Studio 4/8-6/8) each add stages to this lifecycle, and a check
-- constraint written today from guesses would cost a migration every time one
-- lands. The vocabulary lives in lib/videoSessionsStore.js instead, where
-- extending it is a one-line change with no schema move. layer_role below IS
-- constrained, because those four values are the data model itself.

create table if not exists public.video_sessions (
  id                       uuid primary key default gen_random_uuid(),
  project_id               text not null,
  owner_user_id            text,
  title                    text not null default '',
  recorded_at              timestamptz,
  state                    text not null default 'new',
  -- The source whose audio is the programme audio — every other source is
  -- synced against it. No foreign key: video_sources.session_id already points
  -- back here, and a second FK the other way is a cycle that makes both tables
  -- undroppable and inserts order-dependent. The store resolves it by id.
  program_audio_source_id  uuid,
  -- 0..1. How sure the sync pass is that the offsets it computed are right.
  sync_confidence          numeric,
  created_at               timestamptz not null default now()
);

create index if not exists idx_video_sessions_project_id
  on public.video_sessions (project_id);
create index if not exists idx_video_sessions_project_recorded_at
  on public.video_sessions (project_id, recorded_at desc);

alter table public.video_sessions enable row level security;

-- ── video_sources ───────────────────────────────────────────────────────────

create table if not exists public.video_sources (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null,
  owner_user_id  text,
  session_id     uuid references public.video_sessions (id) on delete cascade,
  -- What this file IS in the edit, not what device made it:
  --   background  the wide/locked-off shot
  --   subject     the person on camera
  --   plate       a screen recording or other inserted picture
  --   reference   scratch audio, a phone take, anything kept for sync only
  layer_role     text not null default 'reference'
                 check (layer_role in ('background', 'subject', 'plate', 'reference')),
  -- Milliseconds to shift this source to line up with the session's programme
  -- audio. Negative = this source starts earlier than the programme.
  sync_offset_ms integer not null default 0,
  drive_file_id  text,
  -- Content hash of the file's bytes. Unique per project (index below), so the
  -- same footage handed to two projects is two rows, and re-ingesting the same
  -- file into one project is rejected rather than duplicated.
  content_hash   text,
  duration_s     numeric,
  width          integer,
  height         integer,
  fps            numeric,
  codec          text,
  -- Which device lane the file came off (iphone, ipad, macbook, screen, ...),
  -- inferred from container metadata by Studio 5/8. Free text on purpose: a
  -- new device must not need a migration.
  device_lane    text,
  recorded_at    timestamptz,
  state          text not null default 'new',
  local_path     text,
  proxy_path     text,
  created_at     timestamptz not null default now()
);

-- Dedupe is per project, never global (the messaging_topics fossil, 2026-08-10:
-- a global unique let the first project to use a name lock every other project
-- out of it forever). Partial, because content_hash is null until Studio 4/8
-- has actually read the bytes — and in Postgres every null is distinct, so a
-- plain unique index would let unlimited un-hashed rows through anyway; being
-- explicit about it here is cheaper than rediscovering it.
create unique index if not exists idx_video_sources_project_content_hash
  on public.video_sources (project_id, content_hash)
  where content_hash is not null and content_hash <> '';

create index if not exists idx_video_sources_project_id
  on public.video_sources (project_id);
create index if not exists idx_video_sources_session_id
  on public.video_sources (session_id);
create index if not exists idx_video_sources_project_state
  on public.video_sources (project_id, state);

alter table public.video_sources enable row level security;
