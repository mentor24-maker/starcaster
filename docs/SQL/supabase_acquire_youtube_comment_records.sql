-- acquire_youtube_comment_records table
-- Stores individual mined YouTube comments so they can be assigned to segments and campaigns.

create table if not exists public.acquire_youtube_comment_records (
  comment_id text primary key,
  video_id text not null default '',
  video_url text not null default '',
  author_name text not null default '',
  author_url text not null default '',
  text text not null default '',
  like_count integer not null default 0,
  reply_count integer not null default 0,
  published_at timestamptz null,
  score integer not null default 0,
  topic text not null default '',
  category text not null default '',
  approach text not null default '',
  attributes text[] not null default '{}',
  campaign_id text null,
  run_id text not null default '',
  contact_id text null,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_acquire_yt_comments_campaign on public.acquire_youtube_comment_records (campaign_id);
create index if not exists idx_acquire_yt_comments_video on public.acquire_youtube_comment_records (video_id);
create index if not exists idx_acquire_yt_comments_score on public.acquire_youtube_comment_records (score desc);
create index if not exists idx_acquire_yt_comments_created on public.acquire_youtube_comment_records (created_at desc);

alter table public.acquire_youtube_comment_records disable row level security;
