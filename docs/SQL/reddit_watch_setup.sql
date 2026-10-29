-- reddit_watch_setup.sql
-- Outreach wizard 18/19 (Loop Queue task 86bcrmbwm): Reddit finds
-- conversations on its own. Dane chooses subreddits once; the Mini reads
-- each one's new and rising posts every four hours through the signed-in
-- browser and keeps the ones that match his keywords or his canon.
--
--   reddit_watch_subreddits   one row per subreddit per project: suggested,
--                             approved or rejected, plus what the Mini's last
--                             read of it found (or why it could not read it).
--   reddit_watch_posts        one row per post the Mini kept, with its
--                             strongest comments once they have been read.
--
-- The keywords are the wizard's shared list (outreach_wizard_settings, from
-- docs/SQL/youtube_creators_setup.sql) — no new keyword column here.
--
-- BOTH tenant columns on BOTH tables (CLAUDE.md landmine 12). The store
-- writes them explicitly from the scope rather than through scopedInsertRow.
-- project_id is text, never uuid (DOCTRINE 5.13) — project ids are slugs.
--
-- RLS on, no policies, matching every table since the 2026-08-17 lockdown.
-- All access goes through the Node server with the service key.
--
-- Idempotent: every statement is `if not exists`, so running the whole file
-- twice changes nothing.

-- ── reddit_watch_subreddits ────────────────────────────────────────────────

create table if not exists public.reddit_watch_subreddits (
  id                   uuid primary key default gen_random_uuid(),
  project_id           text not null,
  owner_user_id        text,

  -- Lowercase, without the "r/" (Reddit's own names are 2-21 letters,
  -- numbers and underscores). One row per subreddit per project.
  name                 text not null,
  status               text not null default 'candidate'
                       check (status in ('candidate', 'approved', 'rejected')),
  -- 'ai': "Find subreddits for my topics" proposed it; 'hand': Dane typed it.
  suggested_by         text not null default 'hand'
                       check (suggested_by in ('ai', 'hand')),
  -- The AI's one sentence on why this subreddit fits his topics.
  why                  text not null default '',
  decided_at           timestamptz,

  -- The subreddit's own self-promotion rule, as its sidebar states it, from
  -- the Mini's last read. Blank: the sidebar states none (or it was not read).
  promotion_rule       text not null default '',
  -- The Mini's last read: '' never read, 'read', 'failed', 'signed_out'.
  last_read_state      text not null default ''
                       check (last_read_state in ('', 'read', 'failed', 'signed_out')),
  last_read_at         timestamptz,
  last_read_error      text not null default '',
  -- How many posts that read looked at, and how many it kept.
  last_read_seen       integer not null default 0,
  last_read_kept       integer not null default 0,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists idx_reddit_watch_subreddits_project_name
  on public.reddit_watch_subreddits (project_id, name);

create index if not exists idx_reddit_watch_subreddits_status
  on public.reddit_watch_subreddits (status, last_read_at);

alter table public.reddit_watch_subreddits enable row level security;

-- ── reddit_watch_posts ─────────────────────────────────────────────────────

create table if not exists public.reddit_watch_posts (
  id                   uuid primary key default gen_random_uuid(),
  project_id           text not null,
  owner_user_id        text,

  -- Reddit's own post id (the part after /comments/). One row per post per
  -- project: a post seen again refreshes its score and comment count.
  post_id              text not null,
  subreddit            text not null default '',
  url                  text not null default '',
  title                text not null default '',
  body                 text not null default '',
  author               text not null default '',
  -- Null when the browser could not read a time — never a guessed one.
  posted_at            timestamptz,
  score                integer not null default 0,
  num_comments         integer not null default 0,
  -- Which listing showed it: 'new' or 'rising'.
  listing              text not null default 'new',
  -- The keyword of Dane's it matched, or '' when it was kept for canon words.
  keyword              text not null default '',
  -- The strongest comments, once read: [{ "id", "author", "body", "score" }].
  top_comments         jsonb not null default '[]'::jsonb,
  -- When those comments were read; null means not read yet.
  comments_read_at     timestamptz,
  found_at             timestamptz not null default now(),

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists idx_reddit_watch_posts_project_post
  on public.reddit_watch_posts (project_id, post_id);

create index if not exists idx_reddit_watch_posts_project_found
  on public.reddit_watch_posts (project_id, found_at desc);

alter table public.reddit_watch_posts enable row level security;
