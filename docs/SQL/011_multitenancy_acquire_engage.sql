-- 011_multitenancy_acquire_engage.sql
-- Project-scoped persistence for Promote Social and Acquire operational runs.
-- Apply in Supabase SQL editor after core project columns exist (projects_multitenancy_setup.sql).

begin;

-- Engage: scheduled / published social posts
create table if not exists public.engage_social_posts (
  id text primary key,
  channel text not null default 'x',
  campaign_id text not null default '',
  image_url text not null default '',
  image_alt text not null default '',
  post_text text not null default '',
  status text not null default 'scheduled',
  scheduled_for timestamptz null,
  published_at timestamptz null,
  remote_id text not null default '',
  error text not null default '',
  diagnostics jsonb not null default '{}'::jsonb,
  project_id text null,
  owner_user_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_engage_social_posts_project_id
  on public.engage_social_posts(project_id);

create index if not exists idx_engage_social_posts_status_scheduled
  on public.engage_social_posts(status, scheduled_for);

-- Acquire: direct website harvest runs (summary + full payload)
create table if not exists public.direct_acquire_runs (
  run_id text primary key,
  source_url text not null default '',
  pages_succeeded integer not null default 0,
  pages_failed integer not null default 0,
  started_at timestamptz null,
  finished_at timestamptz null,
  run_json jsonb not null default '{}'::jsonb,
  project_id text null,
  owner_user_id text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_direct_acquire_runs_project_id
  on public.direct_acquire_runs(project_id);

create index if not exists idx_direct_acquire_runs_created_at
  on public.direct_acquire_runs(created_at desc);

-- Acquire: X harvest runs
create table if not exists public.x_harvest_runs (
  run_id text primary key,
  query text not null default '',
  language text not null default '',
  start_time text not null default '',
  end_time text not null default '',
  max_tweets integer not null default 0,
  max_replies_per_tweet integer not null default 0,
  include_replies boolean not null default false,
  request_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  project_id text null,
  owner_user_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_x_harvest_runs_project_id
  on public.x_harvest_runs(project_id);

-- Acquire: Reddit harvest runs
create table if not exists public.reddit_harvest_runs (
  run_id text primary key,
  mode text not null default '',
  target text not null default '',
  subreddit text not null default '',
  post_id text not null default '',
  request_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  project_id text null,
  owner_user_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_reddit_harvest_runs_project_id
  on public.reddit_harvest_runs(project_id);

commit;
