-- youtube_outreach_comments_setup.sql
-- YouTube outreach 4/7 (Loop Queue task 86bcda661): one row per comment the
-- outreach agent writes for a target video, from first draft to (later) posted.
--
--   draft  -> approved | rejected            this ticket: Dane decides
--   approved -> posting -> posted | failed   ticket 5/7: the Mini posts it
--
-- Dane's decision (2026-10-05): every comment waits for his approval, for now.
-- Nothing here posts anything; the posting columns are created now so ticket 5
-- adds code, not a second migration.
--
-- Requires docs/SQL/youtube_outreach_setup.sql (the targets table) first.
--
-- `target_id` CASCADES on delete, on purpose. Removing a video from the list
-- must also remove any comment approved for it and not yet posted — otherwise
-- the poster in ticket 5 would still post a comment on a video Dane had taken
-- off the list. The screen's delete prompt says the drafts go with it.
--
-- The video's id, title and channel are COPIED onto each row when it is
-- drafted, and so are the settings the draft followed (`followed`), so a row
-- still says what it was written for after the target's settings change.
--
-- BOTH tenant columns (CLAUDE.md landmine 12) — lib/projectScope.js probes for
-- project_id AND owner_user_id together, and a table carrying only one makes
-- scopedInsertRow silently stamp NEITHER. project_id is text, never uuid
-- (DOCTRINE 5.13). RLS on with no policies, like every table since the
-- 2026-08-17 lockdown; the Node server reads it with the service key.
--
-- updated_at is written by the store on every change, not by a trigger.
--
-- Idempotent: every statement is `if not exists`, so running the whole file
-- twice changes nothing.

create table if not exists public.youtube_outreach_comments (
  id                 uuid primary key default gen_random_uuid(),
  project_id         text not null,
  owner_user_id      text,
  account_key        text not null default 'dane_of_earth',
  target_id          uuid not null references public.youtube_outreach_targets (id) on delete cascade,

  -- What it was written for, copied at draft time.
  video_id           text not null default '',
  video_title        text not null default '',
  channel_name       text not null default '',
  followed           jsonb not null default '{}'::jsonb,

  -- The words. draft_text is what the agent wrote and is never changed;
  -- final_text is what Dane approved, with any edit he made.
  draft_text         text not null,
  final_text         text not null default '',

  status             text not null default 'draft'
                     check (status in ('draft', 'approved', 'rejected', 'posting', 'posted', 'failed')),
  approved_by        text not null default '',
  approved_at        timestamptz,
  rejected_at        timestamptz,

  -- Ticket 5/7: the posted comment's link, or why posting failed.
  posted_url         text not null default '',
  posted_at          timestamptz,
  post_error         text not null default '',

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_youtube_outreach_comments_project_id
  on public.youtube_outreach_comments (project_id);

create index if not exists idx_youtube_outreach_comments_target_id
  on public.youtube_outreach_comments (target_id);

alter table public.youtube_outreach_comments enable row level security;

-- ── Ticket 5/7 (86bcda68h): what the Mini's poster writes ──────────────────
--
-- Added as `add column if not exists` rather than folded into the create
-- above, so this file is right whether or not the table already exists: on a
-- database where 4/7's version was applied, these lines add the columns; on a
-- fresh one they are no-ops after the create. Running it twice changes nothing.
--
--   posting_started_at  when the worker marked the row `posting`. A row still
--                       `posting` well after this is one whose worker died
--                       mid-post: it is NEVER retried, and the screen shows it
--                       as "check this one by hand".
--   screenshot_url      the screenshot OpenClaw took of the posted comment,
--                       uploaded to Starcaster's storage. Blank with a reason
--                       in post_note when it could not be kept.
--   post_note           anything the worker wants Dane to read on the row that
--                       is not an error: the screenshot problem, or why a
--                       posted link could not be checked.
--   wait_reason         why an APPROVED comment has not gone out yet, in plain
--                       words ("waiting for tomorrow's allowance"), written by
--                       the worker each pass. Blank means nothing is holding it.
--   wait_checked_at     when the worker last looked — so a stale reason reads
--                       as stale rather than as current.

alter table public.youtube_outreach_comments add column if not exists posting_started_at timestamptz;
alter table public.youtube_outreach_comments add column if not exists screenshot_url text not null default '';
alter table public.youtube_outreach_comments add column if not exists post_note text not null default '';
alter table public.youtube_outreach_comments add column if not exists wait_reason text not null default '';
alter table public.youtube_outreach_comments add column if not exists wait_checked_at timestamptz;
