-- outreach_expected_account.sql
-- Outreach wizard 2/19 (Loop Queue task 86bcrmba0): which account each
-- outreach channel posts as is chosen on a screen, not written in code.
--
-- Before this, lib/openclawSignIn.js held the names as constants: Substack
-- expected "Dane of Earth" while the Mini was signed in as "Dane Christensen",
-- and Reddit's was blank, so Reddit refused to post at all. Now the account
-- lives on the channel's own settings row, and Dane confirms it on Engage ›
-- Outreach (the Connect stage).
--
-- The same four columns on all three settings tables:
--
--   expected_account               the account Dane confirmed. Blank means
--                                  nobody has chosen one yet, and NOTHING posts
--                                  on that channel until somebody does.
--   expected_account_confirmed_at  when he confirmed it.
--   browser_account                the account name the Mini's browser was
--                                  last seen signed in as (written by the
--                                  posting worker's hourly check, beside the
--                                  four browser_* columns it already writes).
--                                  This is what the Connect stage offers him:
--                                  "The Mini is signed in to Substack as …".
--   check_requested_at             the Connect stage's "Check now". The worker
--                                  runs its sign-in check early when this is
--                                  newer than its last check. Nothing on the
--                                  internet can reach the Mini, so the request
--                                  is left here for it to find.
--
-- And on reddit_comment_settings only, Reddit's pace, which was a constant in
-- lib/redditPace.js. Blank means the plain default (3 a day, 20 minutes apart);
-- the other two channels already keep their pace on these rows.
--
-- reddit_comment_settings.owner_user_id is `not null` and the other two are
-- nullable; the Outreach screen writes both tenant columns either way
-- (lib/outreachAccounts.js, CLAUDE.md landmine 12).
--
-- `add column if not exists` throughout, so running this twice changes nothing.

alter table public.youtube_outreach_settings add column if not exists expected_account text not null default '';
alter table public.youtube_outreach_settings add column if not exists expected_account_confirmed_at timestamptz;
alter table public.youtube_outreach_settings add column if not exists browser_account text not null default '';
alter table public.youtube_outreach_settings add column if not exists check_requested_at timestamptz;

alter table public.substack_notes_settings add column if not exists expected_account text not null default '';
alter table public.substack_notes_settings add column if not exists expected_account_confirmed_at timestamptz;
alter table public.substack_notes_settings add column if not exists browser_account text not null default '';
alter table public.substack_notes_settings add column if not exists check_requested_at timestamptz;

alter table public.reddit_comment_settings add column if not exists expected_account text not null default '';
alter table public.reddit_comment_settings add column if not exists expected_account_confirmed_at timestamptz;
alter table public.reddit_comment_settings add column if not exists browser_account text not null default '';
alter table public.reddit_comment_settings add column if not exists check_requested_at timestamptz;
alter table public.reddit_comment_settings add column if not exists max_comments_per_day integer;
alter table public.reddit_comment_settings add column if not exists min_minutes_between integer;
