-- reddit_comments_posting.sql
-- Reddit comments 4/4 (Loop Queue task 86bch3jpg): what the Mini's posting
-- worker needs to post approved Reddit comments through its signed-in
-- browser, and to say on the Comments screen whether that browser is signed in.
--
-- Run AFTER reddit_comments_setup.sql (2/4). Touches nothing that exists apart
-- from adding columns with defaults to reddit_comment_items; every existing
-- row reads exactly as before.
--
-- On reddit_comment_items, the same columns, with the same meanings, as the
-- Substack Notes and YouTube outreach items carry:
--
--   account_key         which account posts it. One today (dane_of_earth).
--   posting_started_at  when the worker took it (approved -> posting). A row
--                       still `posting` long after this is one the worker died
--                       holding, and the screen says to check it by hand.
--   post_note           what the worker noted about the post (a screenshot it
--                       could not keep, say).
--   wait_reason         why an approved comment has not gone out yet, in the
--                       worker's words ("Waiting for tomorrow's allowance …").
--   wait_checked_at     when that reason was written.
--
-- reddit_comment_settings: one row per project and account, written ONLY by
-- the worker's hourly sign-in check (workers/youtube-outreach/health.js), so
-- the screen can show "Mini: signed in to Reddit as …, checked N minutes ago"
-- without reaching the Mini. The four browser_* columns mean what they mean
-- on substack_notes_settings (substack_notes_browser_check.sql).
--
-- BOTH tenant columns (CLAUDE.md landmine 12). project_id is text (DOCTRINE
-- 5.13). RLS on with no policies for the app; the Node server reads it with
-- the service key. The last block lets `starcaster_readonly` (the login
-- `npm run db:refresh` copies production with) see the new table's rows.
--
-- Idempotent: running the whole file twice changes nothing.

alter table public.reddit_comment_items add column if not exists account_key text not null default 'dane_of_earth';
alter table public.reddit_comment_items add column if not exists posting_started_at timestamptz;
alter table public.reddit_comment_items add column if not exists post_note text not null default '';
alter table public.reddit_comment_items add column if not exists wait_reason text not null default '';
alter table public.reddit_comment_items add column if not exists wait_checked_at timestamptz;

create table if not exists public.reddit_comment_settings (
  id                    uuid primary key default gen_random_uuid(),
  project_id            text not null,
  owner_user_id         text not null,
  account_key           text not null default 'dane_of_earth',

  browser_state         text not null default '',
  browser_message       text not null default '',
  browser_checked_at    timestamptz,
  browser_signed_in_at  timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists uq_reddit_comment_settings_project_account
  on public.reddit_comment_settings (project_id, account_key);

alter table public.reddit_comment_settings enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'starcaster_readonly')
     and not exists (
       select 1 from pg_policies
        where schemaname = 'public' and tablename = 'reddit_comment_settings'
          and policyname = 'starcaster_readonly_select'
     ) then
    execute 'grant select on public.reddit_comment_settings to starcaster_readonly';
    execute 'create policy starcaster_readonly_select on public.reddit_comment_settings '
         || 'for select to starcaster_readonly using (true)';
  end if;
end $$;
