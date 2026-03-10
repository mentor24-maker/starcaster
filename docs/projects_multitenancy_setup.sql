-- projects_multitenancy_setup.sql
-- Phase 1 foundation for project/user multi-tenancy.

begin;

create table if not exists public.app_projects (
  id text primary key,
  name text not null,
  slug text not null unique,
  description text null,
  created_by_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_project_memberships (
  project_id text not null references public.app_projects(id) on delete cascade,
  user_id text not null,
  role text not null default 'member',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists idx_app_project_memberships_user
  on public.app_project_memberships(user_id);

-- Core entities: add project + owner scope columns.
alter table public.contacts
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table public.segments
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table public.campaigns
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table public.assets
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

alter table public.asset_categories
  add column if not exists project_id text,
  add column if not exists owner_user_id text;

create index if not exists idx_contacts_project_id on public.contacts(project_id);
create index if not exists idx_segments_project_id on public.segments(project_id);
create index if not exists idx_campaigns_project_id on public.campaigns(project_id);
create index if not exists idx_assets_project_id on public.assets(project_id);
create index if not exists idx_asset_categories_project_id on public.asset_categories(project_id);

commit;

