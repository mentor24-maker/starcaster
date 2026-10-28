-- youtube_conversations_setup.sql
-- Outreach wizard 16/19 (Loop Queue task 86bcrmbtn): the comments worth
-- replying to on approved YouTube creators' newest videos.
--
-- RUN AFTER docs/SQL/youtube_creators_setup.sql — these are columns on the
-- table that file creates.
--
-- The scheduled read (lib/acquire/YoutubeCommentsReadDue.js, every three
-- hours) keeps what it found on the creator's own row, the way the Substack
-- Miner keeps a writer's newest Notes on the writer's row (`recent_notes`):
--
--   recent_videos          the channel's uploads from the last 14 days, each
--                          with its top-level comments as last read:
--                          [{ "videoId", "title", "publishedAt",
--                             "commentsDisabled", "comments": [{ "commentId",
--                             "text", "authorName", "authorChannelUrl",
--                             "authorChannelId", "likes", "replies",
--                             "publishedAt" }] }]
--   last_comments_read_at  when a read last came back for this channel. Null:
--                          never read — the screen says "Cannot tell", never
--                          "nothing to reply to".
--   comments_read_error    why the last read did NOT come back ('' when it did).
--
-- No new table, so no tenant columns to add: youtube_creators already carries
-- project_id AND owner_user_id (CLAUDE.md landmine 12).
--
-- Idempotent: every statement is `if not exists`.

alter table public.youtube_creators
  add column if not exists recent_videos jsonb not null default '[]'::jsonb;

alter table public.youtube_creators
  add column if not exists last_comments_read_at timestamptz;

alter table public.youtube_creators
  add column if not exists comments_read_error text not null default '';
