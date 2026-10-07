-- youtube_outreach_setup.sql
-- YouTube outreach 1/7 (Loop Queue task 86bcda5vb): somewhere to keep the
-- videos the outreach agent should comment on, and the account-wide limits it
-- must respect.
--
--   youtube_outreach_targets   one row per target video, each with its own
--                              comment settings (Dane's decisions, 2026-10-05).
--   youtube_outreach_settings  one row per project and posting account: daily
--                              cap, spacing, active hours, avoid lists, voice.
--
-- Nothing drafts, schedules or posts a comment yet. The screen is ticket 2/7;
-- drafting is 4/7; posting is 5/7. This file only creates the places they read.
--
-- `account_key` names the YouTube account a row belongs to. Dane of Earth is the
-- first ('dane_of_earth'); Rich's account for Delray comes later and gets its
-- own settings row rather than a schema change.
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
-- lib/youtubeOutreachStore.js, which refuses a bad value with a message naming
-- the field before the database ever sees it. Number ranges (a negative repeat
-- count, an hour past 23) are the store's job only: the test fake that reads
-- this file implements the `in (...)` form and refuses any other, and the store
-- is what has to name the field anyway.
--
-- updated_at is written by the store on every change, not by a trigger.
--
-- Idempotent: every statement is `if not exists` or a no-op when already true,
-- so running the whole file twice changes nothing.

-- ── youtube_outreach_targets ────────────────────────────────────────────────

create table if not exists public.youtube_outreach_targets (
  id                   uuid primary key default gen_random_uuid(),
  project_id           text not null,
  owner_user_id        text,
  account_key          text not null default 'dane_of_earth',

  -- The video, and what YouTube said about it when the target was added.
  -- details_error says why the details are blank when the fetch failed, so an
  -- empty title reads as "YouTube did not answer", not as a broken row.
  video_url            text not null,
  video_id             text not null,
  video_title          text not null default '',
  channel_name         text not null default '',
  channel_id           text not null default '',
  published_at         timestamptz,
  view_count           bigint,
  details_fetched_at   timestamptz,
  details_error        text not null default '',

  -- How the target got on the list. Only 'manual' is used for now.
  source               text not null default 'manual'
                       check (source in ('manual', 'search', 'own_channel')),
  objective            text not null default 'join_conversation'
                       check (objective in ('join_conversation', 'awareness', 'drive_link', 'appreciation', 'answer_question')),
  comment_placement    text not null default 'top_level'
                       check (comment_placement in ('top_level', 'reply_top_comment', 'reply_specific')),
  -- The YouTube comment id to reply to, when placement is 'reply_specific'.
  reply_to_comment_id  text not null default '',
  -- Several allowed: insight, question, story, appreciation, mention_work.
  -- No database default: the store always writes it (default insight +
  -- question), and the test fake cannot read a comma inside a default.
  message_types        text[] not null,
  comment_length       text not null default 'medium'
                       check (comment_length in ('short', 'medium', 'long')),
  link_policy          text not null default 'never'
                       check (link_policy in ('never', 'if_natural', 'allowed')),
  link_url             text not null default '',
  mention_policy       text not null default 'never'
                       check (mention_policy in ('never', 'subtle', 'open')),

  -- One-off or repeat. When repeating: every N days, at most N times, and an
  -- optional stop date. All three are null on a one-off target.
  repeat_mode          text not null default 'once'
                       check (repeat_mode in ('once', 'repeat')),
  repeat_every_days    integer,
  repeat_max_times     integer,
  repeat_until         date,

  priority             text not null default 'normal'
                       check (priority in ('high', 'normal', 'low')),
  notes                text not null default '',
  status               text not null default 'active'
                       check (status in ('active', 'paused', 'done')),

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_youtube_outreach_targets_project_id
  on public.youtube_outreach_targets (project_id);

-- One video appears on one account's list once. Adding it again is refused
-- (the store answers 409 naming the video) rather than making a duplicate the
-- agent would comment on twice.
create unique index if not exists idx_youtube_outreach_targets_project_account_video
  on public.youtube_outreach_targets (project_id, account_key, video_id);

alter table public.youtube_outreach_targets enable row level security;

-- ── youtube_outreach_settings ───────────────────────────────────────────────

create table if not exists public.youtube_outreach_settings (
  id                      uuid primary key default gen_random_uuid(),
  project_id              text not null,
  owner_user_id           text,
  account_key             text not null default 'dane_of_earth',

  max_comments_per_day    integer not null default 10,
  -- At least this many minutes between any two comments, plus up to
  -- jitter_minutes of random extra so the spacing is not a visible clock.
  min_minutes_between     integer not null default 45,
  jitter_minutes          integer not null default 15,
  -- Comments only go out between these hours (0-23, start inclusive, end
  -- exclusive), in time_zone. A blank time_zone means the project's own.
  active_start_hour       integer not null default 8,
  active_end_hour         integer not null default 22,
  time_zone               text not null default '',
  -- Never comment twice on one video unless that target is set to repeat.
  one_comment_per_video   boolean not null default true,
  avoid_channels          text[] not null default '{}',
  avoid_words             text[] not null default '{}',
  -- How the account sounds, in plain words, for the drafting step (4/7).
  voice                   text not null default '',

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists idx_youtube_outreach_settings_project_account
  on public.youtube_outreach_settings (project_id, account_key);

alter table public.youtube_outreach_settings enable row level security;
