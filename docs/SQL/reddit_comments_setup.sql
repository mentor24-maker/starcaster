-- reddit_comments_setup.sql
-- Reddit comments 2/4 (Loop Queue task 86bch3jp3): one row per Reddit comment
-- Starcaster writes for Dane — the post it answers (as read), the draft the AI
-- wrote from his canon (1/4, canon_documents), the words he approved, and
-- later (4/4) the proof it was posted.
--
-- Nothing posts from here. The screen is 3/4; the posting is 4/4.
--
-- Status path, enforced by lib/redditCommentsStore.js (STATUS_MOVES):
--
--   idea ─► draft ─► approved ─► posting ─► posted
--     │       │         │                 └► failed ─► approved (try again)
--     └───────┴─────────┴─► rejected ─► idea (think again)
--
--   target_url        the post or comment link Dane added, normalised
--   post_id           Reddit's id for the post (the part after /comments/)
--   parent_comment_id set when the link is to a comment, so the reply goes there
--   subreddit / post_title / post_body / post_author
--                     the post as it was read (or as Dane pasted it)
--   parent_comment_author / parent_comment_text
--                     the comment being replied to, when there is one
--   top_comments      up to ten of the post's top comments, as read: [{author, body, score}]
--   post_read_from    'reddit' (read from Reddit) or 'pasted' (Dane pasted it,
--                     because Reddit refused the read)
--   canon_used        which canon documents the draft was written from, and the
--                     synced_at of each: [{docKey, syncedAt}]
--
-- BOTH tenant columns (CLAUDE.md landmine 12). project_id is text, never uuid
-- (DOCTRINE 5.13). RLS on with no policies for the app, like every table since
-- the 2026-08-17 lockdown; the Node server reads it with the service key.
--
-- The last block gives `starcaster_readonly` (the login `npm run db:refresh`
-- copies production with) sight of the rows; without it an RLS table copies
-- down EMPTY rather than failing. Skipped where that login does not exist.
--
-- Touches nothing that exists. Idempotent: running the whole file twice
-- changes nothing.

create table if not exists public.reddit_comment_items (
  id                     uuid primary key default gen_random_uuid(),
  project_id             text not null,
  owner_user_id          text not null,

  target_url             text not null,
  post_id                text not null default '',
  parent_comment_id      text not null default '',
  subreddit              text not null default '',
  post_title             text not null default '',
  post_body              text not null default '',
  post_author            text not null default '',
  parent_comment_author  text not null default '',
  parent_comment_text    text not null default '',
  top_comments           jsonb not null default '[]'::jsonb,
  post_read_from         text not null default 'reddit'
                         check (post_read_from in ('reddit', 'pasted')),

  draft_text             text not null default '',
  final_text             text not null default '',
  canon_used             jsonb not null default '[]'::jsonb,

  status                 text not null default 'idea'
                         check (status in ('idea', 'draft', 'approved', 'rejected', 'posting', 'posted', 'failed')),
  approved_by            text not null default '',
  approved_at            timestamptz,

  posted_url             text not null default '',
  screenshot_url         text not null default '',
  posted_at              timestamptz,
  error                  text not null default '',

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_reddit_comment_items_project_id
  on public.reddit_comment_items (project_id);

create index if not exists idx_reddit_comment_items_project_status
  on public.reddit_comment_items (project_id, status);

alter table public.reddit_comment_items enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'starcaster_readonly')
     and not exists (
       select 1 from pg_policies
        where schemaname = 'public' and tablename = 'reddit_comment_items'
          and policyname = 'starcaster_readonly_select'
     ) then
    execute 'grant select on public.reddit_comment_items to starcaster_readonly';
    execute 'create policy starcaster_readonly_select on public.reddit_comment_items '
         || 'for select to starcaster_readonly using (true)';
  end if;
end $$;
