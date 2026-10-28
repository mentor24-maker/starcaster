-- youtube_creators_setup.sql
-- Outreach wizard 15/19 (Loop Queue task 86bcrmbrf): a list of YouTube
-- creators for Dane to approve or reject, the YouTube twin of the Substack
-- Miner's writers (docs/SQL/substack_miner_setup.sql).
--
--   youtube_creators           one row per channel found, however it was
--                              found, and what Dane decided about it.
--   outreach_wizard_settings   one row per project: the keyword list the
--                              wizard's searches use, shared across channels.
--                              Until a project saves its own, the Substack
--                              Miner's keywords stand in (lib/youtubeCreatorsStore.js).
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
-- lib/youtubeCreatorsStore.js, which refuses a bad value by name first.
--
-- Idempotent: every statement is `if not exists`, so running the whole file
-- twice changes nothing.

-- ── youtube_creators ────────────────────────────────────────────────────────

create table if not exists public.youtube_creators (
  id                   uuid primary key default gen_random_uuid(),
  project_id           text not null,
  owner_user_id        text,


  -- YouTube's own channel id ("UC" and 22 more characters). One row per
  -- channel per project: a channel found again is MERGED, never added twice.
  channel_id           text not null,
  channel_url          text not null default '',
  name                 text not null default '',
  description          text not null default '',
  avatar_url           text not null default '',
  -- Null when YouTube hides the count — never a guessed number.
  subscriber_count     bigint,
  -- The newest few uploads as last read: [{ "videoId", "title", "publishedAt" }].
  latest_videos        jsonb not null default '[]'::jsonb,

  -- Every keyword of Dane's this channel has matched, across every search.
  keywords_hit         jsonb not null default '[]'::jsonb,
  -- How it was FIRST found. A later find adds keywords but does not rewrite this.
  found_via            text not null default 'keyword_search'
                       check (found_via in ('keyword_search', 'acquire_results', 'hand_added')),
  last_seen_at         timestamptz not null default now(),

  status               text not null default 'candidate'
                       check (status in ('candidate', 'approved', 'rejected')),
  -- The short reasons he ticked when he decided, and his one sentence.
  decision_reasons     jsonb not null default '[]'::jsonb,
  note                 text not null default '',
  -- What the suggestion pass guessed he would decide (lib/acquire/SubstackSuggestRun.js):
  -- { "action", "reasons", "confidence", "why", "basedOn", "model", "suggestedAt" }.
  -- Null: not suggested yet. Agree copies it into status and decision_reasons.
  suggestion           jsonb,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists idx_youtube_creators_project_channel
  on public.youtube_creators (project_id, channel_id);

create index if not exists idx_youtube_creators_project_status
  on public.youtube_creators (project_id, status);

alter table public.youtube_creators enable row level security;

-- ── outreach_wizard_settings ────────────────────────────────────────────────

create table if not exists public.outreach_wizard_settings (
  id                   uuid primary key default gen_random_uuid(),
  project_id           text not null,
  owner_user_id        text,


  -- The words and phrases the wizard's creator searches look for.
  keywords             jsonb not null default '[]'::jsonb,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists idx_outreach_wizard_settings_project
  on public.outreach_wizard_settings (project_id);

alter table public.outreach_wizard_settings enable row level security;
