-- substack_notes_setup.sql
-- Substack Notes 1/7 (Loop Queue task 86bcet65t): somewhere to keep everything
-- the Substack Notes agent does for Dane of Earth, and the account's settings.
--
--   substack_notes_items     one row per action: a Note of his own, a reply to
--                            someone else's Note, a restack, or a like.
--   substack_notes_settings  one row per project and posting account: daily
--                            cap, spacing, active hours, voice, topics, links.
--
-- Nothing drafts, schedules or posts anything yet. The screen is ticket 2/7;
-- drafting is 3/7-5/7; posting is 6/7. This file only creates the places they
-- read. It mirrors docs/SQL/youtube_outreach_setup.sql (YouTube outreach 1/7).
--
-- Dane's decisions (2026-10-07): the agent does all three jobs (his own Notes,
-- replies to other people's, restacks and likes); ideas come from his new
-- content, from topics he sets, and from ideas he jots down; it posts as Dane
-- of Earth at about 1 to 3 actions a day; every action waits for his approval.
--
-- `account_key` names the Substack account a row belongs to. Dane of Earth is
-- the first ('dane_of_earth'); another account gets its own settings row rather
-- than a schema change.
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
-- lib/substackNotesStore.js, which refuses a bad value with a message naming
-- the field before the database ever sees it. Which status may follow which,
-- and which source fits which kind, are the store's job only.
--
-- updated_at is written by the store on every change, not by a trigger.
--
-- Idempotent: every statement is `if not exists` or a no-op when already true,
-- so running the whole file twice changes nothing.

-- ── substack_notes_items ────────────────────────────────────────────────────

create table if not exists public.substack_notes_items (
  id                   uuid primary key default gen_random_uuid(),
  project_id           text not null,
  owner_user_id        text,
  account_key          text not null default 'dane_of_earth',

  -- What the action is, and where the idea for it came from. A Note of his own
  -- comes from something he jotted, a topic he set, or his new content; a
  -- reply, restack or like is always about someone else's Note (a target).
  kind                 text not null
                       check (kind in ('note', 'reply', 'restack', 'like')),
  source               text not null
                       check (source in ('jotted', 'topic', 'new_content', 'target')),

  -- What Dane jotted, or the topic the Note is about.
  idea_text            text not null default '',
  -- His new video, article or blog post, for a 'new_content' Note.
  content_url          text not null default '',
  content_title        text not null default '',
  -- The other person's Note, for a reply, restack or like.
  target_url           text not null default '',
  target_text          text not null default '',

  -- What the agent wrote, and what Dane approved (his edit, when he made one).
  -- Restacks and likes carry no text and go from 'idea' straight to approval.
  draft_text           text not null default '',
  final_text           text not null default '',

  status               text not null default 'idea'
                       check (status in ('idea', 'draft', 'approved', 'rejected', 'posting', 'posted', 'failed')),
  approved_by          text not null default '',
  approved_at          timestamptz,

  -- Proof it happened, or why it did not.
  posted_url           text not null default '',
  screenshot_url       text not null default '',
  posted_at            timestamptz,
  error                text not null default '',

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_substack_notes_items_project_id
  on public.substack_notes_items (project_id);

create index if not exists idx_substack_notes_items_project_account_status
  on public.substack_notes_items (project_id, account_key, status);

alter table public.substack_notes_items enable row level security;

-- ── substack_notes_settings ─────────────────────────────────────────────────

create table if not exists public.substack_notes_settings (
  id                      uuid primary key default gen_random_uuid(),
  project_id              text not null,
  owner_user_id           text,
  account_key             text not null default 'dane_of_earth',

  -- His publication (https://xxx.substack.com) and his YouTube channel, which
  -- is where 'new_content' ideas come from.
  substack_url            text not null default '',
  youtube_channel_id      text not null default '',

  max_actions_per_day     integer not null default 3,
  -- At least this many minutes between any two actions, plus up to
  -- jitter_minutes of random extra so the spacing is not a visible clock.
  min_minutes_between     integer not null default 90,
  jitter_minutes          integer not null default 30,
  -- Actions only happen between these hours (0-23, start inclusive, end
  -- exclusive), in time_zone. A blank time_zone means the project's own.
  active_start_hour       integer not null default 8,
  active_end_hour         integer not null default 22,
  time_zone               text not null default '',

  -- How he sounds, in plain words, for the drafting steps (3/7-5/7).
  voice                   text not null default '',
  topics                  text[] not null default '{}',
  avoid_words             text[] not null default '{}',
  -- Whether his own Notes may carry a link.
  link_policy             text not null default 'if_natural'
                          check (link_policy in ('never', 'if_natural', 'allowed')),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists idx_substack_notes_settings_project_account
  on public.substack_notes_settings (project_id, account_key);

alter table public.substack_notes_settings enable row level security;

-- ── Ticket 6/7 (86bcet7qr): what the Mini's poster writes ──────────────────
--
-- Added as `add column if not exists`, the same way YouTube outreach 5/7 added
-- its poster's columns, so this file is right whether or not the table already
-- exists and running it twice changes nothing. posted_url, screenshot_url,
-- posted_at and error were already here from 1/7.
--
--   posting_started_at  when the worker marked the row `posting`. A row still
--                       `posting` well after this is one whose worker died
--                       mid-post: it is NEVER retried, and the screen shows it
--                       as "check this one by hand".
--   post_note           anything the worker wants Dane to read on the row that
--                       is not an error: why the screenshot was not kept, or
--                       what OpenClaw said alongside a success.
--   wait_reason         why an APPROVED item has not gone out yet, in plain
--                       words ("waiting for tomorrow's allowance"), written by
--                       the worker when it changes. Blank means nothing holds it.
--   wait_checked_at     when the worker last wrote that reason.

alter table public.substack_notes_items add column if not exists posting_started_at timestamptz;
alter table public.substack_notes_items add column if not exists post_note text not null default '';
alter table public.substack_notes_items add column if not exists wait_reason text not null default '';
alter table public.substack_notes_items add column if not exists wait_checked_at timestamptz;
