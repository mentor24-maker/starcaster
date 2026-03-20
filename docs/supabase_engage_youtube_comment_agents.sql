-- engage_youtube_comment_agents table
-- Stores one row per scheduled YouTube comment promotion agent.

create table if not exists public.engage_youtube_comment_agents (
  id text primary key,
  channel text not null default 'youtube_comments',
  video_url text not null default '',
  from_date text not null default '',
  to_date text not null default '',
  frequency integer not null default 1,
  timeframe text not null default 'month',
  max_posts integer not null default 1,
  video_comment_ratio text not null default '100/0',
  jitter_hours integer not null default 10,
  schedule_enabled boolean not null default false,
  schedule_status text not null default 'disabled',
  schedule_note text not null default '',
  next_run_at timestamptz null,
  last_run_attempted_at timestamptz null,
  last_posted_at timestamptz null,
  last_posted_comment_id text not null default '',
  last_posted_thread_id text not null default '',
  total_posts_count integer not null default 0,
  last_error text not null default '',
  last_test_posted_at timestamptz null,
  last_test_comment_id text not null default '',
  last_test_thread_id text not null default '',
  last_test_comment_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists engage_youtube_comment_agents_updated_at_idx
  on public.engage_youtube_comment_agents (updated_at desc);

create index if not exists engage_youtube_comment_agents_next_run_at_idx
  on public.engage_youtube_comment_agents (next_run_at asc);

create index if not exists engage_youtube_comment_agents_schedule_enabled_idx
  on public.engage_youtube_comment_agents (schedule_enabled);

create index if not exists engage_youtube_comment_agents_video_url_idx
  on public.engage_youtube_comment_agents (video_url);
