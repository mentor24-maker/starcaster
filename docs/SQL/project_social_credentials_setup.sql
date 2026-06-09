-- Per-project social credentials (Facebook Page OAuth tokens, etc.)
-- Run manually in the StarCaster Supabase project.
-- Requires app_projects.id as text (see docs/projects_multitenancy_setup.sql).

create table if not exists public.project_social_credentials (
  project_id text not null references public.app_projects (id) on delete cascade,
  provider text not null default 'facebook_page',
  page_id text not null default '',
  page_name text not null default '',
  access_token_enc text not null default '',
  access_token_iv text not null default '',
  access_token_tag text not null default '',
  key_version text not null default 'v1',
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (project_id, provider)
);

create index if not exists idx_project_social_credentials_updated
  on public.project_social_credentials (project_id, updated_at desc);

-- Short-lived OAuth handoffs when a user manages multiple Facebook Pages.
create table if not exists public.project_oauth_handoffs (
  id text primary key,
  project_id text not null references public.app_projects (id) on delete cascade,
  user_id text not null,
  provider text not null default 'facebook_page',
  pages jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_oauth_handoffs_expires
  on public.project_oauth_handoffs (expires_at);
