-- 013_file_stores_supabase.sql
-- Supabase persistence for acquire job mirror, API orchestrator runs, and develop icons.
-- Requires app_projects.id as text (projects_multitenancy_setup.sql).
-- Apply in StarCaster Supabase; log in docs/MIGRATIONS_APPLIED.md.

begin;

-- OpenClaw acquire job mirror (project-scoped; complements ops.jobs when present)
create table if not exists public.acquire_job_mirror (
  project_id text not null references public.app_projects (id) on delete cascade,
  id text not null,
  owner_user_id text null,
  stage text not null default '',
  workspace_id text not null default '',
  type text not null default '',
  url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

create index if not exists idx_acquire_job_mirror_updated
  on public.acquire_job_mirror (project_id, updated_at desc);

-- Settings API setup orchestrator run history
create table if not exists public.orchestrator_runs (
  project_id text not null references public.app_projects (id) on delete cascade,
  id text not null,
  owner_user_id text null,
  status text not null default 'completed',
  run_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

create index if not exists idx_orchestrator_runs_created
  on public.orchestrator_runs (project_id, created_at desc);

-- Builder icon-builder records
create table if not exists public.develop_icons (
  id text primary key,
  project_id text not null references public.app_projects (id) on delete cascade,
  owner_user_id text null,
  workspace_id text not null default '',
  object_type text not null default 'custom',
  object_name text not null default '',
  category text not null default '',
  summary text not null default '',
  visual_style text not null default '',
  palette jsonb not null default '{}'::jsonb,
  size_label text not null default '',
  svg text not null default '',
  data_url text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_develop_icons_project_created
  on public.develop_icons (project_id, created_at desc);

commit;
