-- acquire_x_reddit_runs_setup.sql
-- Loop Queue task 86bcug169: the Acquire screen's X and Reddit run history
-- (/api/acquire/x-runs, /api/acquire/reddit-runs) moves off data/*.json and
-- onto these two tables.
--
-- Before this, lib/acquire/XAcquireStore.js and RedditAcquireStore.js wrote
-- data/x_acquire_runs.json and data/reddit_acquire_runs.json. On Vercel that
-- write is skipped without an error (lib/localDataFs.js, CLAUDE.md landmine 6),
-- so every run on the live site answered 201 and was never kept: the history
-- read empty, and opening a run that had just been made answered 404.
--
-- 011_multitenancy_acquire_engage.sql already declared both tables, but was
-- never applied and left out columns the stores write (hashtags; Reddit's
-- sort, source_mode, keyword, time window, limits). This file creates the full
-- shape; the `add column if not exists` lines below cover a database where 011
-- WAS applied first, so either order ends with the same tables.
--
-- BOTH tenant columns on BOTH tables (CLAUDE.md landmine 12). lib/projectScope.js
-- probes for project_id AND owner_user_id together; a table carrying only one
-- fails the probe and scopedInsertRow silently stops stamping EITHER column.
-- project_id is text, never uuid (DOCTRINE 5.13) — project ids are slugs.
--
-- RLS on, no policies, matching every table since the 2026-08-17 lockdown. All
-- access goes through the Node server with the service key, which bypasses RLS.
--
-- updated_at is written by the store, not by a trigger.
--
-- Idempotent: every statement is `if not exists` or a no-op when already true,
-- so running the whole file twice changes nothing. Nothing existing is touched:
-- production has neither table today.

-- ── x_acquire_runs ──────────────────────────────────────────────────────────

create table if not exists public.x_acquire_runs (
  run_id                 text primary key,
  project_id             text,
  owner_user_id          text,
  query                  text not null default '',
  hashtags               jsonb not null default '[]'::jsonb,
  language               text not null default '',
  start_time             text not null default '',
  end_time               text not null default '',
  max_tweets             integer not null default 0,
  max_replies_per_tweet  integer not null default 0,
  include_replies        boolean not null default false,
  request_json           jsonb not null default '{}'::jsonb,
  result_json            jsonb not null default '{}'::jsonb,
  stats                  jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.x_acquire_runs add column if not exists hashtags jsonb not null default '[]'::jsonb;

create index if not exists idx_x_acquire_runs_project_created
  on public.x_acquire_runs (project_id, created_at desc);

alter table public.x_acquire_runs enable row level security;

-- ── reddit_acquire_runs ─────────────────────────────────────────────────────

create table if not exists public.reddit_acquire_runs (
  run_id           text primary key,
  project_id       text,
  owner_user_id    text,
  mode             text not null default '',
  target           text not null default '',
  subreddit        text not null default '',
  post_id          text not null default '',
  sort             text not null default '',
  source_mode      text not null default '',
  keyword          text not null default '',
  start_time       text not null default '',
  end_time         text not null default '',
  include_replies  boolean not null default false,
  max_posts        integer not null default 0,
  max_comments     integer not null default 0,
  request_json     jsonb not null default '{}'::jsonb,
  result_json      jsonb not null default '{}'::jsonb,
  stats            jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.reddit_acquire_runs add column if not exists sort text not null default '';
alter table public.reddit_acquire_runs add column if not exists source_mode text not null default '';
alter table public.reddit_acquire_runs add column if not exists keyword text not null default '';
alter table public.reddit_acquire_runs add column if not exists start_time text not null default '';
alter table public.reddit_acquire_runs add column if not exists end_time text not null default '';
alter table public.reddit_acquire_runs add column if not exists include_replies boolean not null default false;
alter table public.reddit_acquire_runs add column if not exists max_posts integer not null default 0;
alter table public.reddit_acquire_runs add column if not exists max_comments integer not null default 0;

create index if not exists idx_reddit_acquire_runs_project_created
  on public.reddit_acquire_runs (project_id, created_at desc);

alter table public.reddit_acquire_runs enable row level security;
