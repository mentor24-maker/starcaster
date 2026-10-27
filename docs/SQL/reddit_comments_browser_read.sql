-- reddit_comments_browser_read.sql
-- Outreach wizard 17/19 (Loop Queue task 86bcrmbuv): the Mini's signed-in
-- browser reads the Reddit post a comment will answer, so Dane no longer
-- pastes its title and text by hand.
--
-- Run AFTER reddit_comments_setup.sql (2/4) and reddit_comments_posting.sql
-- (4/4). Adds columns with defaults to reddit_comment_items and touches
-- nothing else; every existing row reads exactly as before (read_state '').
--
--   read_state         where the browser read stands:
--                        ''         nothing pending — the post was read, or pasted
--                        'reading'  waiting for the Mini (Add just created it)
--                        'failed'   the Mini could not read it; read_error says why
--                      Only an `idea` row is ever `reading` or `failed`, and
--                      it cannot be drafted until the post is in.
--   read_error         the reason, in a sentence Dane can act on
--                      ("Reddit says this post was removed").
--   read_code          the same reason as a code, for the screen and the tests.
--   read_requested_at  when Add (or "Try reading again") asked for the read.
--   read_finished_at   when the Mini wrote its answer.
--
-- Written by lib/redditCommentsStore.js only: Add and "Try reading again" set
-- `reading`; the Mini's worker (workers/youtube-outreach/adapters/reddit.js)
-- moves `reading` to '' or `failed`, guarded on `reading` so a row Dane has
-- since pasted by hand is never overwritten.
--
-- Idempotent: running the whole file twice changes nothing.

alter table public.reddit_comment_items add column if not exists read_state text not null default '' check (read_state in ('', 'reading', 'failed'));
alter table public.reddit_comment_items add column if not exists read_error text not null default '';
alter table public.reddit_comment_items add column if not exists read_code text not null default '';
alter table public.reddit_comment_items add column if not exists read_requested_at timestamptz;
alter table public.reddit_comment_items add column if not exists read_finished_at timestamptz;

create index if not exists idx_reddit_comment_items_project_read_state
  on public.reddit_comment_items (project_id, read_state);
