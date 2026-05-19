-- Connection Ops (Settings > APIs > Connection) — gates + attempt log per project/platform.
-- Run in the StarCaster Supabase project.
-- Requires app_projects.id as text (see docs/projects_multitenancy_setup.sql).

create table if not exists public.connection_ops_state (
  project_id text not null references public.app_projects (id) on delete cascade,
  platform text not null,
  gates jsonb not null default '{}'::jsonb,
  attempts jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (project_id, platform)
);

create index if not exists idx_connection_ops_state_updated
  on public.connection_ops_state (project_id, updated_at desc);
