-- reddit_watch_read_requests.sql
-- FEATURE: Reddit's Find conversations has no Read now — pressing it says the request could not be saved, and a newly approved subreddit waits up to four hours for the Mini's next scheduled read.
-- RUN AFTER docs/SQL/reddit_watch_setup.sql
--
-- SC-883 (slice 4 of SC-880). Only the Mini's signed-in browser can read
-- Reddit, so Read now cannot read straight away the way YouTube's does. It
-- leaves a request here instead; the Mini checks this table every ten minutes
-- (scripts/run_reddit_watch.sh --requested), runs the normal watch for each
-- project that asked, and deletes the request when that read finishes,
-- whether it read or failed.
--
--   reddit_watch_read_requests   at most one row per project: a request that
--                                is still waiting. No row: nothing waiting.
--
-- ONE ROW PER PROJECT is the unique index below, and it is what makes a
-- second press while the first is waiting change nothing: the insert is
-- refused, and the store reads that refusal as "already asked".
--
-- BOTH tenant columns (CLAUDE.md landmine 12); project_id is text (DOCTRINE
-- 5.13). owner_user_id is whoever pressed Read now — the Mini acts as them for
-- that one read. RLS on, no policies, like every table since 2026-08-17.
--
-- It changes nothing that exists. Idempotent: running it twice changes nothing.

create table if not exists public.reddit_watch_read_requests (
  id                   uuid primary key default gen_random_uuid(),
  project_id           text not null,
  owner_user_id        text,
  -- When Read now was pressed. The Mini clears only requests made before its
  -- read started, so a press during a read is kept for the next one.
  requested_at         timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists idx_reddit_watch_read_requests_project
  on public.reddit_watch_read_requests (project_id);

alter table public.reddit_watch_read_requests enable row level security;
