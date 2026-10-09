-- substack_miner_setup.sql
-- Substack Miner 1/7 (Loop Queue task 86bcfprx5): somewhere to keep the
-- Substack writers Starcaster finds for Dane, and the keywords it searches on.
-- The Substack twin of the YouTube Miner.
--
--   substack_candidates      one row per writer found (a Substack publication),
--                            however it was found, and what Dane decided.
--   substack_miner_settings  one row per project: the keyword list and how
--                            gently the later slices fetch.
--
-- Nothing searches or fetches anything yet. Web search is 2/7, recommendations
-- 3/7, the approval screen 4/7, Notes 5/7-6/7. This file only creates the
-- places they write. The contact side (people.substack and the
-- `substack_miner` contact source) is docs/SQL/people_add_substack_column.sql.
--
-- BOTH tenant columns on BOTH tables (CLAUDE.md landmine 12). lib/projectScope.js
-- probes for project_id AND owner_user_id together; a table carrying only one
-- fails the probe and scopedInsertRow silently stops stamping EITHER column.
-- project_id is text, never uuid (DOCTRINE 5.13) — project ids are slugs.
--
-- RLS on, no policies, matching every table since the 2026-08-17 lockdown. All
-- access goes through the Node server with the service key, which bypasses RLS.
--
-- Choice lists are `check (col in (...))` here AND validated in
-- lib/substackMinerStore.js, which refuses a bad value with a message naming
-- the field before the database ever sees it. Which status may follow which,
-- and how a writer found twice is merged, are the store's job only.
--
-- updated_at is written by the store on every change, not by a trigger.
--
-- Idempotent: every statement is `if not exists` or a no-op when already true,
-- so running the whole file twice changes nothing.

-- ── substack_candidates ─────────────────────────────────────────────────────

create table if not exists public.substack_candidates (
  id                   uuid primary key default gen_random_uuid(),
  project_id           text not null,
  owner_user_id        text,

  -- The part before `.substack.com`, lowercase. One row per handle per
  -- project: a writer found again is MERGED into the row, never added twice.
  handle               text not null,
  -- Usually https://<handle>.substack.com; a custom domain when it has one.
  publication_url      text not null default '',
  name                 text not null default '',
  description          text not null default '',
  -- The "1,000 subscribers" wording exactly as Substack shows it. Blank when
  -- unknown — never a guessed number.
  subscriber_text      text not null default '',

  -- Every keyword of Dane's this writer has matched, across every search.
  keywords_hit         jsonb not null default '[]'::jsonb,
  -- How it was FIRST found. A later find adds keywords or recommenders but
  -- does not rewrite this.
  found_via            text not null default 'seed'
                       check (found_via in ('seed', 'web_search', 'recommendations', 'notes_search')),
  -- Handles of approved writers who recommend this one.
  recommended_by       jsonb not null default '[]'::jsonb,
  last_seen_at         timestamptz not null default now(),

  status               text not null default 'candidate'
                       check (status in ('candidate', 'approved', 'rejected')),
  -- The contact made when Dane approved it (slice 4/7 makes it).
  contact_id           text not null default '',
  -- Dane's one line about this writer.
  note                 text not null default '',

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists idx_substack_candidates_project_handle
  on public.substack_candidates (project_id, handle);

create index if not exists idx_substack_candidates_project_status
  on public.substack_candidates (project_id, status);

alter table public.substack_candidates enable row level security;

-- ── substack_miner_settings ─────────────────────────────────────────────────

create table if not exists public.substack_miner_settings (
  id                         uuid primary key default gen_random_uuid(),
  project_id                 text not null,
  owner_user_id              text,

  -- The words and phrases the searches look for.
  keywords                   jsonb not null default '[]'::jsonb,
  -- How many writers one keyword's search may bring back.
  max_results_per_keyword    integer not null default 20,
  -- How long to wait between two fetches of anybody's page, so the later
  -- slices read Substack at a polite pace.
  pause_ms_between_fetches   integer not null default 1500,

  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create unique index if not exists idx_substack_miner_settings_project
  on public.substack_miner_settings (project_id);

alter table public.substack_miner_settings enable row level security;
