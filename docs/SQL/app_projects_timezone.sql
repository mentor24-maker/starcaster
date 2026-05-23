-- Per-project IANA timezone for scheduling (Promote: Social, etc.).
-- Apply manually in Supabase SQL editor for each environment.

begin;

alter table public.app_projects
  add column if not exists timezone text not null default 'UTC';

comment on column public.app_projects.timezone is 'IANA timezone for interpreting scheduled local times (e.g. America/Los_Angeles).';

commit;
